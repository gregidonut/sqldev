package e2econfig

import (
	"fmt"
	"math/rand"
	"strings"
	"testing"
	"testing/quick"

	"github.com/gregidonut/sqldev/packages/cli/internal/proptest"
)

func propertySeed(t testing.TB) int64 { return proptest.Seed(t) }

// fakeResources is an in-memory ResourceReader for tests. It never holds a real
// secret value.
type fakeResources struct {
	values map[string]string // "Name.property" -> value
}

func (f fakeResources) String(name, property string) (string, error) {
	key := name + "." + property
	v, ok := f.values[key]
	if !ok || strings.TrimSpace(v) == "" {
		return "", fmt.Errorf("%q.%q is empty", name, property)
	}
	return v, nil
}

func devResources() fakeResources {
	return fakeResources{values: map[string]string{
		"App.stage":             "dev",
		"CyTestUsersJson.value": `[{"user_id":"a"},{"user_id":"b"}]`,
	}}
}

func stagingResources() fakeResources {
	return fakeResources{values: map[string]string{
		"App.stage":             "staging",
		"CyTestUsersJson.value": `[{"user_id":"a"},{"user_id":"b"}]`,
		"Frontend.url":          "https://dev.sqldev.gregosilaja.cc/",
		"AstroAppDomain.value":  "dev.sqldev.gregosilaja.cc",
	}}
}

func TestResolveRuntimeDevUsesLocalTarget(t *testing.T) {
	got, err := ResolveRuntime("dev", devResources())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Stage != StageDev {
		t.Errorf("stage = %q, want dev", got.Stage)
	}
	if got.ExpectedOrigin != LocalTarget {
		t.Errorf("origin = %q, want %q", got.ExpectedOrigin, LocalTarget)
	}
}

func TestResolveRuntimeDevIgnoresDeployedValues(t *testing.T) {
	res := devResources()
	// Even wildly wrong frontend/domain values must not affect dev.
	res.values["Frontend.url"] = "https://evil.example.com"
	res.values["AstroAppDomain.value"] = "other.example.com"
	got, err := ResolveRuntime("dev", res)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.ExpectedOrigin != LocalTarget {
		t.Errorf("dev origin = %q, want %q", got.ExpectedOrigin, LocalTarget)
	}
}

func TestResolveRuntimeStagingAgreement(t *testing.T) {
	got, err := ResolveRuntime("staging", stagingResources())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.ExpectedOrigin != "https://dev.sqldev.gregosilaja.cc" {
		t.Errorf("origin = %q", got.ExpectedOrigin)
	}
}

func TestResolveRuntimeStagingDisagreementFails(t *testing.T) {
	res := stagingResources()
	res.values["AstroAppDomain.value"] = "different.example.com"
	_, err := ResolveRuntime("staging", res)
	if err == nil {
		t.Fatal("expected disagreement error")
	}
	if strings.Contains(err.Error(), "gregosilaja") {
		t.Error("error leaked a resource value")
	}
}

func TestResolveRuntimeRejectsUnsupportedStage(t *testing.T) {
	for _, stage := range []string{"", "prod", "production", "Dev", "staging ", "preprod", "development"} {
		if _, err := ResolveRuntime(stage, stagingResources()); err == nil {
			t.Errorf("stage %q was accepted, want rejection", stage)
		}
	}
}

func TestResolveRuntimeRejectsAppStageMismatch(t *testing.T) {
	res := stagingResources()
	res.values["App.stage"] = "dev"
	if _, err := ResolveRuntime("staging", res); err == nil {
		t.Fatal("expected App.stage mismatch rejection")
	}
}

func TestResolveRuntimeMissingSecretFails(t *testing.T) {
	res := devResources()
	delete(res.values, "CyTestUsersJson.value")
	if _, err := ResolveRuntime("dev", res); err == nil {
		t.Fatal("expected missing secret rejection")
	}
}

func TestCypressEnvironmentCarriesRawSecretOnce(t *testing.T) {
	rc := RuntimeConfig{
		Stage:          StageStaging,
		ExpectedOrigin: "https://dev.sqldev.gregosilaja.cc",
		RawTestUsers:   NewSensitiveString(`[{"user_id":"x"},{"user_id":"y"}]`),
	}
	env := rc.CypressEnvironment()
	joined := strings.Join(env, "\n")
	if !strings.Contains(joined, EnvTestUsersJSON+"=") {
		t.Fatal("test-users env entry missing")
	}
	if strings.Count(joined, `"user_id":"x"`) != 1 {
		t.Error("raw secret should appear exactly once")
	}
}

func TestSensitiveStringNeverRevealsThroughFormatting(t *testing.T) {
	s := NewSensitiveString("super-secret-identifier")
	for _, rendered := range []string{
		fmt.Sprintf("%v", s),
		fmt.Sprintf("%s", s),
		fmt.Sprintf("%#v", s),
		fmt.Sprintf("%+v", s),
	} {
		if strings.Contains(rendered, "super-secret-identifier") {
			t.Errorf("formatting leaked the value: %q", rendered)
		}
	}
	b, _ := s.MarshalJSON()
	if strings.Contains(string(b), "super-secret-identifier") {
		t.Errorf("MarshalJSON leaked the value: %q", b)
	}
	if s.Reveal() != "super-secret-identifier" {
		t.Error("Reveal must return the real value at the transport boundary")
	}
}

