package devstack

import (
	"bytes"
	"context"
	"testing"

	"github.com/gregidonut/sqldev/packages/cli/internal/tmux"
)

func managedFake() *fakeTmux {
	ft := newFakeTmux()
	ft.sessionExists = true
	ft.options["sqldev-dev\x00@sqldev-managed"] = "1"
	ft.options["sqldev-dev\x00@sqldev-stage"] = "dev"
	ft.options["sqldev-dev\x00@sqldev-root"] = "/repo"
	return ft
}

func TestStatusStopped(t *testing.T) {
	ft := newFakeTmux()
	mgr := newTestManager(ft, &probeRunner{})
	s, err := mgr.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if s.State != SessionStopped {
		t.Errorf("state = %q, want stopped", s.State)
	}
}

func TestStatusCollision(t *testing.T) {
	ft := newFakeTmux()
	ft.sessionExists = true // unmanaged
	mgr := newTestManager(ft, &probeRunner{})
	s, err := mgr.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if s.State != SessionCollision || s.Managed {
		t.Errorf("status = %+v, want collision/unmanaged", s)
	}
}

func TestStatusRunning(t *testing.T) {
	ft := managedFake()
	ft.panes = []tmux.Pane{{ID: "%1", Title: "sst"}, {ID: "%2", Title: "worker"}, {ID: "%3", Title: "imagor"}}
	mgr := newTestManager(ft, &probeRunner{})
	s, err := mgr.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if s.State != SessionRunning {
		t.Errorf("state = %q, want running", s.State)
	}
}

func TestStatusFailedAndMissing(t *testing.T) {
	ft := managedFake()
	ft.panes = []tmux.Pane{
		{ID: "%1", Title: "sst"},
		{ID: "%2", Title: "worker", Dead: true, DeadStatus: 1},
		// imagor missing
	}
	mgr := newTestManager(ft, &probeRunner{})
	s, err := mgr.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if s.State != SessionPartial {
		t.Errorf("state = %q, want partial", s.State)
	}
	byName := map[string]ServiceStatus{}
	for _, svc := range s.Services {
		byName[svc.Service] = svc
	}
	if byName["worker"].State != "failed" || byName["worker"].ExitCode == nil || *byName["worker"].ExitCode != 1 {
		t.Errorf("worker = %+v, want failed exit 1", byName["worker"])
	}
	if byName["imagor"].State != "missing" {
		t.Errorf("imagor = %+v, want missing", byName["imagor"])
	}
}

func TestStatusDuplicateTitleInvalid(t *testing.T) {
	ft := managedFake()
	ft.panes = []tmux.Pane{{ID: "%1", Title: "sst"}, {ID: "%2", Title: "worker"}, {ID: "%3", Title: "worker"}}
	mgr := newTestManager(ft, &probeRunner{})
	s, err := mgr.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	byName := map[string]ServiceStatus{}
	for _, svc := range s.Services {
		byName[svc.Service] = svc
	}
	if byName["worker"].State != "invalid" {
		t.Errorf("duplicate worker should be invalid, got %q", byName["worker"].State)
	}
}

func TestStatusHumanRender(t *testing.T) {
	ft := managedFake()
	ft.panes = []tmux.Pane{{ID: "%1", Title: "sst"}, {ID: "%2", Title: "worker"}, {ID: "%3", Title: "imagor"}}
	mgr := newTestManager(ft, &probeRunner{})
	s, _ := mgr.Status(context.Background())
	var buf bytes.Buffer
	s.WriteHuman(&buf)
	out := buf.String()
	for _, want := range []string{"sqldev-dev:", "SERVICE", "sst", "worker", "imagor"} {
		if !bytes.Contains([]byte(out), []byte(want)) {
			t.Errorf("human output missing %q: %s", want, out)
		}
	}
}
