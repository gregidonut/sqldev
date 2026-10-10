package passthrough

import (
	"context"
	"strings"
	"testing"

	"github.com/gregidonut/sqldev/packages/cli/internal/app"
	"github.com/gregidonut/sqldev/packages/cli/internal/config"
	"github.com/gregidonut/sqldev/packages/cli/internal/process"
	"github.com/gregidonut/sqldev/packages/cli/internal/sst"
)

type recordingRunner struct {
	req process.RunRequest
}

func (r *recordingRunner) Run(_ context.Context, req process.RunRequest) error {
	r.req = req
	return nil
}

func linkedEnv() []string {
	return []string{
		`SST_RESOURCE_App={"name":"sqldev","stage":"dev"}`,
		`SST_RESOURCE_GoApi={"url":"https://api.example.com/"}`,
		`SST_RESOURCE_ClerkFeDomain={"value":"clerk.example.com"}`,
		`SST_RESOURCE_NotifySecret={"value":"notify-secret"}`,
		`SST_RESOURCE_ClerkPublicKey={"value":"pk"}`,
		`SST_RESOURCE_ClerkSecretKey={"value":"sk"}`,
		`SST_RESOURCE_SupabaseUrl={"value":"http://localhost:54321"}`,
		`SST_RESOURCE_SupabaseKey={"value":"sb-key"}`,
	}
}

func newTestApp(runner process.Runner, env []string) *app.App {
	return &app.App{
		Cfg: &config.Config{
			Root:        "/repo",
			Stage:       "dev",
			SupabaseDir: "/repo/packages/backend/supabase",
			E2EDir:      "/repo/packages/e2et",
		},
		Runner:     runner,
		Env:        sst.EnvFromSlice(env),
		Executable: "/abs/sqldev",
	}
}

func envValue(entries []string, key string) (string, bool) {
	for _, e := range entries {
		if name, value, ok := strings.Cut(e, "="); ok && name == key {
			return value, true
		}
	}
	return "", false
}

func TestSupabasePassthroughForwardsArgsUnchanged(t *testing.T) {
	runner := &recordingRunner{}
	a := newTestApp(runner, linkedEnv())

	args := []string{"db", "reset", "--local", "--no-seed", "--debug=weird-value"}
	if err := RunSupabase(context.Background(), a, args); err != nil {
		t.Fatal(err)
	}
	if runner.req.Program != "bunx" {
		t.Errorf("program = %q", runner.req.Program)
	}
	if runner.req.Dir != "/repo/packages/backend/supabase" {
		t.Errorf("dir = %q", runner.req.Dir)
	}
	want := append([]string{"--no-install", "supabase"}, args...)
	if strings.Join(runner.req.Args, "\x00") != strings.Join(want, "\x00") {
		t.Errorf("args = %v, want %v", runner.req.Args, want)
	}
	if v, _ := envValue(runner.req.Env, "NOTIFY_IG_POSTS_VIEW_URL"); v != "https://api.example.com/notify" {
		t.Errorf("NOTIFY_IG_POSTS_VIEW_URL = %q", v)
	}
	if v, _ := envValue(runner.req.Env, "RENDER_MD_URL"); v != "https://api.example.com/renderMd" {
		t.Errorf("RENDER_MD_URL = %q", v)
	}
}

func TestCypressPassthroughInjectsEnvAndBin(t *testing.T) {
	runner := &recordingRunner{}
	a := newTestApp(runner, linkedEnv())

	args := []string{"run", "--headless", "--browser", "chrome", "--config", "baseUrl=http://localhost:4321"}
	if err := RunCypress(context.Background(), a, args); err != nil {
		t.Fatal(err)
	}
	if runner.req.Dir != "/repo/packages/e2et" {
		t.Errorf("dir = %q", runner.req.Dir)
	}
	want := append([]string{"--no-install", "cypress"}, args...)
	if strings.Join(runner.req.Args, "\x00") != strings.Join(want, "\x00") {
		t.Errorf("args = %v, want %v", runner.req.Args, want)
	}
	checks := map[string]string{
		"STAGE":                 "dev",
		"SST_STAGE":             "dev",
		"CLERK_PUBLISHABLE_KEY": "pk",
		"CLERK_SECRET_KEY":      "sk",
		"SUPABASE_URL":          "http://localhost:54321",
		"SUPABASE_KEY":          "sb-key",
		"SQLDEV_BIN":            "/abs/sqldev",
		"SQLDEV_ROOT":           "/repo",
	}
	for key, exp := range checks {
		if v, ok := envValue(runner.req.Env, key); !ok || v != exp {
			t.Errorf("%s = %q (ok=%v), want %q", key, v, ok, exp)
		}
	}
}
