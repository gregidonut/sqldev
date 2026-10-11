package dev

import (
	"bytes"
	"context"
	"io"
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

// Without a resolved profile the child must not receive an empty AWS_PROFILE,
// and cgo is disabled by default so `sst dev` can build the Go live function.
func TestRunSSTInheritsEnvironmentWhenNothingResolved(t *testing.T) {
	t.Setenv("AWS_PROFILE", "ambient")
	runner := &recordingRunner{}
	if err := RunSST(context.Background(), runner, "/repo", "dev", "", ""); err != nil {
		t.Fatal(err)
	}
	if got, _ := lastValue(runner.req.Env, "AWS_PROFILE"); got != "ambient" {
		t.Errorf("AWS_PROFILE = %q, want the inherited ambient value", got)
	}
	if got, _ := lastValue(runner.req.Env, "CGO_ENABLED"); got != "0" {
		t.Errorf("CGO_ENABLED = %q, want 0 by default", got)
	}
}

// An explicit CGO_ENABLED in the caller's environment is respected.
func TestRunSSTRespectsExplicitCGOEnabled(t *testing.T) {
	t.Setenv("CGO_ENABLED", "1")
	runner := &recordingRunner{}
	if err := RunSST(context.Background(), runner, "/repo", "dev", "", ""); err != nil {
		t.Fatal(err)
	}
	if got, _ := lastValue(runner.req.Env, "CGO_ENABLED"); got != "1" {
		t.Errorf("CGO_ENABLED = %q, want the explicit 1", got)
	}
}

// stderrCapturingRunner wraps a recordingRunner but writes to a provided buffer
// whenever the inspected RunRequest would use os.Stderr (i.e. Stderr is nil).
type stderrCapturingRunner struct {
	stderrBuf *bytes.Buffer
	req       process.RunRequest
}

func (r *stderrCapturingRunner) Run(_ context.Context, req process.RunRequest) error {
	r.req = req
	if req.Stderr == nil {
		r.stderrBuf.WriteString("WOULD_WRITE_STDERR")
	}
	// Simulate `docker inspect` exit-1 for a missing container: return an
	// ExitError so inspectImagor treats it as "container not found".
	return &process.ExitError{Program: "docker", Code: 1}
}

// TestInspectImagorDiscardsStderrWhenContainerAbsent verifies that the "Error:
// No such object: sqldev-imagor" message Docker writes to stderr is suppressed.
// Before the fix, Stderr was nil → OSRunner used os.Stderr → the message
// leaked to the imagor pane on every cold start.
func TestInspectImagorDiscardsStderrWhenContainerAbsent(t *testing.T) {
	var buf bytes.Buffer
	runner := &stderrCapturingRunner{stderrBuf: &buf}

	// inspectImagor is unexported; drive it via RemoveOwnedImagor which calls it.
	// RemoveOwnedImagor returns nil when the container is absent (exists=false).
	if err := RemoveOwnedImagor(context.Background(), runner, "dev"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if buf.Len() > 0 {
		t.Errorf("stderr should be discarded when container is absent, but runner would have written: %q", buf.String())
	}
	if runner.req.Stderr == nil {
		t.Error("Stderr field must not be nil on the docker inspect RunRequest; got nil means os.Stderr is used")
	}
	if runner.req.Stderr != io.Discard {
		t.Errorf("Stderr = %T, want io.Discard", runner.req.Stderr)
	}
}
