package cmd

import (
	"errors"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/gregidonut/sqldev/packages/cli/internal/app"
	"github.com/gregidonut/sqldev/packages/cli/internal/devstack"
)

// newDevCheckLinksCommand is a hidden command used only by the readiness probe.
// It acquires links in its own process and verifies the exact worker/Imagor
// resource properties exist, printing nothing sensitive.
func newDevCheckLinksCommand(appOf func() *app.App) *cobra.Command {
	return &cobra.Command{
		Use:    "check-links",
		Short:  "Verify linked resources are available (internal)",
		Hidden: true,
		Args:   cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			a := appOf()
			if err := devstack.AssertLocalStage(a.Cfg.Stage); err != nil {
				return err
			}
			if handled, err := a.EnsureLinked(cmd.Context()); handled {
				return err
			}
			res, err := a.Resources()
			if err != nil {
				return err
			}
			required := [][2]string{
				{"SQLDevBucket", "name"},
				{"JobQueueUrl", "url"},
				{"JobStatusName", "name"},
				{"JobResultBucketName", "name"},
			}
			for _, rp := range required {
				value, err := res.String(rp[0], rp[1])
				if err != nil {
					return fmt.Errorf("%s.%s not ready", rp[0], rp[1])
				}
				if value == "" {
					return errors.New("linked resources not ready")
				}
			}
			return nil
		},
	}
}
