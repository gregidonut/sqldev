package e2ereset

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/gregidonut/sqldev/packages/cli/internal/process"
)

// scriptedRunner answers AWS CLI calls from a queue of canned responses keyed
// by the ssm subcommand, so tests drive send-command and get-command-invocation
// without touching AWS.
type scriptedRunner struct {
	t             *testing.T
	commandID     string
	invocations   []string // sequence of Status values to return
	invokeIdx     int
	stdoutContent string
	lastScript    string
	seenPrograms  []string
}

func (r *scriptedRunner) Run(_ context.Context, req process.RunRequest) error {
	r.seenPrograms = append(r.seenPrograms, req.Program)
	sub := ""
	for i, a := range req.Args {
		if a == "ssm" && i+1 < len(req.Args) {
			sub = req.Args[i+1]
			break
		}
	}
	switch sub {
	case "send-command":
		// capture the script for inspection
		for i, a := range req.Args {
			if a == "--parameters" && i+1 < len(req.Args) {
				r.lastScript = req.Args[i+1]
			}
		}
		if req.Stdout != nil {
			req.Stdout.Write([]byte(r.commandID + "\n"))
		}
		return nil
	case "get-command-invocation":
		status := "Success"
		if r.invokeIdx < len(r.invocations) {
			status = r.invocations[r.invokeIdx]
		}
		r.invokeIdx++
		body := `{"Status":"` + status + `","StandardOutputContent":` + jsonString(r.stdoutContent) + `,"StandardErrorContent":""}`
		if req.Stdout != nil {
			req.Stdout.Write([]byte(body))
		}
		return nil
	}
	return nil
}

