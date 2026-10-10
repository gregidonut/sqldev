package cmd

import (
	"github.com/spf13/cobra"

	"github.com/gregidonut/sqldev/packages/cli/internal/app"
)

func newDevStartCommand(appOf func() *app.App) *cobra.Command {
	var cleanupLegacy bool
	var attach bool
	cmd := &cobra.Command{
		Use:   "start",
		Short: "Start SST, worker, and Imagor in managed tmux panes",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			a := appOf()
			mgr := newManager(a)
			mgr.Out = cmd.OutOrStdout()
			if err := mgr.Start(cmd.Context(), cleanupLegacy); err != nil {
				return err
			}
			if attach {
				return mgr.Attach(cmd.Context())
			}
			return nil
		},
	}
	cmd.Flags().BoolVar(&cleanupLegacy, "cleanup-legacy", false, "stop legacy sqldev service sessions first")
	cmd.Flags().BoolVar(&attach, "attach", false, "attach to the session after starting")
	return cmd
}

func newDevStopCommand(appOf func() *app.App) *cobra.Command {
	return &cobra.Command{
		Use:   "stop",
		Short: "Stop the managed tmux session and local Imagor container",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			mgr := newManager(appOf())
			mgr.Out = cmd.OutOrStdout()
			return mgr.Stop(cmd.Context())
		},
	}
}

func newDevStatusCommand(appOf func() *app.App) *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show managed session and pane status",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			a := appOf()
			mgr := newManager(a)
			status, err := mgr.Status(cmd.Context())
			if err != nil {
				return err
			}
			if a.Cfg.Output == "json" {
				return writeJSON(cmd, status)
			}
			status.WriteHuman(cmd.OutOrStdout())
			return nil
		},
	}
}

func newDevAttachCommand(appOf func() *app.App) *cobra.Command {
	return &cobra.Command{
		Use:   "attach",
		Short: "Attach or switch to the managed session",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			mgr := newManager(appOf())
			mgr.Out = cmd.OutOrStdout()
			return mgr.Attach(cmd.Context())
		},
	}
}
