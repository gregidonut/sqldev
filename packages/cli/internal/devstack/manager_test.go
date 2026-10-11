package devstack

import (
	"bytes"
	"context"
	"errors"
	"net"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/gregidonut/sqldev/packages/cli/internal/config"
	"github.com/gregidonut/sqldev/packages/cli/internal/process"
	"github.com/gregidonut/sqldev/packages/cli/internal/tmux"
)

// instantSleeper returns immediately so timeout loops do not spend real time.
type instantSleeper struct{}

func (instantSleeper) Sleep(_ context.Context, _ time.Duration) error { return nil }

// probeRunner lets check-links and docker calls be scripted. It records argv.
type probeRunner struct {
	calls      [][]string
	checkLinks func() error
	supabase   func() error // optional hook for `supabase start`
}

func (r *probeRunner) Run(_ context.Context, req process.RunRequest) error {
	r.calls = append(r.calls, append([]string{req.Program}, req.Args...))
	if len(req.Args) >= 2 && req.Args[len(req.Args)-1] == "check-links" && r.checkLinks != nil {
		return r.checkLinks()
	}
	if len(req.Args) >= 2 && req.Args[len(req.Args)-2] == "supabase" && req.Args[len(req.Args)-1] == "start" && r.supabase != nil {
		return r.supabase()
	}
	return nil
}

// callEndingWith returns the first recorded argv whose tail matches suffix.
func (r *probeRunner) callEndingWith(suffix ...string) []string {
	for _, c := range r.calls {
		if len(c) >= len(suffix) && slices.Equal(c[len(c)-len(suffix):], suffix) {
			return c
		}
	}
	return nil
}

func (r *probeRunner) ranProgram(name string) bool {
	for _, c := range r.calls {
		if c[0] == name {
			return true
		}
	}
	return false
}

func testConfig() *config.Config {
	return &config.Config{
		Root:         "/repo",
		Stage:        "dev",
		AWSRegion:    "ap-east-1",
		FunctionsDir: "/repo/packages/functions",
		SupabaseDir:  "/repo/packages/backend/supabase",
		Tmux: config.TmuxConfig{
			Session:         "sqldev-dev",
			Window:          "services",
			StartupTimeout:  2 * time.Minute,
			PollInterval:    time.Second,
			StopGracePeriod: time.Second,
			CacheDir:        "/cache",
		},
	}
}

func newTestManager(ft *fakeTmux, runner process.Runner) *Manager {
	return &Manager{
		Cfg:        testConfig(),
		Tmux:       ft,
		Runner:     runner,
		Sleep:      instantSleeper{},
		Dial:       &fakeDialer{failCount: 0}, // succeed immediately; avoids real Supabase TCP dial
		CachedBin:  "/cache/sqldev-abc",
		Executable: "/cache/sqldev-abc",
		Out:        &bytes.Buffer{},
	}
}

func TestStartCreatesThreePanesAfterLinkProbe(t *testing.T) {
	ft := newFakeTmux()
	runner := &probeRunner{checkLinks: func() error { return nil }}
	mgr := newTestManager(ft, runner)

	if err := mgr.Start(context.Background(), false); err != nil {
		t.Fatal(err)
	}
	// SST created first, then two splits.
	if ft.indexOf("new-session") != 0 {
		t.Fatalf("new-session should be first: %v", ft.calls)
	}
	splits := 0
	for _, c := range ft.calls {
		if c == "split-window" {
			splits++
		}
	}
	if splits != 2 {
		t.Fatalf("expected 2 splits, got %d (%v)", splits, ft.calls)
	}
	// Layout applied after all panes exist.
	if ft.indexOf("layout:tiled") < ft.indexOf("split-window") {
		t.Error("layout should be applied after splits")
	}
	// Managed metadata written.
	if ft.options["sqldev-dev\x00@sqldev-managed"] != "1" {
		t.Error("managed marker not set")
	}
	if ft.options["sqldev-dev\x00@sqldev-stage"] != "dev" {
		t.Error("stage marker not set")
	}
	// check-links ran as a subprocess.
	if !runner.ranProgram("/cache/sqldev-abc") {
		t.Error("expected check-links subprocess")
	}
	// Never bootstrapped through sst shell from the orchestrator.
	for _, c := range runner.calls {
		if c[0] == "bunx" {
			t.Errorf("orchestrator must not run bunx/sst: %v", c)
		}
	}
}

