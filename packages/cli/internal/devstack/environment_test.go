package devstack

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/gregidonut/sqldev/packages/cli/internal/tmux"
)

// unsetEnv removes name for the duration of the test and restores it after.
func unsetEnv(t *testing.T, name string) {
	t.Helper()
	t.Setenv(name, "") // registers restoration of the previous state
	if err := os.Unsetenv(name); err != nil {
		t.Fatal(err)
	}
}

func awsManager(t *testing.T, profile, region string) (*Manager, *fakeTmux) {
	t.Helper()
	ft := newFakeTmux()
	mgr := newTestManager(ft, &probeRunner{checkLinks: func() error { return nil }})
	mgr.Cfg.AWSProfile = profile
	mgr.Cfg.AWSRegion = region
	return mgr, ft
}

// paneNamed returns the pane id the fake assigned to the titled service.
func paneNamed(t *testing.T, ft *fakeTmux, title string) tmux.PaneID {
	t.Helper()
	for _, p := range ft.panes {
		if p.Title == title {
			return p.ID
		}
	}
	t.Fatalf("no %q pane among %v", title, ft.panes)
	return ""
}

// The SST pane is the session's first pane: tmux spawns its process inside
// new-session, before the session environment is written, so the AWS variables
// must be delivered with the spawn itself. This is the regression for SST dying
// with "no EC2 IMDS role found" while worker and imagor worked.
func TestStartDeliversAWSEnvironmentToSSTFirstPane(t *testing.T) {
	unsetEnv(t, "AWS_PROFILE")
	unsetEnv(t, "AWS_REGION")
	mgr, ft := awsManager(t, "folio_api_admin", "ap-east-1")

	if err := mgr.Start(context.Background(), false); err != nil {
		t.Fatal(err)
	}

	sst := paneNamed(t, ft, "sst")
	if got := ft.paneEnv[sst]["AWS_PROFILE"]; got != "folio_api_admin" {
		t.Errorf("SST pane AWS_PROFILE = %q, want folio_api_admin", got)
	}
	if got := ft.paneEnv[sst]["AWS_REGION"]; got != "ap-east-1" {
		t.Errorf("SST pane AWS_REGION = %q, want ap-east-1", got)
	}
}

func TestStartDeliversAWSEnvironmentToEveryPane(t *testing.T) {
	unsetEnv(t, "AWS_PROFILE")
	unsetEnv(t, "AWS_REGION")
	mgr, ft := awsManager(t, "folio_api_admin", "ap-east-1")

	if err := mgr.Start(context.Background(), false); err != nil {
		t.Fatal(err)
	}

	for _, service := range tmux.Services {
		id := paneNamed(t, ft, service.String())
		env := ft.paneEnv[id]
		if env["AWS_PROFILE"] != "folio_api_admin" || env["AWS_REGION"] != "ap-east-1" {
			t.Errorf("%s pane env = AWS_PROFILE=%q AWS_REGION=%q", service, env["AWS_PROFILE"], env["AWS_REGION"])
		}
	}
}

// A profile given by --aws-profile or .sqldev.yaml is resolved into the config
// but is not in the process environment; it must still reach the panes.
func TestStartForwardsResolvedProfileNotAmbientEnvironment(t *testing.T) {
	t.Setenv("AWS_PROFILE", "ambient-profile")
	t.Setenv("AWS_REGION", "us-east-1")
	mgr, ft := awsManager(t, "flag-profile", "ap-east-1")

	if err := mgr.Start(context.Background(), false); err != nil {
		t.Fatal(err)
	}

	sst := paneNamed(t, ft, "sst")
	if got := ft.paneEnv[sst]["AWS_PROFILE"]; got != "flag-profile" {
		t.Errorf("AWS_PROFILE = %q, want the resolved flag-profile", got)
	}
	if got := ft.paneEnv[sst]["AWS_REGION"]; got != "ap-east-1" {
		t.Errorf("AWS_REGION = %q, want the resolved ap-east-1", got)
	}
}

// With nothing resolved, the ambient environment still flows through.
func TestStartFallsBackToAmbientEnvironment(t *testing.T) {
	t.Setenv("AWS_PROFILE", "ambient-profile")
	mgr, ft := awsManager(t, "", "")
	t.Setenv("AWS_SESSION_TOKEN", "token-123")

	if err := mgr.Start(context.Background(), false); err != nil {
		t.Fatal(err)
	}

	sst := paneNamed(t, ft, "sst")
	if got := ft.paneEnv[sst]["AWS_PROFILE"]; got != "ambient-profile" {
		t.Errorf("AWS_PROFILE = %q, want ambient-profile", got)
	}
	if got := ft.paneEnv[sst]["AWS_SESSION_TOKEN"]; got != "token-123" {
		t.Errorf("AWS_SESSION_TOKEN = %q, want token-123", got)
	}
}

// A variable that is not set anywhere must not be exported as an empty value:
// an empty AWS_PROFILE would mask the default credential chain.
func TestStartDoesNotExportUnsetVariables(t *testing.T) {
	unsetEnv(t, "AWS_PROFILE")
	unsetEnv(t, "AWS_ACCESS_KEY_ID")
	mgr, ft := awsManager(t, "", "ap-east-1")

	if err := mgr.Start(context.Background(), false); err != nil {
		t.Fatal(err)
	}

	sst := paneNamed(t, ft, "sst")
	for _, name := range []string{"AWS_PROFILE", "AWS_ACCESS_KEY_ID"} {
		if value, ok := ft.paneEnv[sst][name]; ok {
			t.Errorf("%s exported as %q although it is unset", name, value)
		}
	}
}

