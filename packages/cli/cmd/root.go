// Package cmd defines the Cobra command tree. Commands are built by
// constructors that receive shared dependencies, so no package-level global
// state is used and the tree can be exercised in tests.
package cmd

import (
	"os"

	"github.com/spf13/cobra"

	"github.com/gregidonut/sqldev/packages/cli/internal/app"
	"github.com/gregidonut/sqldev/packages/cli/internal/config"
	"github.com/gregidonut/sqldev/packages/cli/internal/process"
	"github.com/gregidonut/sqldev/packages/cli/internal/workspace"
)

// NewRootCommand builds the full command tree with the default OS runner.
func NewRootCommand() *cobra.Command {
	return newRootCommand(process.OSRunner{})
}

// newRootCommand builds the tree with an injectable runner for testing.
func newRootCommand(runner process.Runner) *cobra.Command {
	return newRootCommandWithArgs(runner, func() []string { return os.Args[1:] })
}

// newRootCommandWithArgs lets tests supply the raw argv that passthrough
// commands use to recover global flags placed before the command name.
func newRootCommandWithArgs(runner process.Runner, rawArgs func() []string) *cobra.Command {
	var flags config.Flags

	// a is resolved in PersistentPreRunE and shared with every subcommand via
	// a closure captured below.
	var a *app.App

	// globalPrefix is how many leading args of a passthrough command were
	// global flags given before the command name (see passthroughArgs).
	var globalPrefix int

	var root *cobra.Command
	root = &cobra.Command{
		Use:           "sqldev",
		Short:         "SQLDev developer CLI",
		Long:          "sqldev consolidates SQLDev developer tooling: transparent Supabase and Cypress wrappers, storage maintenance, host operations, and local dev services.",
		SilenceUsage:  true,
		SilenceErrors: true,
		PersistentPreRunE: func(cmd *cobra.Command, _ []string) error {
			// Help and completion do not need configuration or links.
			if isMetaCommand(cmd) {
				return nil
			}
			// Cobra does not parse any flags for DisableFlagParsing commands,
			// not even global ones placed before the command name, and leaves
			// them in args. Parse that prefix here so config sees them.
			if cmd.DisableFlagParsing {
				prefix := globalFlagPrefix(rawArgs(), root.PersistentFlags())
				if err := root.PersistentFlags().Parse(prefix); err != nil {
					return err
				}
				globalPrefix = len(prefix)
			}
			root, err := workspace.FindRoot(flags.Root, "")
			if err != nil {
				return err
			}
			cfg, err := config.Load(root, flags)
			if err != nil {
				return err
			}
			a = app.New(cfg, runner)
			return nil
		},
	}

	pf := root.PersistentFlags()
	pf.StringVar(&flags.ConfigFile, "config", "", "path to a sqldev config file")
	pf.StringVar(&flags.Root, "root", "", "repository root (defaults to upward search)")
	pf.StringVar(&flags.Stage, "stage", "", "deployment stage (default dev)")
	pf.StringVar(&flags.AWSProfile, "aws-profile", "", "AWS profile")
	pf.StringVar(&flags.AWSRegion, "aws-region", "", "AWS region (default ap-east-1)")
	pf.StringVar(&flags.Output, "output", "", "output format: human or json")

	// appOf returns the resolved App for a running subcommand.
	appOf := func() *app.App { return a }
	// passArgs drops the global-flag prefix from a passthrough command's args.
	passArgs := func(args []string) []string {
		if globalPrefix > len(args) {
			return args
		}
		return args[globalPrefix:]
	}

	root.AddCommand(
		newSupabaseCommand(appOf, passArgs),
		newCypressCommand(appOf, passArgs),
		newStorageCommand(appOf),
		newHostCommand(appOf),
		newDevCommand(appOf),
		newE2ECommand(appOf),
	)
	return root
}

// isMetaCommand reports whether cmd is help or completion, which need no setup.
func isMetaCommand(cmd *cobra.Command) bool {
	name := cmd.Name()
	if name == "help" || name == cobra.ShellCompRequestCmd || name == cobra.ShellCompNoDescRequestCmd {
		return true
	}
	for c := cmd; c != nil; c = c.Parent() {
		if c.Name() == "completion" {
			return true
		}
	}
	return false
}
