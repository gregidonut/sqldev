package devstack

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/gregidonut/sqldev/packages/cli/internal/process"
)

// fakeResources satisfies sst.Resources for reset tests.
type fakeResources struct {
	values map[string]string // "Name.property" -> value
}

func (f fakeResources) Has(name string) bool {
	for k := range f.values {
		if strings.HasPrefix(k, name+".") {
			return true
		}
	}
	return false
}

func (f fakeResources) String(name, property string) (string, error) {
	v, ok := f.values[name+"."+property]
	if !ok || v == "" {
		return "", errors.New(name + "." + property + " missing")
	}
	return v, nil
}

func resetResources() fakeResources {
	return fakeResources{values: map[string]string{
		"SQLDevBucket.name":  "sqldev-bucket",
		"ClerkFeDomain.value": "clerk.example.com",
		"NotifySecret.value":  "notify",
		"GoApi.url":           "https://api.example.com/",
	}}
}

// recordingResetRunner records argv and can fail the supabase step.
type recordingResetRunner struct {
	calls         [][]string
	supabaseError error
}

func (r *recordingResetRunner) Run(_ context.Context, req process.RunRequest) error {
	r.calls = append(r.calls, append([]string{req.Program}, req.Args...))
	if len(req.Args) >= 2 && req.Args[1] == "supabase" {
		return r.supabaseError
	}
	return nil
}

type fakeEmptier struct {
	deleted int
	err     error
	called  bool
}

func (f *fakeEmptier) EmptyBucket(_ context.Context) (int, error) {
	f.called = true
	return f.deleted, f.err
}

func newReset(stage string, runner process.Runner, emptier *fakeEmptier) *ResetService {
	return &ResetService{
		Stage:       stage,
		Region:      "ap-east-1",
		SupabaseDir: "/repo/packages/backend/supabase",
		Runner:      runner,
		Resources:   resetResources(),
		NewStorage: func(_ context.Context, _, _ string) (StorageEmptier, error) {
			return emptier, nil
		},
	}
}

func TestResetEmptiesS3BeforeSupabase(t *testing.T) {
	runner := &recordingResetRunner{}
	emptier := &fakeEmptier{deleted: 5}
	reset := newReset("dev", runner, emptier)

	if err := reset.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !emptier.called {
		t.Fatal("S3 empty must run")
	}
	if len(runner.calls) != 1 {
		t.Fatalf("expected one supabase call, got %v", runner.calls)
	}
	got := strings.Join(runner.calls[0], " ")
	if got != "bunx --no-install supabase db reset --local --no-seed" {
		t.Errorf("supabase argv = %q", got)
	}
}

func TestResetS3FailurePreventsSupabase(t *testing.T) {
	runner := &recordingResetRunner{}
	emptier := &fakeEmptier{err: errors.New("access denied")}
	reset := newReset("dev", runner, emptier)

	err := reset.Run(context.Background())
	if err == nil || !strings.Contains(err.Error(), "Supabase reset not attempted") {
		t.Fatalf("expected S3-failure message, got %v", err)
	}
	if len(runner.calls) != 0 {
		t.Error("supabase must not run after S3 failure")
	}
}

func TestResetSupabaseFailureReportsDeletedCount(t *testing.T) {
	runner := &recordingResetRunner{supabaseError: errors.New("stack down")}
	emptier := &fakeEmptier{deleted: 9}
	reset := newReset("dev", runner, emptier)

	err := reset.Run(context.Background())
	if err == nil || !strings.Contains(err.Error(), "S3 emptied 9 objects") {
		t.Fatalf("expected deleted-count message, got %v", err)
	}
}

func TestResetRefusesNonLocalStage(t *testing.T) {
	runner := &recordingResetRunner{}
	emptier := &fakeEmptier{}
	reset := newReset("staging", runner, emptier)
	if err := reset.Run(context.Background()); err == nil {
		t.Fatal("staging reset must be refused")
	}
	if emptier.called {
		t.Error("S3 must not be touched for a refused stage")
	}
}
