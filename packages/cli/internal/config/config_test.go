package config

import (
	"os"
	"path/filepath"
	"testing"
)

func writeRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	for _, name := range []string{"sst.config.ts", "package.json"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func TestDefaults(t *testing.T) {
	root := writeRoot(t)
	clearEnv(t)
	cfg, err := Load(root, Flags{})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Stage != "dev" {
		t.Errorf("stage = %q, want dev", cfg.Stage)
	}
	if cfg.AWSRegion != "ap-east-1" {
		t.Errorf("region = %q, want ap-east-1", cfg.AWSRegion)
	}
	if cfg.Output != "human" {
		t.Errorf("output = %q, want human", cfg.Output)
	}
	if cfg.HostLocalPort != 15432 {
		t.Errorf("port = %d, want 15432", cfg.HostLocalPort)
	}
	if cfg.SupabaseDir != filepath.Join(root, "packages/backend/supabase") {
		t.Errorf("supabaseDir = %q", cfg.SupabaseDir)
	}
}

func TestFlagBeatsEnv(t *testing.T) {
	root := writeRoot(t)
	clearEnv(t)
	t.Setenv("SQLDEV_STAGE", "fromenv")
	t.Setenv("STAGE", "legacy")
	cfg, err := Load(root, Flags{Stage: "fromflag"})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Stage != "fromflag" {
		t.Errorf("stage = %q, want fromflag", cfg.Stage)
	}
}

func TestSqldevEnvBeatsLegacyEnv(t *testing.T) {
	root := writeRoot(t)
	clearEnv(t)
	t.Setenv("SQLDEV_STAGE", "preferred")
	t.Setenv("STAGE", "legacy")
	cfg, err := Load(root, Flags{})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Stage != "preferred" {
		t.Errorf("stage = %q, want preferred", cfg.Stage)
	}
}

func TestLegacyStagePrecedenceOrder(t *testing.T) {
	root := writeRoot(t)
	clearEnv(t)
	t.Setenv("STAGE", "stagewins")
	t.Setenv("SST_STAGE", "sstloses")
	cfg, err := Load(root, Flags{})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Stage != "stagewins" {
		t.Errorf("stage = %q, want stagewins (STAGE before SST_STAGE)", cfg.Stage)
	}
}

func TestConfigFileBeatsDefaultButNotEnv(t *testing.T) {
	root := writeRoot(t)
	clearEnv(t)
	path := filepath.Join(root, ".sqldev.yaml")
	if err := os.WriteFile(path, []byte("stage: fromfile\nhost:\n  localPort: 20000\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(root, Flags{})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Stage != "fromfile" {
		t.Errorf("stage = %q, want fromfile", cfg.Stage)
	}
	if cfg.HostLocalPort != 20000 {
		t.Errorf("port = %d, want 20000", cfg.HostLocalPort)
	}

	// Env must still beat the file.
	t.Setenv("SQLDEV_STAGE", "fromenv")
	cfg, err = Load(root, Flags{})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Stage != "fromenv" {
		t.Errorf("stage = %q, want fromenv (env beats file)", cfg.Stage)
	}
}

func TestInvalidOutputRejected(t *testing.T) {
	root := writeRoot(t)
	clearEnv(t)
	if _, err := Load(root, Flags{Output: "xml"}); err == nil {
		t.Fatal("expected invalid --output to error")
	}
}

func TestMissingExplicitConfigErrors(t *testing.T) {
	root := writeRoot(t)
	clearEnv(t)
	if _, err := Load(root, Flags{ConfigFile: filepath.Join(root, "nope.yaml")}); err == nil {
		t.Fatal("expected missing explicit config to error")
	}
}

// clearEnv removes variables that participate in precedence so a developer's
// shell does not leak into the test.
func clearEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		"SQLDEV_STAGE", "STAGE", "SST_STAGE",
		"SQLDEV_AWS_PROFILE", "AWS_PROFILE",
		"SQLDEV_AWS_REGION", "AWS_REGION",
		"SQLDEV_OUTPUT",
		"SQLDEV_HOST_LOCAL_PORT", "LOCAL_PORT",
		"SQLDEV_TMUX_SESSION", "SQLDEV_TMUX_WINDOW",
		"SQLDEV_TMUX_STARTUP_TIMEOUT", "SQLDEV_TMUX_POLL_INTERVAL",
		"SQLDEV_TMUX_STOP_GRACE_PERIOD", "SQLDEV_TMUX_CACHE_DIR",
		"XDG_CONFIG_HOME",
	} {
		t.Setenv(key, "")
		os.Unsetenv(key)
	}
}

