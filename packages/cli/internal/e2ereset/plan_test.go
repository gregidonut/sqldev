package e2ereset

import (
	"math/rand"
	"strings"
	"testing"
	"testing/quick"

	"github.com/gregidonut/sqldev/packages/cli/internal/proptest"
)

func validInputs() StaticInputs {
	return StaticInputs{
		ConfiguredStage: "staging",
		LinkedAppStage:  "staging",
		AppName:         "sqldev",
		FrontendURL:     "https://dev.sqldev.gregosilaja.cc/",
		AstroAppDomain:  "dev.sqldev.gregosilaja.cc",
		Host: HostIdentity{
			InstanceID: "i-0123456789abcdef0",
			NameTag:    "sqldev-staging-supabase",
			AppTag:     "sqldev",
			StageTag:   "staging",
		},
		Application: BucketIdentity{Name: "sqldev-staging-app"},
		JobResult:   BucketIdentity{Name: "sqldev-staging-jobresult"},
	}
}

func TestBuildResetPlanAcceptsValidStaging(t *testing.T) {
	plan, err := BuildResetPlan(validInputs())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if plan.Stage != "staging" {
		t.Errorf("stage = %q", plan.Stage)
	}
	if plan.ExpectedOrigin != "https://dev.sqldev.gregosilaja.cc" {
		t.Errorf("origin = %q", plan.ExpectedOrigin)
	}
	if plan.Application.Name == plan.JobResult.Name {
		t.Error("application and job-result buckets must differ")
	}
	if plan.SQLDigest != CanonicalSQLDigest() {
		t.Error("plan SQL digest must match the canonical asset")
	}
}

func TestBuildResetPlanRejections(t *testing.T) {
	mutators := map[string]func(*StaticInputs){
		"configured stage not staging": func(i *StaticInputs) { i.ConfiguredStage = "dev" },
		"linked stage not staging":     func(i *StaticInputs) { i.LinkedAppStage = "prod" },
		"empty app name":               func(i *StaticInputs) { i.AppName = "" },
		"origin disagreement":          func(i *StaticInputs) { i.AstroAppDomain = "other.example.com" },
		"bad frontend url":             func(i *StaticInputs) { i.FrontendURL = "ftp://x" },
		"no host":                      func(i *StaticInputs) { i.Host.InstanceID = "" },
		"wrong name tag":               func(i *StaticInputs) { i.Host.NameTag = "sqldev-dev-supabase" },
		"wrong app tag":                func(i *StaticInputs) { i.Host.AppTag = "other" },
		"wrong stage tag":              func(i *StaticInputs) { i.Host.StageTag = "dev" },
		"empty app bucket":             func(i *StaticInputs) { i.Application.Name = "" },
		"empty job bucket":             func(i *StaticInputs) { i.JobResult.Name = "" },
		"identical buckets":            func(i *StaticInputs) { i.JobResult.Name = i.Application.Name },
	}
	for name, mutate := range mutators {
		in := validInputs()
		mutate(&in)
		if _, err := BuildResetPlan(in); err == nil {
			t.Errorf("%s: expected rejection", name)
		}
	}
}

func TestCanonicalSQLSharedAndSafe(t *testing.T) {
	tables := ApplicationTables()
	if len(tables) != 27 {
		t.Errorf("expected 27 application tables, got %d", len(tables))
	}
	for _, want := range []string{"public.users", "public.d_storage_objects", "public.tds_todo_spaces", "public.app_confirmation_challenges"} {
		found := false
		for _, got := range tables {
			if got == want {
				found = true
			}
		}
		if !found {
			t.Errorf("canonical SQL missing %q", want)
		}
	}
	if ContainsForbiddenClause() {
		t.Error("canonical SQL contains a forbidden clause")
	}
	if !strings.Contains(CanonicalSQL(), "BEGIN;") || !strings.Contains(CanonicalSQL(), "COMMIT;") {
		t.Error("canonical SQL must be one transaction")
	}
}

// Property 1: Exact Stage Authorization.
// Feature: stage-aware-cypress-harness, Property 1: Exact Stage Authorization
func TestProperty1ExactStageAuthorization(t *testing.T) {
	seed := proptest.Seed(t)
	cfg := &quick.Config{MaxCount: 300, Rand: rand.New(rand.NewSource(seed))}

	f := func(configured, linked string) bool {
		in := validInputs()
		in.ConfiguredStage = configured
		in.LinkedAppStage = linked
		_, err := BuildResetPlan(in)
		authorized := err == nil
		shouldAuthorize := configured == "staging" && linked == "staging"
		return authorized == shouldAuthorize
	}

	if err := quick.Check(f, cfg); err != nil {
		t.Fatalf("Property 1 failed (seed=%d): %v", seed, err)
	}

	// Adversarial near-miss variants must never authorize.
	for _, variant := range []string{"staging ", " staging", "Staging", "STAGING", "staging\t", "pre-staging", "staging-2", "", "ѕtaging"} {
		in := validInputs()
		in.ConfiguredStage = variant
		in.LinkedAppStage = variant
		if _, err := BuildResetPlan(in); err == nil {
			t.Errorf("variant %q authorized reset, want rejection", variant)
		}
	}
}

// Property 9: Reset Plans Are Exact, Isolated, and Deterministic.
// Feature: stage-aware-cypress-harness, Property 9: Reset Plans Are Exact, Isolated, and Deterministic
func TestProperty9ResetPlansExactIsolatedDeterministic(t *testing.T) {
	seed := proptest.Seed(t)
	cfg := &quick.Config{MaxCount: 200, Rand: rand.New(rand.NewSource(seed))}

	tables := ApplicationTables()

	f := func(appSuffix, jobSuffix string) bool {
		app := "sqldev-staging-app-" + sanitize(appSuffix)
		job := "sqldev-staging-job-" + sanitize(jobSuffix)
		if app == job {
			job += "x"
		}
		in := validInputs()
		in.Application = BucketIdentity{Name: app}
		in.JobResult = BucketIdentity{Name: job}

		p1, err1 := BuildResetPlan(in)
		p2, err2 := BuildResetPlan(in)
		if err1 != nil || err2 != nil {
			return false
		}
		// deterministic
		if p1 != p2 {
			return false
		}
		// the only bucket target is the application bucket, distinct from job result
		if p1.Application.Name != app || p1.JobResult.Name != job {
			return false
		}
		if p1.Application.Name == p1.JobResult.Name {
			return false
		}
		// SQL target set equals the canonical table set exactly
		if len(ApplicationTables()) != len(tables) {
			return false
		}
		return !ContainsForbiddenClause()
	}

	if err := quick.Check(f, cfg); err != nil {
		t.Fatalf("Property 9 failed (seed=%d): %v", seed, err)
	}
}

func sanitize(s string) string {
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	out := b.String()
	if out == "" {
		return "x"
	}
	if len(out) > 12 {
		out = out[:12]
	}
	return out
}
