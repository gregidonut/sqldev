// Package process runs external programs with explicit working directory,
// environment, and streams. It never shells out through `sh -c`, preserves
// argument boundaries, maps a missing program to a clear error, and preserves
// subprocess exit codes so callers can propagate them.
package process

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
)

// RunRequest describes a single external command invocation.
type RunRequest struct {
	Program string
	Args    []string
	Dir     string
	Env     []string // when nil, the current process environment is inherited
	Stdin   io.Reader
	Stdout  io.Writer
	Stderr  io.Writer
}

// Runner executes a RunRequest. It is an interface so tests can substitute a
// fake that records the request instead of spawning a process.
type Runner interface {
	Run(ctx context.Context, req RunRequest) error
}

// ExitError carries the exit code of a failed subprocess so the top level can
// exit with the same status.
type ExitError struct {
	Program string
	Code    int
	Err     error
}

func (e *ExitError) Error() string {
	return fmt.Sprintf("%s exited with code %d", e.Program, e.Code)
}

func (e *ExitError) Unwrap() error { return e.Err }

// ExitCode returns the exit code to use for err. A failed subprocess uses its
// own code; any other error is exit 1; nil is 0.
func ExitCode(err error) int {
	if err == nil {
		return 0
	}
	var exitErr *ExitError
	if errors.As(err, &exitErr) {
		if exitErr.Code == 0 {
			return 1
		}
		return exitErr.Code
	}
	return 1
}

// OSRunner runs commands with os/exec.
type OSRunner struct{}

// Run executes req, inheriting this process's stdio when a stream is nil.
func (OSRunner) Run(ctx context.Context, req RunRequest) error {
	cmd := exec.CommandContext(ctx, req.Program, req.Args...)
	cmd.Dir = req.Dir
	if req.Env != nil {
		cmd.Env = req.Env
	}
	cmd.Stdin = orDefault[io.Reader](req.Stdin, os.Stdin)
	cmd.Stdout = orDefault[io.Writer](req.Stdout, os.Stdout)
	cmd.Stderr = orDefault[io.Writer](req.Stderr, os.Stderr)

	err := cmd.Run()
	if err == nil {
		return nil
	}
	if errors.Is(err, exec.ErrNotFound) {
		return fmt.Errorf("%s was not found on PATH", req.Program)
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return &ExitError{Program: req.Program, Code: exitErr.ExitCode(), Err: err}
	}
	// os/exec wraps a missing binary in *exec.Error with ErrNotFound; the
	// Is check above handles that. Any other start failure (e.g. permission)
	// surfaces here.
	return fmt.Errorf("run %s: %w", req.Program, err)
}

func orDefault[T comparable](value, fallback T) T {
	var zero T
	if value == zero {
		return fallback
	}
	return value
}