func TestTmuxDefaults(t *testing.T) {
	root := writeRoot(t)
	clearEnv(t)
	cfg, err := Load(root, Flags{})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Tmux.Session != "sqldev-dev" {
		t.Errorf("session = %q, want sqldev-dev", cfg.Tmux.Session)
	}
	if cfg.Tmux.Window != "services" {
		t.Errorf("window = %q", cfg.Tmux.Window)
	}
	if cfg.Tmux.StartupTimeout.String() != "2m0s" {
		t.Errorf("startup = %s", cfg.Tmux.StartupTimeout)
	}
	if cfg.Tmux.PollInterval.String() != "2s" {
		t.Errorf("poll = %s", cfg.Tmux.PollInterval)
	}
	if cfg.Tmux.CacheDir == "" {
		t.Error("cache dir should default to a non-empty path")
	}
}

func TestTmuxSessionRendersStage(t *testing.T) {
	root := writeRoot(t)
	clearEnv(t)
	cfg, err := Load(root, Flags{Stage: "local"})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Tmux.Session != "sqldev-local" {
		t.Errorf("session = %q, want sqldev-local", cfg.Tmux.Session)
	}
}

func TestTmuxFlagEnvFileDefaultPrecedence(t *testing.T) {
	root := writeRoot(t)
	clearEnv(t)
	// YAML beats default.
	path := filepath.Join(root, ".sqldev.yaml")
	if err := os.WriteFile(path, []byte("dev:\n  tmux:\n    window: fromfile\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(root, Flags{})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Tmux.Window != "fromfile" {
		t.Errorf("window = %q, want fromfile", cfg.Tmux.Window)
	}
	// Env beats YAML.
	t.Setenv("SQLDEV_TMUX_WINDOW", "fromenv")
	cfg, err = Load(root, Flags{})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Tmux.Window != "fromenv" {
		t.Errorf("window = %q, want fromenv", cfg.Tmux.Window)
	}
}

func TestTmuxInvalidDurations(t *testing.T) {
	root := writeRoot(t)
	for _, bad := range []string{"notaduration", "0s", "-5s"} {
		clearEnv(t)
		t.Setenv("SQLDEV_TMUX_STARTUP_TIMEOUT", bad)
		if _, err := Load(root, Flags{}); err == nil {
			t.Errorf("duration %q should fail", bad)
		}
	}
}

func TestTmuxPollMustBeLessThanTimeout(t *testing.T) {
	root := writeRoot(t)
	clearEnv(t)
	t.Setenv("SQLDEV_TMUX_STARTUP_TIMEOUT", "2s")
	t.Setenv("SQLDEV_TMUX_POLL_INTERVAL", "5s")
	if _, err := Load(root, Flags{}); err == nil {
		t.Fatal("poll >= timeout should fail")
	}
}

func TestInvalidStageRejected(t *testing.T) {
	root := writeRoot(t)
	clearEnv(t)
	for _, bad := range []string{"-bad", "has space", "a:b", "a.b"} {
		if _, err := Load(root, Flags{Stage: bad}); err == nil {
			t.Errorf("stage %q should be rejected", bad)
		}
	}
}

func TestInvalidSessionNameRejected(t *testing.T) {
	root := writeRoot(t)
	clearEnv(t)
	t.Setenv("SQLDEV_TMUX_SESSION", "bad:name")
	if _, err := Load(root, Flags{}); err == nil {
		t.Fatal("invalid session name should fail")
	}
}

func TestTmuxCacheDirAbsolute(t *testing.T) {
	root := writeRoot(t)
	clearEnv(t)
	t.Setenv("SQLDEV_TMUX_CACHE_DIR", "relative/cache")
	cfg, err := Load(root, Flags{})
	if err != nil {
		t.Fatal(err)
	}
	if !filepath.IsAbs(cfg.Tmux.CacheDir) {
		t.Errorf("cache dir not absolute: %q", cfg.Tmux.CacheDir)
	}
}
