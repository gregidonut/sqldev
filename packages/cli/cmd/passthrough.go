package cmd

import (
	"github.com/spf13/cobra"

	"github.com/gregidonut/sqldev/packages/cli/internal/app"
	"github.com/gregidonut/sqldev/packages/cli/internal/passthrough"
)

// newSupabaseCommand builds the transparent Supabase wrapper. Flag parsing is
// disabled so every argument reaches the Supabase CLI unchanged.
func newSupabaseCommand(appOf func() *app.App) *cobra.Command {
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
			return passthrough.RunSupabase(cmd.Context(), a, args)
		},
	}
}

// newCypressCommand builds the transparent Cypress wrapper.
func newCypressCommand(appOf func() *app.App) *cobra.Command {
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
			return passthrough.RunCypress(cmd.Context(), a, args)
		},
	}
}