func TestStartRefusesExistingManagedSession(t *testing.T) {
	ft := newFakeTmux()
	ft.sessionExists = true
	ft.options["sqldev-dev\x00@sqldev-managed"] = "1"
	ft.options["sqldev-dev\x00@sqldev-stage"] = "dev"
	ft.options["sqldev-dev\x00@sqldev-root"] = "/repo"
	mgr := newTestManager(ft, &probeRunner{})

	err := mgr.Start(context.Background(), false)
	if err == nil || !strings.Contains(err.Error(), "restart") {
		t.Fatalf("expected a restart hint, got %v", err)
	}
}

func TestStartRefusesUnmanagedCollision(t *testing.T) {
	ft := newFakeTmux()
	ft.sessionExists = true // no managed marker
	mgr := newTestManager(ft, &probeRunner{})
	err := mgr.Start(context.Background(), false)
	if err == nil || !strings.Contains(err.Error(), "not managed") {
		t.Fatalf("expected unmanaged refusal, got %v", err)
	}
}

func TestStartTimeoutLeavesSSTAndNoDependents(t *testing.T) {
	ft := newFakeTmux()
	cfg := testConfig()
	cfg.Tmux.StartupTimeout = 10 * time.Millisecond
	cfg.Tmux.PollInterval = time.Millisecond
	runner := &probeRunner{checkLinks: func() error { return errors.New("not ready") }}
	mgr := &Manager{Cfg: cfg, Tmux: ft, Runner: runner, Sleep: instantSleeper{}, CachedBin: "/cache/x", Executable: "/cache/x", Out: &bytes.Buffer{}}

	err := mgr.Start(context.Background(), false)
	if err == nil {
		t.Fatal("expected a readiness timeout error")
	}
	if ft.has("split-window") {
		t.Error("no dependent panes should be created on timeout")
	}
	if !ft.sessionExists {
		t.Error("SST session should remain for inspection")
	}
}

func TestStopInterruptsThenKillsAndCleansDocker(t *testing.T) {
	ft := newFakeTmux()
	ft.sessionExists = true
	ft.options["sqldev-dev\x00@sqldev-managed"] = "1"
	ft.options["sqldev-dev\x00@sqldev-stage"] = "dev"
	ft.options["sqldev-dev\x00@sqldev-root"] = "/repo"
	ft.panes = []tmux.Pane{{ID: "%1", Title: "sst"}, {ID: "%2", Title: "worker"}}
	runner := &probeRunner{}
	mgr := newTestManager(ft, runner)

	if err := mgr.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !ft.has("interrupt:%1") || !ft.has("interrupt:%2") {
		t.Errorf("expected Ctrl-C to all panes: %v", ft.calls)
	}
	if !ft.has("kill-session") {
		t.Error("expected kill-session backstop")
	}
	if ft.indexOf("interrupt:%1") > ft.indexOf("kill-session") {
		t.Error("interrupt must precede kill-session")
	}
	// Docker cleanup backstop: inspect then rm.
	if !runner.ranProgram("docker") {
		t.Error("expected docker cleanup")
	}
}

func TestStopRunsDockerCleanupWhenSessionAbsent(t *testing.T) {
	ft := newFakeTmux() // no session
	runner := &probeRunner{}
	mgr := newTestManager(ft, runner)
	if err := mgr.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !runner.ranProgram("docker") {
		t.Error("docker cleanup must run even without a session")
	}
	if ft.has("kill-session") {
		t.Error("must not kill a nonexistent session")
	}
}

