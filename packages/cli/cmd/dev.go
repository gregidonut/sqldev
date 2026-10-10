package cmd

import (
	"github.com/spf13/cobra"

	"github.com/gregidonut/sqldev/packages/cli/internal/app"
	"github.com/gregidonut/sqldev/packages/cli/internal/devstack"
	"github.com/gregidonut/sqldev/packages/cli/internal/tmux"
)

func newDevCommand(appOf func() *app.App) *cobra.Command {
	devCmd := &cobra.Command{
		Use:   "dev",
		Short: "Local development services",
	}
	devCmd.AddCommand(
		newDevStartCommand(appOf),
		newDevStopCommand(appOf),
		newDevRestartCommand(appOf),
		newDevStatusCommand(appOf),
		newDevAttachCommand(appOf),
		newDevResetDataCommand(appOf),
		newDevCheckLinksCommand(appOf),
		newDevSSTCommand(appOf),
		newDevWorkerCommand(appOf),
		newDevImagorCommand(appOf),
	)
	return devCmd
}

// newManager builds a devstack.Manager wired to the app's tmux client and
// runner. It materializes the stable executable lazily inside Start.
func newManager(a *app.App) *devstack.Manager {
	return &devstack.Manager{
		Cfg:        a.Cfg,
		Tmux:       tmux.NewCLIClient(a.Runner),
		Runner:     a.Runner,
		Executable: a.ExecutablePath(),
	}
}
