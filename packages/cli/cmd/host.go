package cmd

import (
	"errors"

	"github.com/spf13/cobra"

	"github.com/gregidonut/sqldev/packages/cli/internal/app"
	"github.com/gregidonut/sqldev/packages/cli/internal/e2ereset"
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
	vaultCmd := &cobra.Command{
		Use:   "vault",
		Short: "Provision the host database's Vault secrets",
	}
	vaultCmd.AddCommand(newHostVaultSyncCommand(appOf))
	hostCmd.AddCommand(databaseCmd, vaultCmd, newHostReplaceCommand(appOf))
	return hostCmd
}

// newHostVaultSyncCommand provisions the Vault secrets the database triggers
// read (render_md_url, notify_ig_posts_view_url, notify_ig_posts_view_secret).
// Locally they come from config.toml; the deployed host has nothing that creates
// them, so without this posts store no rendered HTML and no MQTT notify is sent.
func newHostVaultSyncCommand(appOf func() *app.App) *cobra.Command {
	var preflight bool
	var assumeYes bool
	cmd := &cobra.Command{
		Use:   "sync",
		Short: "Create or update the trigger Vault secrets on the staging host",
		Long: "Writes render_md_url, notify_ig_posts_view_url and notify_ig_posts_view_secret into the staging host's Vault over SSM, " +
			"derived from the linked GoApi.url and NotifySecret. Runs only for the exact 'staging' stage. Prints secret names, never values. " +
			"Note: SSM keeps command parameters in its command history, so the notify secret is visible to principals that can read SSM commands in the account.",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			a := appOf()
			if a.Cfg.Stage != "staging" {
				return errors.New("host vault sync runs only for the exact 'staging' stage")
			}
			if handled, err := a.EnsureLinked(cmd.Context()); handled {
				return err
			}
			res, err := a.Resources()
			if err != nil {
				return err
			}
			if !preflight && !assumeYes {
				ok, err := confirm(cmd,
					"This writes Vault secrets on the "+a.Cfg.Stage+" database host. Continue?")
				if err != nil {
					return err
				}
				if !ok {
					return errors.New("aborted")
				}
			}
			return e2ereset.SyncVault(cmd.Context(), e2ereset.VaultOptions{
				ConfiguredStage: a.Cfg.Stage,
				Region:          a.Cfg.AWSRegion,
				Resources:       res,
				Runner:          a.Runner,
				Preflight:       preflight,
				Stdout:          cmd.OutOrStdout(),
			})
		},
	}
	cmd.Flags().BoolVar(&preflight, "preflight", false, "report which secret names exist without changing anything")
	cmd.Flags().BoolVar(&assumeYes, "yes", false, "skip the confirmation prompt")
	return cmd
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
