package tmux

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"testing"

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
