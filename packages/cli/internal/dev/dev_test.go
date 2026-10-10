package dev

import (
	"context"
	"strings"
	"testing"

	"github.com/gregidonut/sqldev/packages/cli/internal/process"
)

type recordingRunner struct {
	req process.RunRequest
}

func (r *recordingRunner) Run(_ context.Context, req process.RunRequest) error {
	r.req = req
	return nil
}

// lastValue returns the effective value of name in env: like os/exec, the last
// duplicate wins.
func lastValue(env []string, name string) (string, bool) {
	value, found := "", false
	for _, entry := range env {
		if k, v, ok := strings.Cut(entry, "="); ok && k == name {
			value, found = v, true
		}
	}
	return value, found
}

func TestRunSSTExportsResolvedAWSProfileAndRegion(t *testing.T) {
	t.Setenv("AWS_PROFILE", "ambient")
	t.Setenv("AWS_REGION", "us-east-1")
	runner := &recordingRunner{}

	if err := RunSST(context.Background(), runner, "/repo", "dev", "folio_api_admin", "ap-east-1"); err != nil {
		t.Fatal(err)
	}

	if runner.req.Program != "bunx" || runner.req.Dir != "/repo" {
		t.Fatalf("request = %+v", runner.req)
	}
	want := "--no-install sst --stage dev dev"
	if got := strings.Join(runner.req.Args, " "); got != want {
		t.Errorf("args = %q, want %q", got, want)
	}
	if got, _ := lastValue(runner.req.Env, "AWS_PROFILE"); got != "folio_api_admin" {
		t.Errorf("AWS_PROFILE = %q, want the resolved folio_api_admin over the ambient value", got)
	}
	if got, _ := lastValue(runner.req.Env, "AWS_REGION"); got != "ap-east-1" {
		t.Errorf("AWS_REGION = %q, want ap-east-1", got)
	}
}

// Without a resolved profile the child must inherit the ambient environment
// untouched (nil Env), not receive an empty AWS_PROFILE.
func TestRunSSTInheritsEnvironmentWhenNothingResolved(t *testing.T) {
	runner := &recordingRunner{}
	if err := RunSST(context.Background(), runner, "/repo", "dev", "", ""); err != nil {
		t.Fatal(err)
	}
	if runner.req.Env != nil {
		t.Errorf("Env = %v, want nil so the process environment is inherited", runner.req.Env)
	}
}
