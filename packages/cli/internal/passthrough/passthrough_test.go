package passthrough

import (
	"context"
	"math/rand"
	"strings"
	"testing"
	"testing/quick"

	"github.com/gregidonut/sqldev/packages/cli/internal/app"
	"github.com/gregidonut/sqldev/packages/cli/internal/config"
	"github.com/gregidonut/sqldev/packages/cli/internal/process"
	"github.com/gregidonut/sqldev/packages/cli/internal/proptest"
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
		`SST_RESOURCE_CyTestUsersJson={"value":"[{\"user_id\":\"a\"},{\"user_id\":\"b\"}]"}`,
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

	// Stage-aware runtime is injected for dev as localhost.
	if v, _ := envValue(runner.req.Env, "SQLDEV_E2E_STAGE"); v != "dev" {
		t.Errorf("SQLDEV_E2E_STAGE = %q, want dev", v)
	}
	if v, _ := envValue(runner.req.Env, "SQLDEV_E2E_EXPECTED_ORIGIN"); v != "http://localhost:4321" {
		t.Errorf("SQLDEV_E2E_EXPECTED_ORIGIN = %q, want localhost", v)
	}
	if v, ok := envValue(runner.req.Env, "SQLDEV_E2E_TEST_USERS_JSON"); !ok || !strings.Contains(v, "user_id") {
		t.Errorf("SQLDEV_E2E_TEST_USERS_JSON = %q (ok=%v), want test-user JSON", v, ok)
	}
}

func stagingLinkedEnv() []string {
	return []string{
		`SST_RESOURCE_App={"name":"sqldev","stage":"staging"}`,
		`SST_RESOURCE_GoApi={"url":"https://api.example.com/"}`,
		`SST_RESOURCE_ClerkFeDomain={"value":"clerk.example.com"}`,
		`SST_RESOURCE_NotifySecret={"value":"notify-secret"}`,
		`SST_RESOURCE_ClerkPublicKey={"value":"pk"}`,
		`SST_RESOURCE_ClerkSecretKey={"value":"sk"}`,
		`SST_RESOURCE_SupabaseUrl={"value":"https://supabase.example.com"}`,
		`SST_RESOURCE_SupabaseKey={"value":"sb-key"}`,
		`SST_RESOURCE_CyTestUsersJson={"value":"[{\"user_id\":\"a\"},{\"user_id\":\"b\"}]"}`,
		`SST_RESOURCE_Frontend={"url":"https://dev.sqldev.gregosilaja.cc/"}`,
		`SST_RESOURCE_AstroAppDomain={"value":"dev.sqldev.gregosilaja.cc"}`,
	}
}

func TestCypressPassthroughStagingUsesDeployedOrigin(t *testing.T) {
	runner := &recordingRunner{}
	a := newTestApp(runner, stagingLinkedEnv())
	a.Cfg.Stage = "staging"

	if err := RunCypress(context.Background(), a, []string{"run"}); err != nil {
		t.Fatal(err)
	}
	if v, _ := envValue(runner.req.Env, "SQLDEV_E2E_STAGE"); v != "staging" {
		t.Errorf("SQLDEV_E2E_STAGE = %q, want staging", v)
	}
	if v, _ := envValue(runner.req.Env, "SQLDEV_E2E_EXPECTED_ORIGIN"); v != "https://dev.sqldev.gregosilaja.cc" {
		t.Errorf("SQLDEV_E2E_EXPECTED_ORIGIN = %q, want deployed origin", v)
	}
}

func TestCypressPassthroughRejectsUnsupportedStage(t *testing.T) {
	runner := &recordingRunner{}
	env := stagingLinkedEnv()
	// App.stage says preprod; configured stage preprod is unsupported.
	env[0] = `SST_RESOURCE_App={"name":"sqldev","stage":"preprod"}`
	a := newTestApp(runner, env)
	a.Cfg.Stage = "preprod"

	if err := RunCypress(context.Background(), a, []string{"run"}); err == nil {
		t.Fatal("expected unsupported-stage rejection")
	}
}

// Property 13: Cypress Arguments Are Transparent.
// Feature: stage-aware-cypress-harness, Property 13: Cypress Arguments Are Transparent
func TestProperty13CypressArgumentsAreTransparent(t *testing.T) {
	seed := proptest.Seed(t)
	cfg := &quick.Config{MaxCount: 200, Rand: rand.New(rand.NewSource(seed))}

	f := func(args []string) bool {
		runner := &recordingRunner{}
		a := newTestApp(runner, linkedEnv())
		if err := RunCypress(context.Background(), a, args); err != nil {
			return false
		}
		want := append([]string{"--no-install", "cypress"}, args...)
		if len(runner.req.Args) != len(want) {
			return false
		}
		for i := range want {
			if runner.req.Args[i] != want[i] {
				return false
			}
		}
		return runner.req.Program == "bunx"
	}

	if err := quick.Check(f, cfg); err != nil {
		t.Fatalf("Property 13 failed (seed=%d): %v", seed, err)
	}
}
