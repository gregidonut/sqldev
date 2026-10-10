// Package app wires the shared dependencies the commands need: resolved
// configuration, the subprocess runner, and lazily loaded SST resources with
// automatic `sst shell` bootstrap.
package app

import (
	"context"
	"os"

	"github.com/gregidonut/sqldev/packages/cli/internal/config"
	"github.com/gregidonut/sqldev/packages/cli/internal/process"
	"github.com/gregidonut/sqldev/packages/cli/internal/sst"
)

// App holds process-wide dependencies constructed once per invocation.
type App struct {
	Cfg    *config.Config
	Runner process.Runner
	Env    sst.Env

	// OSArgs is the original argument vector (os.Args[1:]) used when
	// re-executing through `sst shell`.
	OSArgs []string
	// Executable is the absolute path to this binary.
	Executable string

	resources sst.Resources
}

// New builds an App from resolved config and the current environment.
func New(cfg *config.Config, runner process.Runner) *App {
	exe, _ := os.Executable()
	args := []string{}
	if len(os.Args) > 1 {
		args = append(args, os.Args[1:]...)
	}
	return &App{
		Cfg:        cfg,
		Runner:     runner,
		Env:        sst.EnvFromOS(),
		OSArgs:     args,
		Executable: exe,
	}
}

// Linked reports whether SST links are active in the current environment.
func (a *App) Linked() bool { return a.Env.Linked() }

// Resources returns the loaded linked resources, loading them on first use.
func (a *App) Resources() (sst.Resources, error) {
	if a.resources != nil {
		return a.resources, nil
	}
	res, err := sst.Load(a.Env)
	if err != nil {
		return nil, err
	}
	a.resources = res
	return res, nil
}

// EnsureLinked re-executes the CLI through `sst shell` when links are not yet
// present. It returns handled=true when it ran the bootstrap, in which case the
// caller must return err without doing further work (the child already ran).
func (a *App) EnsureLinked(ctx context.Context) (handled bool, err error) {
	if a.Linked() {
		return false, nil
	}
	err = sst.Bootstrap(ctx, a.Runner, sst.BootstrapConfig{
		Executable: a.Executable,
		Args:       a.OSArgs,
		Root:       a.Cfg.Root,
		Stage:      a.Cfg.Stage,
		AWSProfile: a.Cfg.AWSProfile,
		AWSRegion:  a.Cfg.AWSRegion,
		Env:        a.Env,
	})
	return true, err
}

// ExecutablePath returns the absolute path to the running binary.
func (a *App) ExecutablePath() string { return a.Executable }
