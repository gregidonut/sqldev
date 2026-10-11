package cmd

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/gregidonut/sqldev/packages/cli/internal/process"
)

func TestPassthroughGlobalFlagPrefix(t *testing.T) {
	global := newRootCommand(nil).PersistentFlags()

	cases := []struct {
		name string
		argv []string
		want int
	}{
		{"none", []string{"supabase", "start"}, 0},
		{"separate value", []string{"--stage", "dev", "supabase", "db", "reset"}, 2},
		{"equals value", []string{"--stage=dev", "sb", "start"}, 1},
		{"several", []string{"--root", "/r", "--stage", "dev", "--aws-profile", "p", "supabase", "start"}, 6},
		// Flags after the command name belong to the vendor CLI.
		{"vendor flag kept", []string{"cypress", "run", "--config", "x"}, 0},
		{"unknown leading flag stops", []string{"--nope", "supabase"}, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := len(globalFlagPrefix(tc.argv, global)); got != tc.want {
				t.Fatalf("globalFlagPrefix(%v) has %d tokens, want %d", tc.argv, got, tc.want)
			}
		})
	}
}

// recordingRunner records every request instead of running it.
type recordingRunner struct{ reqs []process.RunRequest }

func (r *recordingRunner) Run(_ context.Context, req process.RunRequest) error {
	r.reqs = append(r.reqs, req)
	return nil
}

// TestPassthroughAppliesLeadingGlobalFlags runs the real command tree with
// linked resources present: a global flag before `supabase` must not reach the
// Supabase CLI, while a vendor flag after the command name must.
func TestPassthroughAppliesLeadingGlobalFlags(t *testing.T) {
	t.Setenv("SST_RESOURCE_App", `{"name":"sqldev","stage":"qa"}`)
	t.Setenv("SST_RESOURCE_ClerkFeDomain", `{"value":"clerk.example.com"}`)
	t.Setenv("SST_RESOURCE_NotifySecret", `{"value":"s"}`)
	t.Setenv("SST_RESOURCE_GoApi", `{"url":"https://api.example.com/"}`)

	root := t.TempDir()
	for _, marker := range []string{"sst.config.ts", "package.json"} {
		if err := os.WriteFile(filepath.Join(root, marker), nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	argv := []string{"--root", root, "--stage", "qa", "supabase", "--output", "json", "status"}
	runner := &recordingRunner{}
	cmd := newRootCommandWithArgs(runner, func() []string { return argv })
	cmd.SetArgs(argv)
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if len(runner.reqs) != 1 {
		t.Fatalf("expected one vendor call, got %d", len(runner.reqs))
	}
	want := []string{"--no-install", "supabase", "--output", "json", "status"}
	if got := runner.reqs[0].Args; !reflect.DeepEqual(got, want) {
		t.Fatalf("forwarded args = %v, want %v", got, want)
	}
	if stage, _ := cmd.PersistentFlags().GetString("stage"); stage != "qa" {
		t.Fatalf("stage flag = %q, want qa", stage)
	}
}
