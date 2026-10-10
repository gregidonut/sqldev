package cmd

import (
	"github.com/spf13/cobra"

	"github.com/gregidonut/sqldev/packages/cli/internal/app"
	"github.com/gregidonut/sqldev/packages/cli/internal/dev"
)

func newDevCommand(appOf func() *app.App) *cobra.Command {
	devCmd := &cobra.Command{
		Use:   "dev",
		Short: "Local development services",
	}
	devCmd.AddCommand(newDevWorkerCommand(appOf), newDevImagorCommand(appOf))
	return devCmd
}

func newDevWorkerCommand(appOf func() *app.App) *cobra.Command {
	return &cobra.Command{
		Use:   "worker",
		Short: "Run the local Supabase worker",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			a := appOf()
			if handled, err := a.EnsureLinked(cmd.Context()); handled {
				return err
			}
			res, err := a.Resources()
			if err != nil {
				return err
			}
			return dev.RunWorker(cmd.Context(), a.Runner, res, a.Cfg.FunctionsDir, a.Cfg.Stage)
		},
	}
}

func newDevImagorCommand(appOf func() *app.App) *cobra.Command {
	var image string
	cmd := &cobra.Command{
		Use:   "imagor",
		Short: "Run the local Imagor container",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			a := appOf()
			if handled, err := a.EnsureLinked(cmd.Context()); handled {
				return err
			}
			res, err := a.Resources()
			if err != nil {
				return err
			}
			return dev.RunImagor(cmd.Context(), a.Runner, res, image)
		},
	}
	cmd.Flags().StringVar(&image, "image", "", "Imagor image to run (default sqldev-imagor:test)")
	return cmd
}