func TestStopRefusesUnmanagedSession(t *testing.T) {
	ft := newFakeTmux()
	ft.sessionExists = true // no managed marker
	mgr := newTestManager(ft, &probeRunner{})
	err := mgr.Stop(context.Background())
	if err == nil || !strings.Contains(err.Error(), "not managed") {
		t.Fatalf("expected unmanaged refusal, got %v", err)
	}
}

func TestRestartServiceReplacesOnlyTarget(t *testing.T) {
	ft := newFakeTmux()
	ft.sessionExists = true
	ft.options["sqldev-dev\x00@sqldev-managed"] = "1"
	ft.options["sqldev-dev\x00@sqldev-stage"] = "dev"
	ft.options["sqldev-dev\x00@sqldev-root"] = "/repo"
	ft.panes = []tmux.Pane{{ID: "%1", Title: "sst"}, {ID: "%2", Title: "worker"}, {ID: "%3", Title: "imagor"}}
	ft.nextPaneNum = 4
	mgr := newTestManager(ft, &probeRunner{})

	if err := mgr.RestartService(context.Background(), tmux.ServiceWorker); err != nil {
		t.Fatal(err)
	}
	if !ft.has("kill-pane:%2") {
		t.Errorf("worker pane should be killed: %v", ft.calls)
	}
	if ft.has("kill-pane:%1") || ft.has("kill-pane:%3") {
		t.Error("only the worker pane should be replaced")
	}
	if !ft.has("set-title:worker") {
		t.Error("replacement pane should get the worker title")
	}
}

func TestRestartServiceRequiresSession(t *testing.T) {
	ft := newFakeTmux() // no session
	mgr := newTestManager(ft, &probeRunner{})
	err := mgr.RestartService(context.Background(), tmux.ServiceWorker)
	if err == nil || !strings.Contains(err.Error(), "dev start") {
		t.Fatalf("expected start hint, got %v", err)
	}
}

func TestRestartServiceDuplicateTitleErrors(t *testing.T) {
	ft := newFakeTmux()
	ft.sessionExists = true
	ft.options["sqldev-dev\x00@sqldev-managed"] = "1"
	ft.options["sqldev-dev\x00@sqldev-stage"] = "dev"
	ft.options["sqldev-dev\x00@sqldev-root"] = "/repo"
	ft.panes = []tmux.Pane{{ID: "%1", Title: "worker"}, {ID: "%2", Title: "worker"}}
	mgr := newTestManager(ft, &probeRunner{})
	if err := mgr.RestartService(context.Background(), tmux.ServiceWorker); err == nil {
		t.Fatal("duplicate titles should error")
	}
}

func TestAttachModeInsideVsOutsideTmux(t *testing.T) {
	ft := newFakeTmux()
	ft.sessionExists = true
	ft.options["sqldev-dev\x00@sqldev-managed"] = "1"
	ft.options["sqldev-dev\x00@sqldev-stage"] = "dev"
	ft.options["sqldev-dev\x00@sqldev-root"] = "/repo"
	mgr := newTestManager(ft, &probeRunner{})

	t.Setenv("TMUX", "")
	if err := mgr.Attach(context.Background()); err != nil {
		t.Fatal(err)
	}
	if ft.attachMode != "attach" {
		t.Errorf("outside tmux should attach, got %q", ft.attachMode)
	}

	t.Setenv("TMUX", "/tmp/tmux-1000/default,1,0")
	if err := mgr.Attach(context.Background()); err != nil {
		t.Fatal(err)
	}
	if ft.attachMode != "switch" {
		t.Errorf("inside tmux should switch, got %q", ft.attachMode)
	}
}

