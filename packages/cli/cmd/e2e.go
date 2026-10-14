package cmd

import (
	"errors"

	"github.com/spf13/cobra"

	"github.com/gregidonut/sqldev/packages/cli/internal/app"
	"github.com/gregidonut/sqldev/packages/cli/internal/e2ereset"
)

// newE2ECommand builds the `sqldev e2e` command tree.
func newE2ECommand(appOf func() *app.App) *cobra.Command {
	e2e := &cobra.Command{
		Use:   "e2e",
		Short: "End-to-end test environment operations",
	}
	e2e.AddCommand(newE2EResetCommand(appOf))
	return e2e
}

// newE2EResetCommand builds the exact-staging-only destructive reset. It takes
// no positional arguments and no target flags: everything is derived from the
// linked resources and AWS-resolved identities.
func newE2EResetCommand(appOf func() *app.App) *cobra.Command {
	var preflight bool
	var assumeYes bool
	cmd := &cobra.Command{
		Use:   "reset",
		Short: "Reset disposable staging application data before an E2E run",
		Long: "Truncates the audited application tables on the staging host over SSM and empties the linked application bucket. " +
			"Runs only when the stage is exactly 'staging' and every linked identity (app, frontend, bucket, host) agrees. " +
			"Protected state (Clerk, DBOS, queues, job status, JobResultBucket) is never touched.",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			a := appOf()
			if a.Cfg.Stage != "staging" {
				return errors.New("e2e reset runs only for the exact 'staging' stage")
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
					"This DESTROYS staging application data (tables + bucket) for stage "+a.Cfg.Stage+". Continue?")
				if err != nil {
					return err
				}
				if !ok {
					return errors.New("aborted")
				}
			}
			return e2ereset.Run(cmd.Context(), e2ereset.Options{
				ConfiguredStage: a.Cfg.Stage,
				Region:          a.Cfg.AWSRegion,
				Resources:       res,
				Runner:          a.Runner,
				Preflight:       preflight,
				Stdout:          cmd.OutOrStdout(),
			})
		},
	}
	cmd.Flags().BoolVar(&preflight, "preflight", false, "validate identities and reachability without mutating anything")
	cmd.Flags().BoolVar(&assumeYes, "yes", false, "skip the confirmation prompt")
	return cmd
}