func jsonString(s string) string {
	b := strings.ReplaceAll(s, `\`, `\\`)
	b = strings.ReplaceAll(b, `"`, `\"`)
	b = strings.ReplaceAll(b, "\n", `\n`)
	return `"` + b + `"`
}

func testExecutor(r process.Runner) *HostExecutor {
	ex := NewHostExecutor(r, "ap-east-1")
	// Freeze time and make sleep instant.
	ex.now = func() time.Time { return time.Unix(0, 0) }
	ex.sleep = func(context.Context, time.Duration) error { return nil }
	return ex
}

func TestProbeIdentityParsesWhitelistedFields(t *testing.T) {
	r := &scriptedRunner{
		t:             t,
		commandID:     "cmd-1",
		invocations:   []string{"Success"},
		stdoutContent: `{"app_name":"sqldev","stage":"staging","app_bucket":"app","job_result_bucket":"job"}`,
	}
	id, err := testExecutor(r).ProbeIdentity(context.Background(), "i-abc")
	if err != nil {
		t.Fatal(err)
	}
	if id.AppName != "sqldev" || id.Stage != "staging" || id.AppBucket != "app" {
		t.Errorf("identity = %+v", id)
	}
}

func TestExecuteCanonicalSQLRequiresCommitMarker(t *testing.T) {
	ok := &scriptedRunner{commandID: "c", invocations: []string{"Success"}, stdoutContent: "DB_RESET_COMMITTED"}
	res, err := testExecutor(ok).ExecuteCanonicalSQL(context.Background(), "i-abc")
	if err != nil || !res.Committed {
		t.Fatalf("expected commit, got res=%+v err=%v", res, err)
	}
	// The script must carry the embedded canonical SQL, not caller input.
	if !strings.Contains(ok.lastScript, "TRUNCATE TABLE") {
		t.Error("SQL script must contain the embedded canonical TRUNCATE")
	}

	missing := &scriptedRunner{commandID: "c", invocations: []string{"Success"}, stdoutContent: "nope"}
	if _, err := testExecutor(missing).ExecuteCanonicalSQL(context.Background(), "i-abc"); err == nil {
		t.Error("expected error when commit marker is absent")
	}
}

func TestPollHandlesInProgressThenSuccess(t *testing.T) {
	r := &scriptedRunner{
		commandID:     "c",
		invocations:   []string{"Pending", "InProgress", "Success"},
		stdoutContent: "WORKER_STOPPED",
	}
	if err := testExecutor(r).QuiesceWorker(context.Background(), "i-abc"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestPollSurfacesFailedStatus(t *testing.T) {
	r := &scriptedRunner{commandID: "c", invocations: []string{"Failed"}, stdoutContent: ""}
	if err := testExecutor(r).QuiesceWorker(context.Background(), "i-abc"); err == nil {
		t.Error("expected failure for a Failed SSM status")
	}
}

func TestDiscoverStagingHostRequiresExactlyOne(t *testing.T) {
	one := &fixedRunner{output: `{"Reservations":[{"Instances":[{"InstanceId":"i-111","Tags":[{"Key":"Name","Value":"sqldev-staging-supabase"},{"Key":"Application","Value":"sqldev"},{"Key":"Stage","Value":"staging"}]}]}]}`}
	d := &HostDiscoverer{Runner: one, Region: "ap-east-1"}
	host, err := d.ResolveStagingHost(context.Background(), "sqldev")
	if err != nil {
		t.Fatal(err)
	}
	if host.InstanceID != "i-111" || host.StageTag != "staging" {
		t.Errorf("host = %+v", host)
	}

	none := &fixedRunner{output: `{"Reservations":[]}`}
	if _, err := (&HostDiscoverer{Runner: none, Region: "ap-east-1"}).ResolveStagingHost(context.Background(), "sqldev"); err == nil {
		t.Error("expected error when no host matches")
	}

	two := &fixedRunner{output: `{"Reservations":[{"Instances":[{"InstanceId":"i-1","Tags":[]},{"InstanceId":"i-2","Tags":[]}]}]}`}
	if _, err := (&HostDiscoverer{Runner: two, Region: "ap-east-1"}).ResolveStagingHost(context.Background(), "sqldev"); err == nil {
		t.Error("expected error when more than one host matches")
	}
}

func TestWaitReadyAcceptsReadyMarker(t *testing.T) {
	runner := &readyRunner{outputs: []string{"HOST_READY\n"}}
	ex := testExecutor(runner)
	if err := ex.WaitReady(context.Background(), "i-abc123"); err != nil {
		t.Fatal(err)
	}
	if len(runner.scripts) != 1 || !strings.Contains(runner.scripts[0], "pg_isready") {
		t.Fatalf("script = %v", runner.scripts)
	}
	for _, want := range []string{"sqldev-imagor.service", "sqldev-worker.service", "HOST_NOT_READY", "HOST_READY"} {
		if !strings.Contains(runner.scripts[0], want) {
			t.Fatalf("readiness script missing %s", want)
		}
	}
	if strings.Contains(runner.scripts[0], "i-abc123") {
		t.Fatal("readiness script must not interpolate the instance id")
	}
}

func TestWaitReadyRetriesUntilReady(t *testing.T) {
	runner := &readyRunner{outputs: []string{"HOST_NOT_READY\n", "HOST_READY\n"}}
	ex := testExecutor(runner)
	if err := ex.WaitReady(context.Background(), "i-abc123"); err != nil {
		t.Fatal(err)
	}
	if len(runner.scripts) != 2 {
		t.Fatalf("attempts = %d", len(runner.scripts))
	}
}

func TestWaitReadyTimesOut(t *testing.T) {
	runner := &readyRunner{outputs: []string{"HOST_NOT_READY\n"}}
	ex := testExecutor(runner)
	now := time.Unix(0, 0)
	ex.now = func() time.Time { return now }
	ex.sleep = func(context.Context, time.Duration) error {
		now = now.Add(ex.readyInterval)
		return nil
	}
	ex.readyBudget = 10 * time.Second
	ex.readyInterval = 5 * time.Second
	if err := ex.WaitReady(context.Background(), "i-abc123"); err == nil || !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("error = %v", err)
	}
}

func TestWaitReadyRejectsInvalidInstance(t *testing.T) {
	runner := &readyRunner{}
	if err := testExecutor(runner).WaitReady(context.Background(), "instance-1"); err == nil {
		t.Fatal("expected invalid instance id to be refused")
	}
	if len(runner.scripts) != 0 {
		t.Fatal("invalid instance id reached SSM")
	}
}

// readyRunner returns a different SSM stdout for each send-command.
type readyRunner struct {
	scripts []string
	outputs []string
	index   int
	pending string
}

func (r *readyRunner) Run(_ context.Context, req process.RunRequest) error {
	sub := ""
	for i, arg := range req.Args {
		if arg == "ssm" && i+1 < len(req.Args) {
			sub = req.Args[i+1]
		}
	}
	switch sub {
	case "send-command":
		for i, arg := range req.Args {
			if arg == "--parameters" && i+1 < len(req.Args) {
				r.scripts = append(r.scripts, req.Args[i+1])
			}
		}
		r.pending = "HOST_NOT_READY\n"
		if r.index < len(r.outputs) {
			r.pending = r.outputs[r.index]
		}
		r.index++
		if req.Stdout != nil {
			_, _ = req.Stdout.Write([]byte("cmd-1\n"))
		}
	case "get-command-invocation":
		body := `{"Status":"Success","StandardOutputContent":` + jsonString(r.pending) + `,"StandardErrorContent":""}`
		if req.Stdout != nil {
			_, _ = req.Stdout.Write([]byte(body))
		}
	}
	return nil
}

// fixedRunner always writes the same stdout.
type fixedRunner struct{ output string }

func (f *fixedRunner) Run(_ context.Context, req process.RunRequest) error {
	if req.Stdout != nil {
		req.Stdout.Write([]byte(f.output))
	}
	return nil
}

// Property 14: Go Diagnostics Exclude Sensitive Values.
// Feature: stage-aware-cypress-harness, Property 14: Go Diagnostics Exclude Sensitive Values
func TestProperty14GoDiagnosticsExcludeSensitiveValues(t *testing.T) {
	// A SensitiveString-like credential must never appear in reset diagnostics.
	// We assert the canonical SQL / scripts never embed a password placeholder
	// value, and that plan errors are category-only.
	in := validInputs()
	in.ConfiguredStage = "dev" // force rejection
	_, err := BuildResetPlan(in)
	if err == nil {
		t.Fatal("expected rejection")
	}
	for _, sentinel := range []string{"POSTGRES_PASSWORD=", "secret", "gregosilaja"} {
		if strings.Contains(err.Error(), sentinel) {
			t.Errorf("plan error leaked %q: %s", sentinel, err.Error())
		}
	}
	// The SQL execution script references the password only by env expansion,
	// never a literal value.
	r := &scriptedRunner{commandID: "c", invocations: []string{"Success"}, stdoutContent: "DB_RESET_COMMITTED"}
	_, _ = testExecutor(r).ExecuteCanonicalSQL(context.Background(), "i-abc")
	if strings.Contains(r.lastScript, "PGPASSWORD=\"literal") {
		t.Error("script must not embed a literal password")
	}
	// The script is JSON-escaped inside --parameters, so match the env
	// expansion without assuming the quote representation.
	if !strings.Contains(r.lastScript, "PGPASSWORD=") ||
		!strings.Contains(r.lastScript, "POSTGRES_PASSWORD") {
		t.Error("script must expand the password from the host environment only")
	}
}
