package tmux

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"testing"
	"time"

	"github.com/gregidonut/sqldev/packages/cli/internal/process"
)

// socketRunner forces every tmux invocation onto a private server socket so the
// integration test can never touch a developer's real tmux sessions.
type socketRunner struct {
	socket string
}

func (r socketRunner) Run(ctx context.Context, req process.RunRequest) error {
	if req.Program != "tmux" {
		return process.OSRunner{}.Run(ctx, req)
	}
	args := append([]string{"-L", r.socket}, req.Args...)
	return process.OSRunner{}.Run(ctx, process.RunRequest{
		Program: "tmux",
		Args:    args,
		Dir:     req.Dir,
		Env:     req.Env,
		Stdin:   req.Stdin,
		Stdout:  req.Stdout,
		Stderr:  req.Stderr,
	})
}

func TestIntegrationSessionLifecycle(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available")
	}
	socket := fmt.Sprintf("sqldev-test-%d", os.Getpid())
	runner := socketRunner{socket: socket}
	client := NewCLIClient(runner)
	ctx := context.Background()

	t.Cleanup(func() {
		_ = process.OSRunner{}.Run(ctx, process.RunRequest{
			Program: "tmux", Args: []string{"-L", socket, "kill-server"},
		})
	})

	session := "sqldev-itest"
	// Harmless long-lived fixture command.
	sst, err := client.NewSession(ctx, PaneSpec{
		Session: session, Window: "services",
		Argv: []string{"sh", "-c", "sleep 300"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := client.SetWindowOption(ctx, session+":services", "remain-on-exit", "on"); err != nil {
		t.Fatal(err)
	}
	if err := client.SetPaneTitle(ctx, sst, ServiceSST); err != nil {
		t.Fatal(err)
	}
	worker, err := client.SplitPane(ctx, sst, PaneSpec{Argv: []string{"sh", "-c", "sleep 300"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := client.SetPaneTitle(ctx, worker, ServiceWorker); err != nil {
		t.Fatal(err)
	}
	if err := client.SelectLayout(ctx, session+":services", "tiled"); err != nil {
		t.Fatal(err)
	}

	exists, err := client.HasSession(ctx, session)
	if err != nil || !exists {
		t.Fatalf("session should exist: exists=%v err=%v", exists, err)
	}

	panes, err := client.ListPanes(ctx, session+":services")
	if err != nil {
		t.Fatal(err)
	}
	if len(panes) != 2 {
		t.Fatalf("expected 2 panes, got %d", len(panes))
	}

	// Managed metadata round-trips.
	if err := client.SetSessionOption(ctx, session, OptManaged, "1"); err != nil {
		t.Fatal(err)
	}
	val, err := client.SessionOption(ctx, session, OptManaged)
	if err != nil || val != "1" {
		t.Fatalf("managed option = %q err=%v", val, err)
	}
	// Unset option returns empty, not an error.
	missing, err := client.SessionOption(ctx, session, "@sqldev-nope")
	if err != nil || missing != "" {
		t.Fatalf("unset option = %q err=%v", missing, err)
	}

	if err := client.KillSession(ctx, session); err != nil {
		t.Fatal(err)
	}
	exists, err = client.HasSession(ctx, session)
	if err != nil {
		t.Fatal(err)
	}
	if exists {
		t.Error("session should be gone after kill")
	}
}

// TestIntegrationFirstPaneReceivesEnvAtSpawn runs real tmux on a private socket
// and proves the bug the dev orchestrator hit: a session variable written after
// new-session never reaches the first pane, but PaneSpec.Env does. Panes
// created later receive the session environment.
func TestIntegrationFirstPaneReceivesEnvAtSpawn(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available")
	}
	socket := fmt.Sprintf("sqldev-test-env-%d", os.Getpid())
	client := NewCLIClient(socketRunner{socket: socket})
	ctx := context.Background()
	t.Cleanup(func() {
		_ = process.OSRunner{}.Run(ctx, process.RunRequest{
			Program: "tmux", Args: []string{"-L", socket, "kill-server"},
		})
	})

	dir := t.TempDir()
	dump := func(name string) []string {
		return []string{"sh", "-c", fmt.Sprintf("printf '%%s' \"$SQLDEV_PROBE\" > %s/%s; sleep 300", dir, name)}
	}
	session := "sqldev-itest-env"

	// First pane: variable only in the session environment, written after the
	// pane process was spawned (the old behaviour) ...
	lateSession := session + "-late"
	if _, err := client.NewSession(ctx, PaneSpec{Session: lateSession, Window: "w", Argv: dump("late")}); err != nil {
		t.Fatal(err)
	}
	if err := client.SetEnvironment(ctx, lateSession, "SQLDEV_PROBE", "from-session"); err != nil {
		t.Fatal(err)
	}

	// ... versus the variable passed in PaneSpec.Env, then also set on the
	// session for the panes created afterwards (the fixed behaviour).
	first, err := client.NewSession(ctx, PaneSpec{
		Session: session, Window: "w", Argv: dump("first"),
		Env: []string{"SQLDEV_PROBE=from-spec"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := client.SetEnvironment(ctx, session, "SQLDEV_PROBE", "from-session"); err != nil {
		t.Fatal(err)
	}
	if _, err := client.SplitPane(ctx, first, PaneSpec{Argv: dump("second")}); err != nil {
		t.Fatal(err)
	}

	read := func(name string) string {
		t.Helper()
		var last string
		for i := 0; i < 50; i++ {
			if b, err := os.ReadFile(dir + "/" + name); err == nil {
				return string(b)
			}
			last = "<file not written>"
			time.Sleep(100 * time.Millisecond)
		}
		return last
	}

	if got := read("late"); got != "" {
		t.Errorf("first pane spawned before set-environment saw SQLDEV_PROBE=%q; tmux semantics changed, revisit the fix", got)
	}
	if got := read("first"); got != "from-spec" {
		t.Errorf("first pane SQLDEV_PROBE = %q, want from-spec", got)
	}
	if got := read("second"); got != "from-session" {
		t.Errorf("later pane SQLDEV_PROBE = %q, want from-session", got)
	}
}
