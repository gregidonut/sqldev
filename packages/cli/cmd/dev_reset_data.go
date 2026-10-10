package cmd

import (
	"errors"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/gregidonut/sqldev/packages/cli/internal/app"
	"github.com/gregidonut/sqldev/packages/cli/internal/devstack"
	"github.com/gregidonut/sqldev/packages/cli/internal/process"
	"github.com/gregidonut/sqldev/packages/cli/internal/prompt"
)

func newDevResetDataCommand(appOf func() *app.App) *cobra.Command {
	var assumeYes bool
	cmd := &cobra.Command{
		Use:   "reset-data",
		Short: "Empty linked S3 and reset the local Supabase database",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			a := appOf()
			// Strict local-stage guard before anything else.
			if err := devstack.AssertLocalStage(a.Cfg.Stage); err != nil {
				return err
			}
			// Acquire links in this process; return if a re-exec handled it.
			if handled, err := a.EnsureLinked(cmd.Context()); handled {
				return err
			}
			res, err := a.Resources()
			if err != nil {
				return err
			}
			bucket, err := res.String("SQLDevBucket", "name")
			if err != nil {
				return err
			}
			if !assumeYes {
				message := fmt.Sprintf(
					"Delete ALL objects from %s and reset the local Supabase database for stage %s?",
					bucket, a.Cfg.Stage,
				)
				ok, err := prompt.Stdio{}.Confirm(cmd.InOrStdin(), cmd.OutOrStdout(), message)
				if err != nil {
					return err
				}
				if !ok {
					return errors.New("aborted")
				}
			}
			reset := &devstack.ResetService{
				Stage:       a.Cfg.Stage,
				Region:      a.Cfg.AWSRegion,
				SupabaseDir: a.Cfg.SupabaseDir,
				Runner:      a.Runner,
				Resources:   res,
				Out:         cmd.OutOrStdout(),
			}
			return reset.Run(cmd.Context())
		},
	}
	cmd.Flags().BoolVar(&assumeYes, "yes", false, "skip the destructive confirmation prompt")
	return cmd
}

// resetChildRequest builds the `sqldev dev reset-data --yes` subprocess the
// restart flow uses so the reset acquires links in its own process.
func resetChildRequest(a *app.App) process.RunRequest {
	args := []string{"--root", a.Cfg.Root, "--stage", a.Cfg.Stage}
	if a.Cfg.AWSProfile != "" {
		args = append(args, "--aws-profile", a.Cfg.AWSProfile)
	}
	if a.Cfg.AWSRegion != "" {
		args = append(args, "--aws-region", a.Cfg.AWSRegion)
	}
	args = append(args, "dev", "reset-data", "--yes")
	return process.RunRequest{
		Program: a.ExecutablePath(),
		Args:    args,
		Dir:     a.Cfg.Root,
	}
}
