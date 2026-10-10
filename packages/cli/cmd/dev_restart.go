package cmd

import (
	"errors"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/gregidonut/sqldev/packages/cli/internal/app"
	"github.com/gregidonut/sqldev/packages/cli/internal/devstack"
	"github.com/gregidonut/sqldev/packages/cli/internal/prompt"
)

func newDevRestartCommand(appOf func() *app.App) *cobra.Command {
	var resetData bool
	var assumeYes bool
	var attach bool
	var cleanupLegacy bool
	cmd := &cobra.Command{
		Use:   "restart",
		Short: "Restart all managed local services",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			a := appOf()
			mgr := newManager(a)
			mgr.Out = cmd.OutOrStdout()

			if resetData {
				// Validate stage before any confirmation or mutation.
				if err := devstack.AssertLocalStage(a.Cfg.Stage); err != nil {
					return err
				}
				if !assumeYes {
					message := fmt.Sprintf(
						"Stop local services, delete ALL objects from the linked SQLDevBucket for stage %s, reset local Supabase, and restart everything?",
						a.Cfg.Stage,
					)
					ok, err := prompt.Stdio{}.Confirm(cmd.InOrStdin(), cmd.OutOrStdout(), message)
					if err != nil {
						return err
					}
					if !ok {
						return errors.New("aborted")
					}
				}
				// Stop first, run the reset in a dedicated linked child, then start.
				if err := mgr.Stop(cmd.Context()); err != nil {
					return err
				}
				if err := runResetChild(cmd, a); err != nil {
					return err
				}
				if err := mgr.Start(cmd.Context(), cleanupLegacy); err != nil {
					return err
				}
			} else {
				if err := mgr.Restart(cmd.Context(), cleanupLegacy); err != nil {
					return err
				}
			}

			if attach {
				return mgr.Attach(cmd.Context())
			}
			return nil
		},
	}
	cmd.Flags().BoolVar(&resetData, "reset-data", false, "empty linked S3 and reset the local Supabase database as part of the restart")
	cmd.Flags().BoolVar(&assumeYes, "yes", false, "skip the destructive confirmation prompt")
	cmd.Flags().BoolVar(&attach, "attach", false, "attach to the session after restarting")
	cmd.Flags().BoolVar(&cleanupLegacy, "cleanup-legacy", false, "stop legacy sqldev service sessions first")
	return cmd
}

// runResetChild runs `sqldev dev reset-data --yes` as a dedicated subprocess so
// the destructive reset acquires SST links in its own process without
// re-executing the whole restart argv through `sst shell`.
func runResetChild(cmd *cobra.Command, a *app.App) error {
	return a.Runner.Run(cmd.Context(), resetChildRequest(a))
}
