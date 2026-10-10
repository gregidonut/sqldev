package sst

import (
	"context"
	"errors"
	"os"

	"github.com/gregidonut/sqldev/packages/cli/internal/process"
)

// bootstrapMarker is set in the child environment so a re-exec that still lacks
// links fails instead of recursing forever.
const bootstrapMarker = "SQLDEV_SST_BOOTSTRAPPED"

// BootstrapConfig describes how to re-exec the CLI through `sst shell`.
type BootstrapConfig struct {
	// Executable is the absolute path to this binary (os.Executable()).
	Executable string
	// Args is the full original argument list (os.Args[1:]).
	Args []string
	// Root is the repository root; sst runs from there.
	Root string
	// Stage is passed to `sst --stage`.
	Stage string
	// AWSProfile and AWSRegion are exported for the child when non-empty.
	AWSProfile string
	AWSRegion  string
	// Env is the current environment snapshot used to detect recursion.
	Env Env
}

// AlreadyBootstrapped reports whether the current process is already a
// `sst shell` child spawned by this CLI.
func AlreadyBootstrapped(env Env) bool {
	return env.pairs[bootstrapMarker] == "1"
}

// Bootstrap re-executes the CLI through `bunx --no-install sst --stage <stage>
// shell <executable> <args...>` from the repository root, inheriting stdio and
// propagating the exit code. It refuses to recurse if the marker is already
// set.
func Bootstrap(ctx context.Context, runner process.Runner, cfg BootstrapConfig) error {
	if AlreadyBootstrapped(cfg.Env) {
		return errors.New(
			"linked resources are still missing after `sst shell`; check your SST stage and AWS credentials",
		)
	}
	if cfg.Executable == "" {
		return errors.New("cannot determine the sqldev executable path for sst bootstrap")
	}

	env := append(os.Environ(), bootstrapMarker+"=1")
	if cfg.AWSProfile != "" {
		env = append(env, "AWS_PROFILE="+cfg.AWSProfile)
	}
	if cfg.AWSRegion != "" {
		env = append(env, "AWS_REGION="+cfg.AWSRegion)
	}

	return runner.Run(ctx, process.RunRequest{
		Program: "bunx",
		Args:    BuildArgs(cfg),
		Dir:     cfg.Root,
		Env:     env,
	})
}

// BuildArgs exposes the exact bunx argument vector for tests. The `--`
// terminator is required: without it `sst shell` parses the wrapped command's
// own flags (--root, --aws-profile, --local, ...) as SST flags and rejects the
// invocation with its usage text. Everything after `--` reaches the command
// unchanged.
func BuildArgs(cfg BootstrapConfig) []string {
	args := []string{"--no-install", "sst"}
	if cfg.Stage != "" {
		args = append(args, "--stage", cfg.Stage)
	}
	args = append(args, "shell", "--", cfg.Executable)
	args = append(args, cfg.Args...)
	return args
}
