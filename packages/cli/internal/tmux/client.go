package tmux

import (
	"bytes"
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/gregidonut/sqldev/packages/cli/internal/process"
)

// Client is the tmux operations the dev orchestrator needs. It is an interface
// so the manager can be tested against a fake.
type Client interface {
	HasSession(ctx context.Context, name string) (bool, error)
	NewSession(ctx context.Context, spec PaneSpec) (PaneID, error)
	SplitPane(ctx context.Context, target PaneID, spec PaneSpec) (PaneID, error)
	SetPaneTitle(ctx context.Context, pane PaneID, title ServiceName) error
	SetWindowOption(ctx context.Context, target, name, value string) error
	SetSessionOption(ctx context.Context, session, name, value string) error
	SessionOption(ctx context.Context, session, name string) (string, error)
	SetEnvironment(ctx context.Context, session, name, value string) error
	UnsetEnvironment(ctx context.Context, session, name string) error
	ListPanes(ctx context.Context, target string) ([]Pane, error)
	SendInterrupt(ctx context.Context, pane PaneID) error
	KillPane(ctx context.Context, pane PaneID) error
	KillSession(ctx context.Context, session string) error
	SelectLayout(ctx context.Context, target, layout string) error
	SelectPane(ctx context.Context, pane PaneID) error
	Attach(ctx context.Context, session string, insideTmux bool) error
	Lock(ctx context.Context, name string) (func() error, error)
}

// paneFormat is the stable list-panes format: id, title, dead flag, dead status.
const paneFormat = "#{pane_id}\t#{pane_title}\t#{pane_dead}\t#{pane_dead_status}"

// CLIClient is the real tmux client. It runs the external `tmux` binary through
// the shared process runner and never uses a shell.
type CLIClient struct {
	Runner process.Runner
}

// NewCLIClient builds a CLIClient with the given runner.
func NewCLIClient(runner process.Runner) *CLIClient {
	return &CLIClient{Runner: runner}
}

func (c *CLIClient) run(ctx context.Context, out *bytes.Buffer, args ...string) error {
	req := process.RunRequest{Program: "tmux", Args: args}
	if out != nil {
		req.Stdout = out
	}
	return c.Runner.Run(ctx, req)
}

// capture runs a tmux command and returns stdout with exactly one trailing
// newline trimmed.
func (c *CLIClient) capture(ctx context.Context, args ...string) (string, error) {
	var out bytes.Buffer
	if err := c.run(ctx, &out, args...); err != nil {
		return "", err
	}
	return strings.TrimSuffix(out.String(), "\n"), nil
}

// HasSession reports whether a session with the exact name exists.
func (c *CLIClient) HasSession(ctx context.Context, name string) (bool, error) {
	// `has-session` exits nonzero when the session is absent, which the runner
	// surfaces as an ExitError. Distinguish that from a real failure by probing
	// the session list instead, which always exits zero when the server runs.
	out, err := c.capture(ctx, "list-sessions", "-F", "#{session_name}")
	if err != nil {
		// No server running means no sessions.
		if process.ExitCode(err) == 1 {
			return false, nil
		}
		return false, err
	}
	for _, line := range strings.Split(out, "\n") {
		if line == name {
			return true, nil
		}
	}
	return false, nil
}

// NewSession creates a detached session whose first pane runs spec.Argv.
func (c *CLIClient) NewSession(ctx context.Context, spec PaneSpec) (PaneID, error) {
	args := []string{
		"new-session", "-d",
		"-s", spec.Session,
		"-n", spec.Window,
		"-P", "-F", "#{pane_id}",
	}
	if spec.Dir != "" {
		args = append(args, "-c", spec.Dir)
	}
	args = append(args, spec.Argv...)
	id, err := c.capture(ctx, args...)
	if err != nil {
		return "", err
	}
	return validatePaneID(id)
}

// SplitPane splits target and runs spec.Argv in the new pane.
func (c *CLIClient) SplitPane(ctx context.Context, target PaneID, spec PaneSpec) (PaneID, error) {
	args := []string{
		"split-window",
		"-t", target.String(),
		"-P", "-F", "#{pane_id}",
	}
	if spec.Dir != "" {
		args = append(args, "-c", spec.Dir)
	}
	args = append(args, spec.Argv...)
	id, err := c.capture(ctx, args...)
	if err != nil {
		return "", err
	}
	return validatePaneID(id)
}

