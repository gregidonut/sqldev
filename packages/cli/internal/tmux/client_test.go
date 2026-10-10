package tmux

import (
	"context"
	"strings"
	"testing"

	"github.com/gregidonut/sqldev/packages/cli/internal/process"
)

// fakeRunner records requests and returns scripted stdout/err per tmux subcommand.
type fakeRunner struct {
	requests []process.RunRequest
	// responses maps the first two args (joined by space) to stdout.
	responses map[string]string
	errs      map[string]error
}

func newFakeRunner() *fakeRunner {
	return &fakeRunner{responses: map[string]string{}, errs: map[string]error{}}
}

func (f *fakeRunner) Run(_ context.Context, req process.RunRequest) error {
	f.requests = append(f.requests, req)
	key := req.Args[0]
	if err, ok := f.errs[key]; ok {
		return err
	}
	if out, ok := f.responses[key]; ok && req.Stdout != nil {
		req.Stdout.Write([]byte(out))
	}
	return nil
}

func (f *fakeRunner) last() process.RunRequest {
	return f.requests[len(f.requests)-1]
}

func argvOf(req process.RunRequest) string {
	return req.Program + " " + strings.Join(req.Args, " ")
}

func TestNewSessionRequestsPaneIDAndValidates(t *testing.T) {
	runner := newFakeRunner()
	runner.responses["new-session"] = "%7\n"
	client := NewCLIClient(runner)

	id, err := client.NewSession(context.Background(), PaneSpec{
		Session: "sqldev-dev", Window: "services", Dir: "/repo", Argv: []string{"bin", "a", "b"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if id != "%7" {
		t.Fatalf("id = %q", id)
	}
	got := argvOf(runner.last())
	for _, want := range []string{"new-session -d", "-s sqldev-dev", "-n services", "-P -F #{pane_id}", "-c /repo", "bin a b"} {
		if !strings.Contains(got, want) {
			t.Errorf("argv %q missing %q", got, want)
		}
	}
	if strings.Contains(got, "sh -c") || strings.Contains(got, "bash -c") {
		t.Error("must not use a shell")
	}
}

func TestNewSessionRejectsBadPaneID(t *testing.T) {
	runner := newFakeRunner()
	runner.responses["new-session"] = "services\n" // not a pane id
	client := NewCLIClient(runner)
	if _, err := client.NewSession(context.Background(), PaneSpec{Session: "s", Window: "w"}); err == nil {
		t.Fatal("expected a pane-id validation error")
	}
}

func TestSplitPaneTargetsCapturedID(t *testing.T) {
	runner := newFakeRunner()
	runner.responses["split-window"] = "%9"
	client := NewCLIClient(runner)
	id, err := client.SplitPane(context.Background(), PaneID("%7"), PaneSpec{Dir: "/repo", Argv: []string{"bin"}})
	if err != nil {
		t.Fatal(err)
	}
	if id != "%9" {
		t.Fatalf("id = %q", id)
	}
	got := argvOf(runner.last())
	if !strings.Contains(got, "split-window -t %7") {
		t.Errorf("split did not target %%7: %q", got)
	}
	if strings.Contains(got, "0.1") {
		t.Error("must not target by index")
	}
}

func TestSetPaneTitleByID(t *testing.T) {
	runner := newFakeRunner()
	client := NewCLIClient(runner)
	if err := client.SetPaneTitle(context.Background(), PaneID("%3"), ServiceWorker); err != nil {
		t.Fatal(err)
	}
	got := argvOf(runner.last())
	if !strings.Contains(got, "select-pane -t %3 -T worker") {
		t.Errorf("argv = %q", got)
	}
}

func TestAttachInsideVsOutsideTmux(t *testing.T) {
	runner := newFakeRunner()
	client := NewCLIClient(runner)

	if err := client.Attach(context.Background(), "sqldev-dev", false); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(argvOf(runner.last()), "attach-session -t sqldev-dev") {
		t.Errorf("outside tmux should attach-session: %q", argvOf(runner.last()))
	}

	if err := client.Attach(context.Background(), "sqldev-dev", true); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(argvOf(runner.last()), "switch-client -t sqldev-dev") {
		t.Errorf("inside tmux should switch-client: %q", argvOf(runner.last()))
	}
}

func TestLockUsesSameName(t *testing.T) {
	runner := newFakeRunner()
	client := NewCLIClient(runner)
	unlock, err := client.Lock(context.Background(), "sqldev-lock-sqldev-dev")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(argvOf(runner.last()), "wait-for -L sqldev-lock-sqldev-dev") {
		t.Errorf("lock argv = %q", argvOf(runner.last()))
	}
	if err := unlock(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(argvOf(runner.last()), "wait-for -U sqldev-lock-sqldev-dev") {
		t.Errorf("unlock argv = %q", argvOf(runner.last()))
	}
}

func TestSetWindowOptionRemainOnExit(t *testing.T) {
	runner := newFakeRunner()
	client := NewCLIClient(runner)
	if err := client.SetWindowOption(context.Background(), "sqldev-dev:services", "remain-on-exit", "on"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(argvOf(runner.last()), "set-window-option -t sqldev-dev:services remain-on-exit on") {
		t.Errorf("argv = %q", argvOf(runner.last()))
	}
}

func TestListPanesUsesStableFormat(t *testing.T) {
	runner := newFakeRunner()
	runner.responses["list-panes"] = "%1\tsst\t0\t\n%2\tworker\t1\t1\n"
	client := NewCLIClient(runner)
	panes, err := client.ListPanes(context.Background(), "sqldev-dev:services")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(argvOf(runner.last()), "-F "+paneFormat) {
		t.Errorf("list did not request the stable format: %q", argvOf(runner.last()))
	}
	if len(panes) != 2 {
		t.Fatalf("panes = %d", len(panes))
	}
	if panes[0].ID != "%1" || panes[0].Title != "sst" || panes[0].Dead {
		t.Errorf("pane0 = %+v", panes[0])
	}
	if panes[1].ID != "%2" || !panes[1].Dead || panes[1].DeadStatus != 1 {
		t.Errorf("pane1 = %+v", panes[1])
	}
}

func TestParsePanesRejectsMalformedRows(t *testing.T) {
	if _, err := ParsePanes("%1\tsst"); err == nil { // only 2 fields
		t.Fatal("expected malformed row error")
	}
	if _, err := ParsePanes("notapane\tsst\t0\t0"); err == nil {
		t.Fatal("expected invalid pane id error")
	}
}

func TestParsePanesAcceptsLiveRowWithoutTrailingStatus(t *testing.T) {
	// tmux 3.4 emits a live pane as 3 columns (empty pane_dead_status dropped).
	panes, err := ParsePanes("%1\tworker\t0")
	if err != nil {
		t.Fatal(err)
	}
	if len(panes) != 1 || panes[0].Dead || panes[0].Title != "worker" {
		t.Fatalf("pane = %+v", panes)
	}
}

func TestSessionOptionUnsetReturnsEmpty(t *testing.T) {
	runner := newFakeRunner()
	runner.errs["show-options"] = &process.ExitError{Program: "tmux", Code: 1}
	client := NewCLIClient(runner)
	val, err := client.SessionOption(context.Background(), "sqldev-dev", "@sqldev-managed")
	if err != nil {
		t.Fatal(err)
	}
	if val != "" {
		t.Errorf("val = %q, want empty", val)
	}
}
