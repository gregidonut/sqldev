package e2ereset

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/gregidonut/sqldev/packages/cli/internal/process"
)

// HostRuntimeIdentity is the whitelisted, non-sensitive identity the host
// prints for the preflight probe. It never contains credentials.
type HostRuntimeIdentity struct {
	AppName       string `json:"app_name"`
	Stage         string `json:"stage"`
	AppBucket     string `json:"app_bucket"`
	JobResultName string `json:"job_result_bucket"`
}

// DatabaseResult reports the outcome of the host SQL phase.
type DatabaseResult struct {
	Committed bool
}

// ssmPollInterval and ssmSQLBudget bound one Run Command status wait.
// readinessBudget bounds the separate bootstrap wait: a fresh volume pulls
// images and applies migrations before the service units exist.
const (
	ssmPollInterval   = 2 * time.Second
	ssmSQLBudget      = 5 * time.Minute
	readinessBudget   = 15 * time.Minute
	readinessInterval = 5 * time.Second
)

var instanceIDPattern = regexp.MustCompile(`^i-[A-Za-z0-9]+$`)

// readinessScript is fixed. Bootstrap creates and starts the Imagor and worker
// units only after `worker migrate` succeeds, so active units plus a ready
// database mean the migration phase finished. It prints a marker and always
// exits 0 so the caller can poll without treating "not yet" as a command failure.
const readinessScript = `set +e
db=0
docker exec sqldev-db pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && db=1
imagor=$(systemctl is-active sqldev-imagor.service 2>/dev/null)
worker=$(systemctl is-active sqldev-worker.service 2>/dev/null)
if [ "$db" = 1 ] && [ "$imagor" = active ] && [ "$worker" = active ]; then
  printf 'HOST_READY\n'
else
  printf 'HOST_NOT_READY\n'
fi
exit 0
`

// HostExecutor runs fixed operations on the staging host over SSM Run Command.
// It accepts no caller script or SQL; the only interpolated value is the
// validated instance ID.
type HostExecutor struct {
	Runner process.Runner
	Region string
	// now and sleep are injectable for tests.
	now           func() time.Time
	sleep         func(context.Context, time.Duration) error
	readyBudget   time.Duration
	readyInterval time.Duration
}

// NewHostExecutor builds a HostExecutor with real time functions.
func NewHostExecutor(runner process.Runner, region string) *HostExecutor {
	return &HostExecutor{
		Runner:        runner,
		Region:        region,
		now:           time.Now,
		sleep:         sleepCtx,
		readyBudget:   readinessBudget,
		readyInterval: readinessInterval,
	}
}

// WithReadinessWindow overrides how long WaitReady polls. Non-positive values
// are ignored. Tests use it to bound a failure without waiting out the default.
func (h *HostExecutor) WithReadinessWindow(budget, interval time.Duration) *HostExecutor {
	if budget > 0 {
		h.readyBudget = budget
	}
	if interval > 0 {
		h.readyInterval = interval
	}
	return h
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// ProbeIdentity runs a harmless command that prints the whitelisted host
// identity JSON, confirming SSM reachability and that the host matches the plan.
func (h *HostExecutor) ProbeIdentity(ctx context.Context, instanceID string) (HostRuntimeIdentity, error) {
	script := `set -euo pipefail
printf '{"app_name":"%s","stage":"%s","app_bucket":"%s","job_result_bucket":"%s"}\n' \
  "${APP_NAME:-}" "${APP_STAGE:-}" "${APP_BUCKET:-}" "${JOB_RESULT_BUCKET:-}"`
	// APP_* live in the host's /etc/environment-style context only on the host.
	// The probe reads them on the host and prints only these four fields.
	out, err := h.runShell(ctx, instanceID, "source /run/sqldev/worker.env 2>/dev/null || true\n"+script)
	if err != nil {
		return HostRuntimeIdentity{}, err
	}
	var id HostRuntimeIdentity
	if err := json.Unmarshal([]byte(firstJSONObject(out)), &id); err != nil {
		return HostRuntimeIdentity{}, errors.New("host identity probe returned an unparseable response")
	}
	return id, nil
}

// QuiesceWorker stops the DBOS worker and schedules a bounded fallback that
// restarts it after ten minutes, protecting against CLI interruption.
func (h *HostExecutor) QuiesceWorker(ctx context.Context, instanceID string) error {
	script := `set -euo pipefail
# Fallback recovery: restart the worker in 10 minutes even if the CLI dies.
systemd-run --on-active=600 --unit=sqldev-worker-recover /usr/bin/systemctl start sqldev-worker.service >/dev/null 2>&1 || true
systemctl stop sqldev-worker.service
# Verify it is inactive.
if systemctl is-active --quiet sqldev-worker.service; then
  echo "worker still active" >&2
  exit 1
fi
echo "WORKER_STOPPED"`
	out, err := h.runShell(ctx, instanceID, script)
	if err != nil {
		return err
	}
	if !strings.Contains(out, "WORKER_STOPPED") {
		return errors.New("worker did not stop on the staging host")
	}
	return nil
}

// ExecuteCanonicalSQL pipes the embedded audited SQL to psql inside the host's
// Postgres container. The password is read from the host-local file and never
// leaves the host. Output contains only a phase marker.
func (h *HostExecutor) ExecuteCanonicalSQL(ctx context.Context, instanceID string) (DatabaseResult, error) {
	ctx, cancel := context.WithTimeout(ctx, ssmSQLBudget)
	defer cancel()

	// The SQL is heredoc'd inside the script; it is the embedded constant, not
	// caller input. The password is sourced on the host only.
	script := `set -euo pipefail
set -a
source /run/sqldev/db.env
set +a
docker exec -i -e PGPASSWORD="${POSTGRES_PASSWORD}" sqldev-db \
  psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 <<'SQLDEV_RESET_SQL'
` + CanonicalSQL() + `
SQLDEV_RESET_SQL
echo "DB_RESET_COMMITTED"`
	out, err := h.runShell(ctx, instanceID, script)
	if err != nil {
		return DatabaseResult{}, err
	}
	if !strings.Contains(out, "DB_RESET_COMMITTED") {
		return DatabaseResult{}, errors.New("staging database reset did not commit")
	}
	return DatabaseResult{Committed: true}, nil
}

// WaitReady polls until Postgres accepts connections and the Imagor and worker
// units are active, or until the readiness budget expires. A fresh instance may
// not be registered with SSM yet; send failures are retried inside the budget.
func (h *HostExecutor) WaitReady(ctx context.Context, instanceID string) error {
	if !instanceIDPattern.MatchString(instanceID) {
		return errors.New("host readiness refused: instance id is not valid")
	}
	deadline := h.now().Add(h.readyBudget)
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		out, err := h.runShell(ctx, instanceID, readinessScript)
		if err == nil && strings.Contains(out, "HOST_READY") && !strings.Contains(out, "HOST_NOT_READY") {
			return nil
		}
		if !h.now().Before(deadline) {
			return errors.New("timed out waiting for the staging host to finish bootstrap")
		}
		if err := h.sleep(ctx, h.readyInterval); err != nil {
			return err
		}
	}
}

