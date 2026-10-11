package cmd

import (
	"strings"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"

	"github.com/gregidonut/sqldev/packages/cli/internal/app"
	"github.com/gregidonut/sqldev/packages/cli/internal/passthrough"
)

// newSupabaseCommand builds the transparent Supabase wrapper. Flag parsing is
// disabled so every argument after the command name reaches the Supabase CLI
// unchanged; global flags before the name are applied by the root command.
func newSupabaseCommand(appOf func() *app.App, passArgs func([]string) []string) *cobra.Command {
	return &cobra.Command{
		Use:                "supabase [arguments...]",
		Aliases:            []string{"sb"},
		Short:              "Run the Supabase CLI with linked resources",
		Long:               "Forwards all arguments to the Supabase CLI from the backend package with linked SST resources injected. Example: sqldev supabase db reset.",
		DisableFlagParsing: true,
		Args:               cobra.ArbitraryArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			a := appOf()
			if handled, err := a.EnsureLinked(cmd.Context()); handled {
				return err
			}
			return passthrough.RunSupabase(cmd.Context(), a, passArgs(args))
		},
	}
}

// newCypressCommand builds the transparent Cypress wrapper.
func newCypressCommand(appOf func() *app.App, passArgs func([]string) []string) *cobra.Command {
	return &cobra.Command{
		Use:                "cypress [arguments...]",
		Aliases:            []string{"cy"},
		Short:              "Run the Cypress CLI with linked resources",
		Long:               "Forwards all arguments to the Cypress CLI from the e2e package with linked SST resources injected. Example: sqldev cypress run --headless --browser chrome.",
		DisableFlagParsing: true,
		Args:               cobra.ArbitraryArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			a := appOf()
			if handled, err := a.EnsureLinked(cmd.Context()); handled {
				return err
			}
			return passthrough.RunCypress(cmd.Context(), a, passArgs(args))
		},
	}
}

// globalFlagPrefix returns the leading tokens of argv that are global flags
// (with their values), stopping at the first token that is not one: the
// command name. Cobra keeps those tokens at the front of a DisableFlagParsing
// command's args, in the same order, so the caller can drop len(prefix).
func globalFlagPrefix(argv []string, global *pflag.FlagSet) []string {
	i := 0
	for i < len(argv) {
		tok := argv[i]
		if !strings.HasPrefix(tok, "--") || tok == "--" {
			break
		}
		name, _, hasValue := strings.Cut(strings.TrimPrefix(tok, "--"), "=")
		flag := global.Lookup(name)
		if flag == nil {
			break
		}
		i++
		if !hasValue && flag.NoOptDefVal == "" && i < len(argv) {
			i++ // separate value token
		}
	}
	return argv[:i]
}
