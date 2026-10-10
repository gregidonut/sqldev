// Command sqldev is the SQLDev developer CLI. It consolidates the former
// packages/core and packages/scripts behavior into one executable: transparent
// Supabase and Cypress wrappers, storage maintenance, host operations, and
// local dev services. Linked SST resources are loaded from the environment, and
// commands that need them re-exec themselves through `sst shell` when they are
// absent.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/gregidonut/sqldev/packages/cli/cmd"
	"github.com/gregidonut/sqldev/packages/cli/internal/process"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	root := cmd.NewRootCommand()
	if err := root.ExecuteContext(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "sqldev:", err)
		os.Exit(process.ExitCode(err))
	}
}
