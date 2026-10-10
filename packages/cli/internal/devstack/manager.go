package devstack

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/gregidonut/sqldev/packages/cli/internal/config"
	"github.com/gregidonut/sqldev/packages/cli/internal/dev"
	"github.com/gregidonut/sqldev/packages/cli/internal/process"
	"github.com/gregidonut/sqldev/packages/cli/internal/tmux"
)

// imagorContainer is the global Docker container name shared with internal/dev.
const imagorContainer = "sqldev-imagor"

// legacySessions are the exact pre-unification session names that `restart`
// (and `start --cleanup-legacy`) may remove.
var legacySessions = []string{"sqldev-sst-dev", "sqldev-worker", "sqldev-imagor"}

// envAllowlist is refreshed into the managed session before pane creation.
var envAllowlist = []string{
	"PATH", "HOME", "SHELL",
	"AWS_PROFILE", "AWS_REGION",
	"AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
	"CGO_ENABLED", "APP_NAME",
	"IMAGOR_IMAGE", "IMAGOR_SECRET", "IMAGOR_URL", "PROGRESS_URL",
	"DBOS_SYSTEM_DATABASE_URL",
}

// Sleeper lets tests advance readiness/stop waits without real time.
type Sleeper interface {
	Sleep(ctx context.Context, d time.Duration) error
}

// RealSleeper sleeps using a context-aware timer.
type RealSleeper struct{}