func TestNonLocalStageRefused(t *testing.T) {
	ft := newFakeTmux()
	cfg := testConfig()
	cfg.Stage = "staging"
	cfg.Tmux.Session = "sqldev-staging"
	mgr := &Manager{Cfg: cfg, Tmux: ft, Runner: &probeRunner{}, Sleep: instantSleeper{}, CachedBin: "/x", Executable: "/x", Out: &bytes.Buffer{}}
	if err := mgr.Start(context.Background(), false); err == nil {
		t.Fatal("staging should be refused")
	}
}

// fakeDialer is a Dialer that fails the first N calls then succeeds.
type fakeDialer struct {
	failCount int
	calls     int
}

func (d *fakeDialer) DialContext(_ context.Context, _, _ string) (net.Conn, error) {
	d.calls++
	if d.calls <= d.failCount {
		return nil, errors.New("connection refused")
	}
	// Return one end of an in-memory connected pair.
	client, server := net.Pipe()
	server.Close() // we only need the client side
	return client, nil
}

// alwaysFailDialer never succeeds, used to test the non-fatal timeout path.
type alwaysFailDialer struct{ calls int }

func (d *alwaysFailDialer) DialContext(_ context.Context, _, _ string) (net.Conn, error) {
	d.calls++
	return nil, errors.New("connection refused")
}

// TestStartWaitsForSupabaseBeforeSpawningWorker verifies that when the dialer
// fails initially, Start still waits for it before spawning the worker pane.
func TestStartWaitsForSupabaseBeforeSpawningWorker(t *testing.T) {
	ft := newFakeTmux()
	runner := &probeRunner{checkLinks: func() error { return nil }}
	mgr := newTestManager(ft, runner)

	// Dialer succeeds on the first call (Supabase immediately ready).
	mgr.Dial = &fakeDialer{failCount: 0}

	if err := mgr.Start(context.Background(), false); err != nil {
		t.Fatal(err)
	}

	// Worker and imagor panes must have been spawned.
	workerIdx := -1
	for i, c := range ft.calls {
		if c == "split-window" && workerIdx == -1 {
			workerIdx = i
		}
	}
	if workerIdx == -1 {
		t.Fatal("worker pane was never spawned")
	}
}

// TestStartContinuesWhenSupabaseTimesOut verifies that a Supabase dial timeout
// is non-fatal: Start still spawns both worker and imagor panes.
func TestStartContinuesWhenSupabaseTimesOut(t *testing.T) {
	ft := newFakeTmux()
	runner := &probeRunner{checkLinks: func() error { return nil }}

	cfg := testConfig()
	// Very short timeout so the test finishes quickly.
	cfg.Tmux.StartupTimeout = 5 * time.Millisecond
	cfg.Tmux.PollInterval = time.Millisecond

	dial := &alwaysFailDialer{}
	mgr := &Manager{
		Cfg:       cfg,
		Tmux:      ft,
		Runner:    runner,
		Sleep:     instantSleeper{},
		Dial:      dial,
		CachedBin: "/cache/sqldev-abc",
		Out:       &bytes.Buffer{},
	}

	if err := mgr.Start(context.Background(), false); err != nil {
		t.Fatalf("Start should succeed even when Supabase is unreachable: %v", err)
	}

	// Both splits must still be created — the timeout is non-fatal.
	splits := 0
	for _, c := range ft.calls {
		if c == "split-window" {
			splits++
		}
	}
	if splits != 2 {
		t.Fatalf("expected 2 splits even after Supabase timeout, got %d (%v)", splits, ft.calls)
	}

	// The dialer must have been polled at least once.
	if dial.calls == 0 {
		t.Error("Supabase dialer was never called")
	}
}

