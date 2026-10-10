package cmd

import (
	"github.com/spf13/cobra"

	"github.com/gregidonut/sqldev/packages/cli/internal/app"
	"github.com/gregidonut/sqldev/packages/cli/internal/dev"
	"github.com/gregidonut/sqldev/packages/cli/internal/tmux"
)

func newDevSSTCommand(appOf func() *app.App) *cobra.Command {
	var foreground bool
	cmd := &cobra.Command{
		Use:   "sst",
		Short: "Restart SST in its pane, or run it with --foreground",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			a := appOf()
			if foreground {
				// SST provides its own linked resources; no EnsureLinked.
				return dev.RunSST(cmd.Context(), a.Runner, a.Cfg.Root, a.Cfg.Stage, a.Cfg.AWSProfile, a.Cfg.AWSRegion)
			}
			mgr := newManager(a)
			mgr.Out = cmd.OutOrStdout()
			return mgr.RestartService(cmd.Context(), tmux.ServiceSST)
		},
	}
	cmd.Flags().BoolVar(&foreground, "foreground", false, "run SST attached to this terminal instead of its pane")
	return cmd
}

func newDevWorkerCommand(appOf func() *app.App) *cobra.Command {
	var foreground bool
	cmd := &cobra.Command{
		Use:   "worker",
		Short: "Restart the worker pane, or run it with --foreground",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			a := appOf()
			if foreground {
				if handled, err := a.EnsureLinked(cmd.Context()); handled {
					return err
				}
				res, err := a.Resources()
				if err != nil {
					return err
				}
				return dev.RunWorker(cmd.Context(), a.Runner, res, a.Cfg.FunctionsDir, a.Cfg.Stage)
			}
			mgr := newManager(a)
			mgr.Out = cmd.OutOrStdout()
			return mgr.RestartService(cmd.Context(), tmux.ServiceWorker)
		},
	}
	cmd.Flags().BoolVar(&foreground, "foreground", false, "run the worker attached to this terminal instead of its pane")
	return cmd
}

func newDevImagorCommand(appOf func() *app.App) *cobra.Command {
	var foreground bool
	var image string
	cmd := &cobra.Command{
		Use:   "imagor",
		Short: "Restart the Imagor pane, or run it with --foreground",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			a := appOf()
			if foreground {
				if handled, err := a.EnsureLinked(cmd.Context()); handled {
					return err
				}
				res, err := a.Resources()
				if err != nil {
					return err
				}
				return dev.RunImagor(cmd.Context(), a.Runner, res, image, a.Cfg.Stage)
			}
			mgr := newManager(a)
			mgr.Out = cmd.OutOrStdout()
			return mgr.RestartService(cmd.Context(), tmux.ServiceImagor)
		},
	}
	cmd.Flags().BoolVar(&foreground, "foreground", false, "run Imagor attached to this terminal instead of its pane")
	cmd.Flags().StringVar(&image, "image", "", "Imagor image to run (default sqldev-imagor:test)")
	return cmd
}
