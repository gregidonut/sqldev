package process

import (
	"context"
	"errors"
	"os"
	"testing"
)

func TestExitCodePropagates(t *testing.T) {
	if got := ExitCode(nil); got != 0 {
		t.Errorf("nil -> %d, want 0", got)
	}
	if got := ExitCode(errors.New("plain")); got != 1 {
		t.Errorf("plain error -> %d, want 1", got)
	}
	exit := &ExitError{Program: "x", Code: 7}
	if got := ExitCode(exit); got != 7 {
		t.Errorf("exit 7 -> %d, want 7", got)
	}
	wrapped := errors.Join(errors.New("ctx"), exit)
	if got := ExitCode(wrapped); got != 7 {
		t.Errorf("wrapped exit 7 -> %d, want 7", got)
	}
}

func TestRunMissingProgram(t *testing.T) {
	err := OSRunner{}.Run(context.Background(), RunRequest{
		Program: "sqldev-definitely-not-a-real-binary-xyz",
	})
	if err == nil {
		t.Fatal("expected an error for a missing program")
	}
	if got := err.Error(); got != "sqldev-definitely-not-a-real-binary-xyz was not found on PATH" {
		t.Errorf("error = %q", got)
	}
}

func TestRunPropagatesExitCode(t *testing.T) {
	// `false` exits 1 on every POSIX system; use it to confirm an ExitError.
	if _, err := os.Stat("/bin/false"); err != nil {
		t.Skip("/bin/false not available")
	}
	err := OSRunner{}.Run(context.Background(), RunRequest{Program: "/bin/false"})
	var exitErr *ExitError
	if !errors.As(err, &exitErr) {
		t.Fatalf("expected *ExitError, got %T (%v)", err, err)
	}
	if exitErr.Code != 1 {
		t.Errorf("code = %d, want 1", exitErr.Code)
	}
}