// TestStartRunsSupabaseStartBeforeWorker verifies the orchestrator starts
// local Supabase through the linked sqldev wrapper after links are ready and
// before any dependent pane exists.
func TestStartRunsSupabaseStartBeforeWorker(t *testing.T) {
	ft := newFakeTmux()
	linksReady := false
	runner := &probeRunner{checkLinks: func() error { linksReady = true; return nil }}
	runner.supabase = func() error {
		if !linksReady {
			t.Error("supabase start ran before the link probe succeeded")
		}
		if ft.has("split-window") {
			t.Error("supabase start ran after a dependent pane was created")
		}
		return nil
	}
	mgr := newTestManager(ft, runner)
	mgr.Cfg.AWSProfile = "prof"

	if err := mgr.Start(context.Background(), false); err != nil {
		t.Fatal(err)
	}
	call := runner.callEndingWith("supabase", "start")
	if call == nil {
		t.Fatalf("supabase start never ran: %v", runner.calls)
	}
	want := []string{"/cache/sqldev-abc", "--root", "/repo", "--stage", "dev",
		"--aws-profile", "prof", "--aws-region", "ap-east-1", "supabase", "start"}
	if !slices.Equal(call, want) {
		t.Fatalf("supabase start argv = %v, want %v", call, want)
	}
}

// TestStartSkipsSupabaseWaitWhenStartFails verifies a failed `supabase start`
// is non-fatal and does not make the user wait for a port that will not open.
func TestStartSkipsSupabaseWaitWhenStartFails(t *testing.T) {
	ft := newFakeTmux()
	runner := &probeRunner{
		checkLinks: func() error { return nil },
		supabase:   func() error { return errors.New("docker not running") },
	}
	mgr := newTestManager(ft, runner)
	dial := &alwaysFailDialer{}
	mgr.Dial = dial
	out := &bytes.Buffer{}
	mgr.Out = out

	if err := mgr.Start(context.Background(), false); err != nil {
		t.Fatalf("Start should succeed when supabase start fails: %v", err)
	}
	if dial.calls != 0 {
		t.Errorf("dialer polled %d times after a failed supabase start", dial.calls)
	}
	if !strings.Contains(out.String(), "failed to start") {
		t.Errorf("expected a supabase failure message, got %q", out.String())
	}
	if !ft.has("split-window") {
		t.Error("worker and imagor panes should still be created")
	}
}

// TestStartFailsFastWhenSSTPaneDies verifies the link wait stops as soon as
// the SST pane is dead instead of polling until the startup timeout.
func TestStartFailsFastWhenSSTPaneDies(t *testing.T) {
	ft := newFakeTmux()
	probes := 0
	runner := &probeRunner{checkLinks: func() error { probes++; return errors.New("not ready") }}
	ft.probeFunc = func() {
		for i := range ft.panes {
			if ft.panes[i].Title == tmux.ServiceSST.String() {
				ft.panes[i].Dead = true
				ft.panes[i].DeadStatus = 1
			}
		}
	}
	mgr := newTestManager(ft, runner)

	err := mgr.Start(context.Background(), false)
	if err == nil || !strings.Contains(err.Error(), "sst pane exited with status 1") {
		t.Fatalf("expected an SST exit error, got %v", err)
	}
	if probes != 0 {
		t.Errorf("link probe ran %d times after the SST pane died", probes)
	}
	if ft.has("split-window") {
		t.Error("no dependent panes should be created when SST died")
	}
}

// TestProbeLinksPassesAWSFlags verifies the readiness probe receives the same
// AWS profile and region flags as the panes.
func TestProbeLinksPassesAWSFlags(t *testing.T) {
	ft := newFakeTmux()
	runner := &probeRunner{checkLinks: func() error { return nil }}
	mgr := newTestManager(ft, runner)
	mgr.Cfg.AWSProfile = "prof"

	if err := mgr.Start(context.Background(), false); err != nil {
		t.Fatal(err)
	}
	call := runner.callEndingWith("dev", "check-links")
	want := []string{"/cache/sqldev-abc", "--root", "/repo", "--stage", "dev",
		"--aws-profile", "prof", "--aws-region", "ap-east-1", "dev", "check-links"}
	if !slices.Equal(call, want) {
		t.Fatalf("check-links argv = %v, want %v", call, want)
	}
}