// The session environment must stay consistent with what the first pane got,
// so later panes (and RestartService) see the same values.
func TestStartKeepsSessionEnvironmentConsistentWithFirstPane(t *testing.T) {
	unsetEnv(t, "AWS_PROFILE")
	unsetEnv(t, "AWS_REGION")
	mgr, ft := awsManager(t, "folio_api_admin", "ap-east-1")

	if err := mgr.Start(context.Background(), false); err != nil {
		t.Fatal(err)
	}

	for _, name := range []string{"AWS_PROFILE", "AWS_REGION"} {
		if got, want := ft.sessionEnv[name], ft.paneEnv[paneNamed(t, ft, "sst")][name]; got != want {
			t.Errorf("session %s = %q but first pane has %q", name, got, want)
		}
	}
}

func TestSessionEnvironmentIsNotSetBeforeNewSession(t *testing.T) {
	// new-session must stay the first tmux call (nothing can be set on a
	// session that does not exist yet); the environment travels with it.
	mgr, ft := awsManager(t, "folio_api_admin", "ap-east-1")
	if err := mgr.Start(context.Background(), false); err != nil {
		t.Fatal(err)
	}
	if ft.indexOf("new-session") != 0 {
		t.Fatalf("new-session should be first: %v", ft.calls)
	}
}

// SST must be launched with the same explicit AWS flags as the other panes so
// it does not depend on the session environment alone.
func TestSSTArgvCarriesAWSFlags(t *testing.T) {
	mgr, _ := awsManager(t, "folio_api_admin", "ap-east-1")
	mgr.CachedBin = "/cache/sqldev-abc"

	want := []string{
		"/cache/sqldev-abc", "--root", "/repo", "--stage", "dev",
		"--aws-profile", "folio_api_admin", "--aws-region", "ap-east-1",
		"dev", "sst", "--foreground",
	}
	if got := mgr.sstArgv(); !reflect.DeepEqual(got, want) {
		t.Errorf("sstArgv = %v\nwant     %v", got, want)
	}
}

func TestSSTArgvOmitsAWSFlagsWhenUnresolved(t *testing.T) {
	mgr, _ := awsManager(t, "", "")
	mgr.CachedBin = "/cache/sqldev-abc"

	want := []string{"/cache/sqldev-abc", "--root", "/repo", "--stage", "dev", "dev", "sst", "--foreground"}
	if got := mgr.sstArgv(); !reflect.DeepEqual(got, want) {
		t.Errorf("sstArgv = %v\nwant     %v", got, want)
	}
}

// RestartService runs in a fresh CLI process where CachedBin has not been
// resolved by Start. The replacement pane must still get a real executable, not
// an empty command (which tmux reports as a pane that dies instantly).
func TestRestartServiceMaterializesBinaryWhenUnset(t *testing.T) {
	exe := filepath.Join(t.TempDir(), "sqldev")
	if err := os.WriteFile(exe, []byte("#!/bin/sh\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	cache := t.TempDir()

	ft := newFakeTmux()
	ft.sessionExists = true
	ft.options["sqldev-dev\x00@sqldev-managed"] = "1"
	ft.options["sqldev-dev\x00@sqldev-stage"] = "dev"
	ft.options["sqldev-dev\x00@sqldev-root"] = "/repo"
	ft.panes = []tmux.Pane{{ID: "%1", Title: "sst"}, {ID: "%2", Title: "worker"}}
	ft.nextPaneNum = 3
	mgr := newTestManager(ft, &probeRunner{})
	mgr.CachedBin = ""
	mgr.Executable = exe
	mgr.Cfg.Tmux.CacheDir = cache

	if err := mgr.RestartService(context.Background(), tmux.ServiceWorker); err != nil {
		t.Fatal(err)
	}

	argv := ft.argv["%3"]
	if len(argv) == 0 || argv[0] == "" {
		t.Fatalf("replacement pane has an empty command: %q", argv)
	}
	if !strings.HasPrefix(argv[0], cache) {
		t.Errorf("replacement pane runs %q, want a binary under the cache dir %q", argv[0], cache)
	}
}

// RestartService spawns into an existing session, whose environment is
// refreshed first so a new shell's credentials replace stale ones.
func TestRestartServiceRefreshesAWSEnvironmentBeforeSpawning(t *testing.T) {
	unsetEnv(t, "AWS_PROFILE")
	unsetEnv(t, "AWS_REGION")
	ft := newFakeTmux()
	ft.sessionExists = true
	ft.options["sqldev-dev\x00@sqldev-managed"] = "1"
	ft.options["sqldev-dev\x00@sqldev-stage"] = "dev"
	ft.options["sqldev-dev\x00@sqldev-root"] = "/repo"
	ft.panes = []tmux.Pane{{ID: "%1", Title: "sst"}, {ID: "%2", Title: "worker"}}
	ft.nextPaneNum = 3
	ft.sessionEnv["AWS_PROFILE"] = "stale-profile"
	mgr := newTestManager(ft, &probeRunner{checkLinks: func() error { return nil }})
	mgr.Cfg.AWSProfile = "folio_api_admin"
	mgr.Cfg.AWSRegion = "ap-east-1"
	mgr.Out = &bytes.Buffer{}

	if err := mgr.RestartService(context.Background(), tmux.ServiceWorker); err != nil {
		t.Fatal(err)
	}

	if ft.indexOf("set-env:AWS_PROFILE") > ft.indexOf("split-window") || !ft.has("set-env:AWS_PROFILE") {
		t.Errorf("AWS_PROFILE must be written before the replacement pane spawns: %v", ft.calls)
	}
	replacement := tmux.PaneID("%3")
	if got := ft.paneEnv[replacement]["AWS_PROFILE"]; got != "folio_api_admin" {
		t.Errorf("replacement pane AWS_PROFILE = %q, want folio_api_admin", got)
	}
}
