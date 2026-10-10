package devstack

import (
	"context"
	"fmt"
	"sync"

	"github.com/gregidonut/sqldev/packages/cli/internal/tmux"
)

// fakeTmux is an in-memory tmux client for manager tests. It records the order
// of mutating calls so tests can assert sequencing.
type fakeTmux struct {
	mu sync.Mutex

	sessionExists bool
	options       map[string]string // "session\x00name" -> value
	panes         []tmux.Pane
	nextPaneNum   int

	calls      []string
	lockName   string
	locked     bool
	attachMode string // "attach" or "switch"

	hasSessionErr error
	newSessionErr error
	probeFunc     func() // optional hook when ListPanes is used as a probe
}

func newFakeTmux() *fakeTmux {
	return &fakeTmux{options: map[string]string{}, nextPaneNum: 1}
}

func (f *fakeTmux) record(call string) { f.calls = append(f.calls, call) }

func (f *fakeTmux) newPaneID() tmux.PaneID {
	id := tmux.PaneID(fmt.Sprintf("%%%d", f.nextPaneNum))
	f.nextPaneNum++
	return id
}

func (f *fakeTmux) HasSession(_ context.Context, _ string) (bool, error) {
	return f.sessionExists, f.hasSessionErr
}

func (f *fakeTmux) NewSession(_ context.Context, _ tmux.PaneSpec) (tmux.PaneID, error) {
	if f.newSessionErr != nil {
		return "", f.newSessionErr
	}
	f.record("new-session")
	f.sessionExists = true
	id := f.newPaneID()
	f.panes = append(f.panes, tmux.Pane{ID: id})
	return id, nil
}

func (f *fakeTmux) SplitPane(_ context.Context, _ tmux.PaneID, _ tmux.PaneSpec) (tmux.PaneID, error) {
	f.record("split-window")
	id := f.newPaneID()
	f.panes = append(f.panes, tmux.Pane{ID: id})
	return id, nil
}

func (f *fakeTmux) SetPaneTitle(_ context.Context, pane tmux.PaneID, title tmux.ServiceName) error {
	f.record("set-title:" + title.String())
	for i := range f.panes {
		if f.panes[i].ID == pane {
			f.panes[i].Title = title.String()
		}
	}
	return nil
}

func (f *fakeTmux) SetWindowOption(_ context.Context, _, name, value string) error {
	f.record("window-option:" + name + "=" + value)
	return nil
}

func (f *fakeTmux) SetSessionOption(_ context.Context, session, name, value string) error {
	f.options[session+"\x00"+name] = value
	return nil
}

func (f *fakeTmux) SessionOption(_ context.Context, session, name string) (string, error) {
	return f.options[session+"\x00"+name], nil
}

func (f *fakeTmux) SetEnvironment(_ context.Context, _, _, _ string) error   { return nil }
func (f *fakeTmux) UnsetEnvironment(_ context.Context, _, _ string) error     { return nil }

func (f *fakeTmux) ListPanes(_ context.Context, _ string) ([]tmux.Pane, error) {
	if f.probeFunc != nil {
		f.probeFunc()
	}
	return append([]tmux.Pane(nil), f.panes...), nil
}

func (f *fakeTmux) SendInterrupt(_ context.Context, pane tmux.PaneID) error {
	f.record("interrupt:" + string(pane))
	return nil
}

func (f *fakeTmux) KillPane(_ context.Context, pane tmux.PaneID) error {
	f.record("kill-pane:" + string(pane))
	remaining := f.panes[:0]
	for _, p := range f.panes {
		if p.ID != pane {
			remaining = append(remaining, p)
		}
	}
	f.panes = remaining
	return nil
}

func (f *fakeTmux) KillSession(_ context.Context, _ string) error {
	f.record("kill-session")
	f.sessionExists = false
	f.panes = nil
	return nil
}

func (f *fakeTmux) SelectLayout(_ context.Context, _, layout string) error {
	f.record("layout:" + layout)
	return nil
}

func (f *fakeTmux) SelectPane(_ context.Context, _ tmux.PaneID) error { return nil }

func (f *fakeTmux) Attach(_ context.Context, _ string, inside bool) error {
	if inside {
		f.attachMode = "switch"
	} else {
		f.attachMode = "attach"
	}
	return nil
}

func (f *fakeTmux) Lock(_ context.Context, name string) (func() error, error) {
	f.lockName = name
	f.locked = true
	return func() error { f.locked = false; return nil }, nil
}

func (f *fakeTmux) has(call string) bool {
	for _, c := range f.calls {
		if c == call {
			return true
		}
	}
	return false
}

func (f *fakeTmux) indexOf(call string) int {
	for i, c := range f.calls {
		if c == call {
			return i
		}
	}
	return -1
}