// Sleep waits d or until ctx is done.
func (RealSleeper) Sleep(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// Manager owns the local dev tmux lifecycle. It never calls app.EnsureLinked;
// only the panes it launches (and the reset service) acquire links.
type Manager struct {
	Cfg    *config.Config
	Tmux   tmux.Client
	Runner process.Runner
	Sleep  Sleeper

	// CachedBin is the stable executable path detached panes run. It is
	// resolved by the caller via tmux.Materialize before Start.
	CachedBin string
	// Executable is the current running binary used to materialize CachedBin.
	Executable string
	// Out receives human progress output.
	Out io.Writer
}

func (m *Manager) out() io.Writer {
	if m.Out != nil {
		return m.Out
	}
	return os.Stdout
}

func (m *Manager) sleeper() Sleeper {
	if m.Sleep != nil {
		return m.Sleep
	}
	return RealSleeper{}
}

func (m *Manager) windowTarget() string {
	return m.Cfg.Tmux.Session + ":" + m.Cfg.Tmux.Window
}

func (m *Manager) lockName() string {
	return "sqldev-lock-" + m.Cfg.Tmux.Session
}

// isManaged reports whether the existing session carries this stage's and
// root's managed metadata.
func (m *Manager) isManaged(ctx context.Context) (bool, error) {
	session := m.Cfg.Tmux.Session
	managed, err := m.Tmux.SessionOption(ctx, session, tmux.OptManaged)
	if err != nil {
		return false, err
	}
	if managed != "1" {
		return false, nil
	}
	stage, err := m.Tmux.SessionOption(ctx, session, tmux.OptStage)
	if err != nil {
		return false, err
	}
	root, err := m.Tmux.SessionOption(ctx, session, tmux.OptRoot)
	if err != nil {
		return false, err
	}
	return stage == m.Cfg.Stage && root == m.Cfg.Root, nil
}

// Start creates the managed session and all three service panes.
func (m *Manager) Start(ctx context.Context, cleanupLegacy bool) error {
	if err := AssertLocalStage(m.Cfg.Stage); err != nil {
		return err
	}
	unlock, err := m.Tmux.Lock(ctx, m.lockName())
	if err != nil {
		return err
	}
	defer unlock()
	return m.startLocked(ctx, cleanupLegacy)
}

func (m *Manager) startLocked(ctx context.Context, cleanupLegacy bool) error {
	session := m.Cfg.Tmux.Session
	exists, err := m.Tmux.HasSession(ctx, session)
	if err != nil {
		return err
	}
	if exists {
		managed, err := m.isManaged(ctx)
		if err != nil {
			return err
		}
		if !managed {
			return fmt.Errorf("session %q already exists and is not managed by sqldev; refusing to touch it", session)
		}
		return fmt.Errorf("managed session %q already exists; run `sqldev --stage %s dev restart`", session, m.Cfg.Stage)
	}

	if cleanupLegacy {
		if err := m.cleanupLegacy(ctx); err != nil {
			return err
		}
	}

	if m.CachedBin == "" {
		bin, err := tmux.Materialize(m.Cfg.Tmux.CacheDir, m.Executable)
		if err != nil {
			return fmt.Errorf("materialize sqldev binary: %w", err)
		}
		m.CachedBin = bin
	}

	// Create the SST pane as the session's first pane.
	sstPane, err := m.Tmux.NewSession(ctx, tmux.PaneSpec{
		Session: session,
		Window:  m.Cfg.Tmux.Window,
		Dir:     m.Cfg.Root,
		Argv:    m.sstArgv(),
	})
	if err != nil {
		return err
	}
	if err := m.applySessionSetup(ctx); err != nil {
		return err
	}
	if err := m.Tmux.SetPaneTitle(ctx, sstPane, tmux.ServiceSST); err != nil {
		return err
	}

	// Wait for SST to publish linked resources before starting dependents.
	if err := m.waitForLinks(ctx); err != nil {
		fmt.Fprintf(m.out(), "SST did not report linked resources in time: %v\n", err)
		fmt.Fprintf(m.out(), "SST pane left running; inspect with: sqldev --stage %s dev attach\n", m.Cfg.Stage)
		return err
	}

	workerPane, err := m.Tmux.SplitPane(ctx, sstPane, tmux.PaneSpec{Dir: m.Cfg.Root, Argv: m.workerArgv()})
	if err != nil {
		return fmt.Errorf("create worker pane: %w", err)
	}
	if err := m.Tmux.SetPaneTitle(ctx, workerPane, tmux.ServiceWorker); err != nil {
		return err
	}
	imagorPane, err := m.Tmux.SplitPane(ctx, sstPane, tmux.PaneSpec{Dir: m.Cfg.Root, Argv: m.imagorArgv()})
	if err != nil {
		return fmt.Errorf("create imagor pane: %w", err)
	}
	if err := m.Tmux.SetPaneTitle(ctx, imagorPane, tmux.ServiceImagor); err != nil {
		return err
	}

	if err := m.Tmux.SelectLayout(ctx, m.windowTarget(), "tiled"); err != nil {
		return err
	}
	if err := m.Tmux.SelectPane(ctx, sstPane); err != nil {
		return err
	}

	fmt.Fprintf(m.out(), "started %s: sst=%s worker=%s imagor=%s\n", session, sstPane, workerPane, imagorPane)
	fmt.Fprintf(m.out(), "inspect with: sqldev --stage %s dev attach\n", m.Cfg.Stage)
	return nil
}

// applySessionSetup writes managed metadata, remain-on-exit, and the env
// allowlist once the session's first pane exists.
func (m *Manager) applySessionSetup(ctx context.Context) error {
	session := m.Cfg.Tmux.Session
	for name, value := range map[string]string{
		tmux.OptManaged: "1",
		tmux.OptStage:   m.Cfg.Stage,
		tmux.OptRoot:    m.Cfg.Root,
		tmux.OptBin:     m.CachedBin,
	} {
		if err := m.Tmux.SetSessionOption(ctx, session, name, value); err != nil {
			return err
		}
	}
	if err := m.Tmux.SetWindowOption(ctx, m.windowTarget(), "remain-on-exit", "on"); err != nil {
		return err
	}
	return m.refreshEnvironment(ctx)
}

func (m *Manager) refreshEnvironment(ctx context.Context) error {
	session := m.Cfg.Tmux.Session
	for _, name := range envAllowlist {
		value, ok := os.LookupEnv(name)
		if !ok {
			if err := m.Tmux.UnsetEnvironment(ctx, session, name); err != nil {
				return err
			}
			continue
		}
		if err := m.Tmux.SetEnvironment(ctx, session, name, value); err != nil {
			return err
		}
	}
	return nil
}

func (m *Manager) sstArgv() []string {
	return []string{m.CachedBin, "--root", m.Cfg.Root, "--stage", m.Cfg.Stage, "dev", "sst", "--foreground"}
}

func (m *Manager) workerArgv() []string {
	return append(m.baseArgv(), "dev", "worker", "--foreground")
}

func (m *Manager) imagorArgv() []string {
	return append(m.baseArgv(), "dev", "imagor", "--foreground")
}

// baseArgv is the cached binary with root/stage/aws flags that detached panes
// need because they do not inherit the orchestrator's resolved flags.
func (m *Manager) baseArgv() []string {
	argv := []string{m.CachedBin, "--root", m.Cfg.Root, "--stage", m.Cfg.Stage}
	if m.Cfg.AWSProfile != "" {
		argv = append(argv, "--aws-profile", m.Cfg.AWSProfile)
	}
	if m.Cfg.AWSRegion != "" {
		argv = append(argv, "--aws-region", m.Cfg.AWSRegion)
	}
	return argv
}

// waitForLinks polls `dev check-links` in separate subprocesses until success
// or timeout, performing one final probe at the boundary.
func (m *Manager) waitForLinks(ctx context.Context) error {
	deadline := time.Now().Add(m.Cfg.Tmux.StartupTimeout)
	var lastErr error
	for {
		if err := m.probeLinks(ctx); err == nil {
			return nil
		} else {
			lastErr = err
		}
		if time.Now().After(deadline) {
			// Final boundary probe.
			if err := m.probeLinks(ctx); err == nil {
				return nil
			} else {
				lastErr = err
			}
			if lastErr == nil {
				lastErr = errors.New("timed out waiting for linked resources")
			}
			return lastErr
		}
		if err := m.sleeper().Sleep(ctx, m.Cfg.Tmux.PollInterval); err != nil {
			return err
		}
	}
}

func (m *Manager) probeLinks(ctx context.Context) error {
	return m.Runner.Run(ctx, process.RunRequest{
		Program: m.CachedBin,
		Args:    []string{"--root", m.Cfg.Root, "--stage", m.Cfg.Stage, "dev", "check-links"},
		Dir:     m.Cfg.Root,
		Stdout:  io.Discard,
		Stderr:  io.Discard,
	})
}

// Stop gracefully stops the managed session and enforces Imagor cleanup.
func (m *Manager) Stop(ctx context.Context) error {
	if err := AssertLocalStage(m.Cfg.Stage); err != nil {
		return err
	}
	unlock, err := m.Tmux.Lock(ctx, m.lockName())
	if err != nil {
		return err
	}
	defer unlock()
	return m.stopLocked(ctx)
}

func (m *Manager) stopLocked(ctx context.Context) error {
	session := m.Cfg.Tmux.Session
	var errs []error

	exists, err := m.Tmux.HasSession(ctx, session)
	if err != nil {
		errs = append(errs, fmt.Errorf("check session: %w", err))
	}
	if exists {
		managed, err := m.isManaged(ctx)
		if err != nil {
			errs = append(errs, fmt.Errorf("verify managed: %w", err))
		} else if !managed {
			// Never touch an unmanaged same-name session.
			return fmt.Errorf("session %q is not managed by sqldev; refusing to stop it", session)
		} else {
			if panes, err := m.Tmux.ListPanes(ctx, m.windowTarget()); err != nil {
				errs = append(errs, fmt.Errorf("list panes: %w", err))
			} else {
				for _, p := range panes {
					if !p.Dead {
						_ = m.Tmux.SendInterrupt(ctx, p.ID)
					}
				}
				_ = m.sleeper().Sleep(ctx, m.Cfg.Tmux.StopGracePeriod)
			}
			if err := m.Tmux.KillSession(ctx, session); err != nil {
				errs = append(errs, fmt.Errorf("kill session: %w", err))
			}
		}
	}

	// Docker cleanup backstop always runs, even when the session was absent.
	if err := dev.RemoveOwnedImagor(ctx, m.Runner, m.Cfg.Stage); err != nil {
		errs = append(errs, fmt.Errorf("imagor cleanup: %w", err))
	}
	return errors.Join(errs...)
}

// Restart stops then starts under one held lock.
func (m *Manager) Restart(ctx context.Context, cleanupLegacy bool) error {
	if err := AssertLocalStage(m.Cfg.Stage); err != nil {
		return err
	}
	unlock, err := m.Tmux.Lock(ctx, m.lockName())
	if err != nil {
		return err
	}
	defer unlock()
	if err := m.stopLocked(ctx); err != nil {
		return err
	}
	return m.startLocked(ctx, cleanupLegacy)
}

// RestartService replaces exactly one named service pane.
func (m *Manager) RestartService(ctx context.Context, service tmux.ServiceName) error {
	if err := AssertLocalStage(m.Cfg.Stage); err != nil {
		return err
	}
	unlock, err := m.Tmux.Lock(ctx, m.lockName())
	if err != nil {
		return err
	}
	defer unlock()

	session := m.Cfg.Tmux.Session
	exists, err := m.Tmux.HasSession(ctx, session)
	if err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("no managed %s session; run `sqldev --stage %s dev start`", session, m.Cfg.Stage)
	}
	managed, err := m.isManaged(ctx)
	if err != nil {
		return err
	}
	if !managed {
		return fmt.Errorf("session %q is not managed by sqldev; refusing to touch it", session)
	}

	panes, err := m.Tmux.ListPanes(ctx, m.windowTarget())
	if err != nil {
		return err
	}
	var target *tmux.Pane
	var survivor tmux.PaneID
	for i := range panes {
		if panes[i].Title == service.String() {
			if target != nil {
				return fmt.Errorf("found multiple %q panes; restart the whole session", service)
			}
			target = &panes[i]
		} else {
			survivor = panes[i].ID
		}
	}
	if target == nil {
		return fmt.Errorf("no %q pane in session %q", service, session)
	}
	if survivor == "" {
		return fmt.Errorf("cannot replace the only pane; run `sqldev --stage %s dev restart`", m.Cfg.Stage)
	}

	if !target.Dead {
		_ = m.Tmux.SendInterrupt(ctx, target.ID)
		_ = m.sleeper().Sleep(ctx, m.Cfg.Tmux.StopGracePeriod)
	}
	if err := m.Tmux.KillPane(ctx, target.ID); err != nil {
		return err
	}
	if err := m.refreshEnvironment(ctx); err != nil {
		return err
	}

	newPane, err := m.Tmux.SplitPane(ctx, survivor, tmux.PaneSpec{Dir: m.Cfg.Root, Argv: m.serviceArgv(service)})
	if err != nil {
		return err
	}
	if err := m.Tmux.SetPaneTitle(ctx, newPane, service); err != nil {
		return err
	}
	if err := m.Tmux.SelectLayout(ctx, m.windowTarget(), "tiled"); err != nil {
		return err
	}
	if service == tmux.ServiceSST {
		if err := m.waitForLinks(ctx); err != nil {
			fmt.Fprintf(m.out(), "SST restarted but links are not ready; worker/imagor may need `dev restart`: %v\n", err)
		}
	}
	fmt.Fprintf(m.out(), "restarted %s pane: %s\n", service, newPane)
	return nil
}