// TestNormalizeOriginIdempotentAndEquivalent covers Requirement 1.5 directly.
func TestNormalizeOriginIdempotentAndEquivalent(t *testing.T) {
	cases := []struct {
		raw      string
		defHTTPS bool
		want     string
	}{
		{"https://Dev.SQLDev.gregosilaja.cc/", false, "https://dev.sqldev.gregosilaja.cc"},
		{"https://dev.sqldev.gregosilaja.cc:443", false, "https://dev.sqldev.gregosilaja.cc"},
		{"http://localhost:4321", false, "http://localhost:4321"},
		{"http://localhost:80", false, "http://localhost"},
		{"dev.sqldev.gregosilaja.cc", true, "https://dev.sqldev.gregosilaja.cc"},
		{"HTTPS://EXAMPLE.COM:8443/", false, "https://example.com:8443"},
	}
	for _, c := range cases {
		got, err := NormalizeOrigin(c.raw, c.defHTTPS)
		if err != nil {
			t.Errorf("NormalizeOrigin(%q) error: %v", c.raw, err)
			continue
		}
		if got != c.want {
			t.Errorf("NormalizeOrigin(%q) = %q, want %q", c.raw, got, c.want)
		}
		again, err := NormalizeOrigin(got, false)
		if err != nil || again != got {
			t.Errorf("normalization not idempotent for %q: %q -> %q (%v)", c.raw, got, again, err)
		}
	}
}

func TestNormalizeOriginRejectsNonOrigins(t *testing.T) {
	for _, raw := range []string{
		"", "   ",
		"ftp://example.com",
		"https://user:pw@example.com",
		"https://example.com/path",
		"https://example.com/?q=1",
		"https://example.com/#frag",
		"://nohost",
		"not a url at all with spaces",
	} {
		if _, err := NormalizeOrigin(raw, false); err == nil {
			t.Errorf("NormalizeOrigin(%q) accepted, want rejection", raw)
		}
	}
}

// --- Property tests ---

// Property 3: Origin Normalization Is Canonical.
// Feature: stage-aware-cypress-harness, Property 3: Origin Normalization Is Canonical
func TestProperty3OriginNormalizationIsCanonical(t *testing.T) {
	seed := propertySeed(t)
	cfg := &quick.Config{MaxCount: 200, Rand: rand.New(rand.NewSource(seed))}

	schemes := []string{"http", "https"}
	hosts := []string{"localhost", "dev.sqldev.gregosilaja.cc", "Example.COM", "a.b.c"}

	// For a generated valid origin, repeated normalization is idempotent, and
	// case/default-port/trailing-slash variants produce the same origin.
	f := func(schemeIdx, hostIdx uint8, upperScheme, upperHost, trailingSlash, defaultPort bool) bool {
		scheme := schemes[int(schemeIdx)%len(schemes)]
		host := hosts[int(hostIdx)%len(hosts)]

		base, err := NormalizeOrigin(scheme+"://"+host, false)
		if err != nil {
			return false
		}

		variantScheme := scheme
		if upperScheme {
			variantScheme = strings.ToUpper(scheme)
		}
		variantHost := host
		if upperHost {
			variantHost = strings.ToUpper(host)
		}
		variant := variantScheme + "://" + variantHost
		if defaultPort {
			if scheme == "http" {
				variant += ":80"
			} else {
				variant += ":443"
			}
		}
		if trailingSlash {
			variant += "/"
		}

		got, err := NormalizeOrigin(variant, false)
		if err != nil {
			return false
		}
		if got != base {
			return false
		}
		// idempotence
		again, err := NormalizeOrigin(got, false)
		return err == nil && again == got
	}

	if err := quick.Check(f, cfg); err != nil {
		t.Fatalf("Property 3 failed (seed=%d): %v", seed, err)
	}
}

// Property 2: Stage Target Selection and Agreement.
// Feature: stage-aware-cypress-harness, Property 2: Stage Target Selection and Agreement
func TestProperty2StageTargetSelectionAndAgreement(t *testing.T) {
	seed := propertySeed(t)
	cfg := &quick.Config{MaxCount: 200, Rand: rand.New(rand.NewSource(seed))}

	// Dev is always localhost regardless of deployed values; staging succeeds
	// only when both deployed origins agree, and never leaks values.
	f := func(frontendHost, domainHost string, stagingStage bool) bool {
		res := fakeResources{values: map[string]string{
			"CyTestUsersJson.value": `[{"user_id":"a"},{"user_id":"b"}]`,
		}}

		if !stagingStage {
			res.values["App.stage"] = "dev"
			res.values["Frontend.url"] = "https://" + sanitizeHost(frontendHost) + ".example.com"
			res.values["AstroAppDomain.value"] = sanitizeHost(domainHost) + ".example.com"
			got, err := ResolveRuntime("dev", res)
			return err == nil && got.ExpectedOrigin == LocalTarget
		}

		fh := sanitizeHost(frontendHost)
		dh := sanitizeHost(domainHost)
		res.values["App.stage"] = "staging"
		res.values["Frontend.url"] = "https://" + fh + ".example.com/"
		res.values["AstroAppDomain.value"] = dh + ".example.com"

		got, err := ResolveRuntime("staging", res)
		if fh == dh {
			return err == nil && got.ExpectedOrigin == "https://"+fh+".example.com"
		}
		return err != nil
	}

	if err := quick.Check(f, cfg); err != nil {
		t.Fatalf("Property 2 failed (seed=%d): %v", seed, err)
	}
}

// sanitizeHost reduces generated strings to a safe DNS label so the generated
// URL is parseable; the property is about agreement, not URL fuzzing.
func sanitizeHost(s string) string {
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	out := b.String()
	if out == "" {
		return "host"
	}
	if len(out) > 20 {
		out = out[:20]
	}
	return out
}
