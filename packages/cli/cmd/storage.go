package cmd

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"github.com/gregidonut/sqldev/packages/cli/internal/app"
	"github.com/gregidonut/sqldev/packages/cli/internal/prompt"
	"github.com/gregidonut/sqldev/packages/cli/internal/storage"
)

func newStorageCommand(appOf func() *app.App) *cobra.Command {
	storageCmd := &cobra.Command{
		Use:   "storage",
		Short: "Maintenance operations on the linked SQLDevBucket",
	}
	storageCmd.AddCommand(
		newStorageEmptyCommand(appOf),
		newStorageDeleteCommand(appOf),
	)
	return storageCmd
}

func newStorageEmptyCommand(appOf func() *app.App) *cobra.Command {
	var assumeYes bool
	cmd := &cobra.Command{
		Use:   "empty",
		Short: "Delete every object in SQLDevBucket",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			a := appOf()
			if err := storage.AssertNotProduction(a.Cfg.Stage); err != nil {
				return err
			}
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
				ok, err := confirm(cmd,
					fmt.Sprintf("Delete ALL objects in %s (stage %s)?", bucket, a.Cfg.Stage))
				if err != nil {
					return err
				}
				if !ok {
					return errors.New("aborted")
				}
			}
			svc, err := storage.NewService(cmd.Context(), bucket, a.Cfg.AWSRegion)
			if err != nil {
				return err
			}
			deleted, err := svc.EmptyBucket(cmd.Context())
			if err != nil {
				return err
			}
			return reportDeleted(cmd, a.Cfg.Output, deleted)
		},
	}
	cmd.Flags().BoolVar(&assumeYes, "yes", false, "skip the confirmation prompt")
	return cmd
}

func newStorageDeleteCommand(appOf func() *app.App) *cobra.Command {
	var keysFile string
	cmd := &cobra.Command{
		Use:   "delete [key...]",
		Short: "Delete specific object keys from SQLDevBucket",
		Args:  cobra.ArbitraryArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			a := appOf()
			if err := storage.AssertNotProduction(a.Cfg.Stage); err != nil {
				return err
			}
			keys := append([]string{}, args...)
			if keysFile != "" {
				fileKeys, err := readKeys(cmd, keysFile)
				if err != nil {
					return err
				}
				keys = append(keys, fileKeys...)
			}
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
			svc, err := storage.NewService(cmd.Context(), bucket, a.Cfg.AWSRegion)
			if err != nil {
				return err
			}
			deleted, err := svc.DeleteObjectKeys(cmd.Context(), keys)
			if err != nil {
				return err
			}
			return reportDeleted(cmd, a.Cfg.Output, deleted)
		},
	}
	cmd.Flags().StringVar(&keysFile, "keys-file", "", "read newline-delimited keys from a file, or - for stdin")
	return cmd
}

func readKeys(cmd *cobra.Command, path string) ([]string, error) {
	var reader io.Reader
	if path == "-" {
		reader = cmd.InOrStdin()
	} else {
		f, err := os.Open(path)
		if err != nil {
			return nil, err
		}
		defer f.Close()
		reader = f
	}
	var keys []string
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line != "" {
			keys = append(keys, line)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return keys, nil
}

func reportDeleted(cmd *cobra.Command, output string, deleted int) error {
	if output == "json" {
		return json.NewEncoder(cmd.OutOrStdout()).Encode(map[string]int{"deleted": deleted})
	}
	fmt.Fprintf(cmd.OutOrStdout(), "deleted %d objects\n", deleted)
	return nil
}

func confirm(cmd *cobra.Command, message string) (bool, error) {
	return prompt.Stdio{}.Confirm(cmd.InOrStdin(), cmd.OutOrStdout(), message)
}