// SetPaneTitle sets a pane's display title by pane id.
func (c *CLIClient) SetPaneTitle(ctx context.Context, pane PaneID, title ServiceName) error {
	return c.run(ctx, nil, "select-pane", "-t", pane.String(), "-T", title.String())
}

func (c *CLIClient) SetWindowOption(ctx context.Context, target, name, value string) error {
	return c.run(ctx, nil, "set-window-option", "-t", target, name, value)
}

func (c *CLIClient) SetSessionOption(ctx context.Context, session, name, value string) error {
	return c.run(ctx, nil, "set-option", "-t", session, name, value)
}

// SessionOption reads a session option; an unset user option returns "".
func (c *CLIClient) SessionOption(ctx context.Context, session, name string) (string, error) {
	out, err := c.capture(ctx, "show-options", "-t", session, "-v", name)
	if err != nil {
		// An unset option makes tmux exit 1 with empty output.
		if process.ExitCode(err) == 1 {
			return "", nil
		}
		return "", err
	}
	return out, nil
}

func (c *CLIClient) SetEnvironment(ctx context.Context, session, name, value string) error {
	return c.run(ctx, nil, "set-environment", "-t", session, name, value)
}

func (c *CLIClient) UnsetEnvironment(ctx context.Context, session, name string) error {
	return c.run(ctx, nil, "set-environment", "-t", session, "-u", name)
}

// ListPanes returns the parsed panes of target (e.g. "session:window").
func (c *CLIClient) ListPanes(ctx context.Context, target string) ([]Pane, error) {
	out, err := c.capture(ctx, "list-panes", "-t", target, "-F", paneFormat)
	if err != nil {
		return nil, err
	}
	return ParsePanes(out)
}

// SendInterrupt sends Ctrl-C to a pane by id.
func (c *CLIClient) SendInterrupt(ctx context.Context, pane PaneID) error {
	return c.run(ctx, nil, "send-keys", "-t", pane.String(), "C-c")
}

func (c *CLIClient) KillPane(ctx context.Context, pane PaneID) error {
	return c.run(ctx, nil, "kill-pane", "-t", pane.String())
}

func (c *CLIClient) KillSession(ctx context.Context, session string) error {
	return c.run(ctx, nil, "kill-session", "-t", session)
}

func (c *CLIClient) SelectLayout(ctx context.Context, target, layout string) error {
	return c.run(ctx, nil, "select-layout", "-t", target, layout)
}

func (c *CLIClient) SelectPane(ctx context.Context, pane PaneID) error {
	return c.run(ctx, nil, "select-pane", "-t", pane.String())
}

// Attach attaches a standalone terminal or switches an existing tmux client.
func (c *CLIClient) Attach(ctx context.Context, session string, insideTmux bool) error {
	if insideTmux {
		return c.run(ctx, nil, "switch-client", "-t", session)
	}
	return c.run(ctx, nil, "attach-session", "-t", session)
}

// Lock acquires a named tmux wait-for lock and returns an unlock function.
func (c *CLIClient) Lock(ctx context.Context, name string) (func() error, error) {
	if err := c.run(ctx, nil, "wait-for", "-L", name); err != nil {
		return nil, err
	}
	return func() error {
		return c.run(context.WithoutCancel(ctx), nil, "wait-for", "-U", name)
	}, nil
}

// ParsePanes parses the stable paneFormat output into Pane rows.
func ParsePanes(out string) ([]Pane, error) {
	out = strings.TrimSpace(out)
	if out == "" {
		return nil, nil
	}
	var panes []Pane
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Split(line, "\t")
		// A live pane has an empty pane_dead_status; some tmux versions omit the
		// trailing empty field, yielding 3 instead of 4 columns.
		if len(fields) == 3 {
			fields = append(fields, "")
		}
		if len(fields) != 4 {
			return nil, fmt.Errorf("unexpected tmux pane row %q", line)
		}
		id, err := validatePaneID(fields[0])
		if err != nil {
			return nil, err
		}
		dead := fields[2] == "1"
		status := 0
		if fields[3] != "" {
			n, err := strconv.Atoi(fields[3])
			if err != nil {
				return nil, fmt.Errorf("unexpected tmux dead status %q", fields[3])
			}
			status = n
		}
		panes = append(panes, Pane{ID: id, Title: fields[1], Dead: dead, DeadStatus: status})
	}
	return panes, nil
}
