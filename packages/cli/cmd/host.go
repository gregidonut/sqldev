package cmd

import (
	"errors"

	"github.com/spf13/cobra"

	"github.com/gregidonut/sqldev/packages/cli/internal/app"
	"github.com/gregidonut/sqldev/packages/cli/internal/host"
)

func newHostCommand(appOf func() *app.App) *cobra.Command {
	hostCmd := &cobra.Command{
		Use:   "host",
		Short: "Operate the deployed Supabase host",
	}
	databaseCmd := &cobra.Command{
		Use:   "database",
		Short: "Deployed host database access",
	}
	databaseCmd.AddCommand(newHostTunnelCommand(appOf))
	hostCmd.AddCommand(databaseCmd, newHostReplaceCommand(appOf))
	return hostCmd
}

func newHostTunnelCommand(appOf func() *app.App) *cobra.Command {
	return &cobra.Command{
		Use:   "tunnel",
		Short: "Forward a local port to the host's loopback Postgres over SSM",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			a := appOf()
			return host.Tunnel(cmd.Context(), a.Runner, a.Cfg.Stage, a.Cfg.HostLocalPort)
		},
	}
}

func newHostReplaceCommand(appOf func() *app.App) *cobra.Command {
	var assumeYes bool
	cmd := &cobra.Command{
		Use:   "replace",
		Short: "Replace the Supabase host, preserving its data volume",
		Long:  "Terminates the current Supabase host and redeploys through SST. The data volume is retained and reattached. If deployment fails after termination, the stage can be left without a running host. There is no automatic rollback.",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			a := appOf()
			if err := host.AssertDeployedStage(a.Cfg.Stage); err != nil {
				return err
			}
			if !assumeYes {
				ok, err := confirm(cmd,
					"This terminates the host for stage "+a.Cfg.Stage+". Deployment failure after termination can leave the stage without a running host, with no rollback. Continue?")
				if err != nil {
					return err
				}
				if !ok {
					return errors.New("aborted")
				}
			}
			return host.Replace(cmd.Context(), a.Runner, a.Cfg.Stage, a.Cfg.Root)
		},
	}
	cmd.Flags().BoolVar(&assumeYes, "yes", false, "skip the confirmation prompt")
	return cmd
}
