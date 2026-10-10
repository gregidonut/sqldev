package devstack

import (
	"context"
	"fmt"
	"io"

	"github.com/gregidonut/sqldev/packages/cli/internal/tmux"
)

// SessionState summarizes the managed session as a whole.
type SessionState string

const (
	SessionStopped   SessionState = "stopped"
	SessionRunning   SessionState = "running"
	SessionPartial   SessionState = "partial"
	SessionCollision SessionState = "collision"
)

// ServiceStatus is one service pane's state in a status report.
type ServiceStatus struct {
	Service  string `json:"service"`
	PaneID   string `json:"pane_id"`
	State    string `json:"state"`
	ExitCode *int   `json:"exit_code"`
}

// Status is the full status report for a managed session.
type Status struct {
	Session  string          `json:"session"`
	State    SessionState    `json:"state"`
	Managed  bool            `json:"managed"`
	Services []ServiceStatus `json:"services"`
}

// classify maps the discovered panes to per-service states by title.
func classify(panes []tmux.Pane) []ServiceStatus {
	byTitle := map[string][]tmux.Pane{}
	for _, p := range panes {
		byTitle[p.Title] = append(byTitle[p.Title], p)
	}
	out := make([]ServiceStatus, 0, len(tmux.Services))
	for _, svc := range tmux.Services {
		name := svc.String()
		matches := byTitle[name]
		switch len(matches) {
		case 0:
			out = append(out, ServiceStatus{Service: name, State: string(tmux.StateMissing)})
		case 1:
			out = append(out, serviceStatus(name, matches[0]))
		default:
			out = append(out, ServiceStatus{Service: name, PaneID: string(matches[0].ID), State: string(tmux.StateInvalid)})
		}
	}
	return out
}

func serviceStatus(name string, pane tmux.Pane) ServiceStatus {
	s := ServiceStatus{Service: name, PaneID: string(pane.ID)}
	switch {
	case !pane.Dead:
		s.State = string(tmux.StateRunning)
	case pane.DeadStatus == 0:
		s.State = string(tmux.StateExited)
		code := 0
		s.ExitCode = &code
	default:
		s.State = string(tmux.StateFailed)
		code := pane.DeadStatus
		s.ExitCode = &code
	}
	return s
}

func overallState(services []ServiceStatus) SessionState {
	running := 0
	for _, s := range services {
		if s.State == string(tmux.StateRunning) {
			running++
		}
	}
	switch running {
	case len(tmux.Services):
		return SessionRunning
	default:
		return SessionPartial
	}
}

// Status returns the managed-session status without mutating anything or
// loading SST resources.
func (m *Manager) Status(ctx context.Context) (Status, error) {
	session := m.Cfg.Tmux.Session
	exists, err := m.Tmux.HasSession(ctx, session)
	if err != nil {
		return Status{}, err
	}
	if !exists {
		return Status{Session: session, State: SessionStopped}, nil
	}
	managed, err := m.isManaged(ctx)
	if err != nil {
		return Status{}, err
	}
	if !managed {
		return Status{Session: session, State: SessionCollision, Managed: false}, nil
	}
	panes, err := m.Tmux.ListPanes(ctx, m.windowTarget())
	if err != nil {
		return Status{}, err
	}
	services := classify(panes)
	return Status{
		Session:  session,
		State:    overallState(services),
		Managed:  true,
		Services: services,
	}, nil
}

// WriteHuman renders a status report in the human table form.
func (s Status) WriteHuman(w io.Writer) {
	fmt.Fprintf(w, "%s: %s\n", s.Session, s.State)
	if s.State == SessionStopped || s.State == SessionCollision {
		return
	}
	fmt.Fprintf(w, "%-7s  %-5s  %-8s  %s\n", "SERVICE", "PANE", "STATE", "EXIT")
	for _, svc := range s.Services {
		exit := "-"
		if svc.ExitCode != nil {
			exit = fmt.Sprintf("%d", *svc.ExitCode)
		}
		pane := svc.PaneID
		if pane == "" {
			pane = "-"
		}
		fmt.Fprintf(w, "%-7s  %-5s  %-8s  %s\n", svc.Service, pane, svc.State, exit)
	}
}