// RestartWorker starts the worker and cancels the fallback recovery timer.
func (h *HostExecutor) RestartWorker(ctx context.Context, instanceID string) error {
	script := `set -euo pipefail
systemctl start sqldev-worker.service
systemctl reset-failed sqldev-worker-recover.timer >/dev/null 2>&1 || true
systemctl stop sqldev-worker-recover.timer >/dev/null 2>&1 || true
if systemctl is-active --quiet sqldev-worker.service; then
  echo "WORKER_STARTED"
else
  echo "worker not active" >&2
  exit 1
fi`
	out, err := h.runShell(ctx, instanceID, script)
	if err != nil {
		return err
	}
	if !strings.Contains(out, "WORKER_STARTED") {
		return errors.New("worker did not restart on the staging host")
	}
	return nil
}

// runShell submits a fixed AWS-RunShellScript document to the instance and
// polls for completion within the budget. The commands parameter is the only
// script, built from embedded constants and the validated instance ID.
func (h *HostExecutor) runShell(ctx context.Context, instanceID, script string) (string, error) {
	params, err := json.Marshal(map[string]any{"commands": []string{script}})
	if err != nil {
		return "", err
	}
	var out bytes.Buffer
	err = h.Runner.Run(ctx, process.RunRequest{
		Program: "aws",
		Args: []string{
			"ssm", "send-command",
			"--region", h.Region,
			"--instance-ids", instanceID,
			"--document-name", "AWS-RunShellScript",
			"--parameters", string(params),
			"--query", "Command.CommandId",
			"--output", "text",
		},
		Stdout: &out,
	})
	if err != nil {
		return "", err
	}
	commandID := strings.TrimSpace(out.String())
	if commandID == "" {
		return "", errors.New("SSM send-command returned no command id")
	}
	return h.pollInvocation(ctx, instanceID, commandID)
}

func (h *HostExecutor) pollInvocation(ctx context.Context, instanceID, commandID string) (string, error) {
	deadline := h.now().Add(ssmSQLBudget)
	for {
		var out bytes.Buffer
		err := h.Runner.Run(ctx, process.RunRequest{
			Program: "aws",
			Args: []string{
				"ssm", "get-command-invocation",
				"--region", h.Region,
				"--command-id", commandID,
				"--instance-id", instanceID,
				"--output", "json",
			},
			Stdout: &out,
		})
		if err != nil {
			return "", err
		}
		var inv struct {
			Status                string `json:"Status"`
			StandardOutputContent string `json:"StandardOutputContent"`
			StandardErrorContent  string `json:"StandardErrorContent"`
		}
		if err := json.Unmarshal(out.Bytes(), &inv); err != nil {
			return "", errors.New("SSM invocation response was unparseable")
		}
		switch inv.Status {
		case "Success":
			return inv.StandardOutputContent, nil
		case "Pending", "InProgress", "Delayed":
			// keep polling
		default:
			return "", fmt.Errorf("SSM command %s on the staging host", strings.ToLower(inv.Status))
		}
		if h.now().After(deadline) {
			return "", errors.New("timed out waiting for the SSM command to complete")
		}
		if err := h.sleep(ctx, ssmPollInterval); err != nil {
			return "", err
		}
	}
}

func firstJSONObject(s string) string {
	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")
	if start < 0 || end < start {
		return ""
	}
	return s[start : end+1]
}
