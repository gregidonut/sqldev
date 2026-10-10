// Package tmux is an argv-safe wrapper over the tmux CLI used to manage the
// local development session. It never invokes a shell, targets panes by their
// captured pane id, and parses only stable delimiter-based formats.
package tmux

import "fmt"

// PaneID is an opaque tmux pane identifier such as "%3". Using a distinct type
// prevents accidentally passing a session name where a pane id is required.
type PaneID string

// ServiceName is the title of a managed service pane.
type ServiceName string

const (
	ServiceSST    ServiceName = "sst"
	ServiceWorker ServiceName = "worker"
	ServiceImagor ServiceName = "imagor"
)

// Services is the ordered list of managed service panes.
var Services = []ServiceName{ServiceSST, ServiceWorker, ServiceImagor}

// Managed-session option names.
const (
	OptManaged = "@sqldev-managed"
	OptStage   = "@sqldev-stage"
	OptRoot    = "@sqldev-root"
	OptBin     = "@sqldev-bin"
)

// PaneState is the lifecycle state of a service pane derived from tmux.
type PaneState string

const (
	StateRunning PaneState = "running"
	StateExited  PaneState = "exited"
	StateFailed  PaneState = "failed"
	StateMissing PaneState = "missing"
	StateInvalid PaneState = "invalid"
)

// PaneSpec describes a pane to create: its working directory, the exact argv to
// run, the session (for the first pane), and the window.
type PaneSpec struct {
	Session string
	Window  string
	Dir     string
	Argv    []string
}

// Pane is a parsed row from `tmux list-panes`.
type Pane struct {
	ID         PaneID
	Title      string
	Dead       bool
	DeadStatus int
}

func (p PaneID) String() string { return string(p) }

func (s ServiceName) String() string { return string(s) }

// validatePaneID ensures a tmux-reported pane id has the expected form.
func validatePaneID(id string) (PaneID, error) {
	if len(id) < 2 || id[0] != '%' {
		return "", fmt.Errorf("unexpected tmux pane id %q", id)
	}
	for _, r := range id[1:] {
		if r < '0' || r > '9' {
			return "", fmt.Errorf("unexpected tmux pane id %q", id)
		}
	}
	return PaneID(id), nil
}