func (m *Manager) serviceArgv(service tmux.ServiceName) []string {
	switch service {
	case tmux.ServiceSST:
		return m.sstArgv()
	case tmux.ServiceWorker:
		return m.workerArgv()
	case tmux.ServiceImagor:
		return m.imagorArgv()
	default:
		return nil
	}
}

// Attach attaches or switches the current client to the managed session.
func (m *Manager) Attach(ctx context.Context) error {
	session := m.Cfg.Tmux.Session
	exists, err := m.Tmux.HasSession(ctx, session)
	if err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("no managed %s session; run `sqldev --stage %s dev start`", session, m.Cfg.Stage)
	}
	managed, err := m.isManaged(ctx)
	if err != nil {
		return err
	}
	if !managed {
		return fmt.Errorf("session %q is not managed by sqldev; refusing to attach", session)
	}
	insideTmux := os.Getenv("TMUX") != ""
	return m.Tmux.Attach(ctx, session, insideTmux)
}

// cleanupLegacy stops only the exact legacy session names.
func (m *Manager) cleanupLegacy(ctx context.Context) error {
	for _, name := range legacySessions {
		exists, err := m.Tmux.HasSession(ctx, name)
		if err != nil {
			return err
		}
		if !exists {
			continue
		}
		fmt.Fprintf(m.out(), "removing legacy session %s\n", name)
		if panes, err := m.Tmux.ListPanes(ctx, name); err == nil {
			for _, p := range panes {
				if !p.Dead {
					_ = m.Tmux.SendInterrupt(ctx, p.ID)
				}
			}
			_ = m.sleeper().Sleep(ctx, m.Cfg.Tmux.StopGracePeriod)
		}
		if err := m.Tmux.KillSession(ctx, name); err != nil {
			return err
		}
	}
	return dev.RemoveOwnedImagor(ctx, m.Runner, m.Cfg.Stage)
}
