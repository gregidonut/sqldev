// Package e2econfig resolves the stage-aware runtime configuration the Cypress
// harness needs from linked SST resources. It is the Go trust boundary for
// exact stage selection, deployed-origin agreement, and safe transport of the
// raw CyTestUsersJson secret to the Cypress configuration process.
//
// This package never parses or logs the test-user payload: it carries the raw
// value only so the TypeScript config can validate it once. Errors identify a
// resource and a remediation category, never a secret value.
package e2econfig

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
)

// Stage is a validated, exactly-matched supported E2E stage.
type Stage string

const (
	// StageDev is the exact local development stage.
	StageDev Stage = "dev"
	// StageStaging is the exact deployed staging stage.
	StageStaging Stage = "staging"
)

// LocalTarget is the fixed dev Cypress base URL and expected origin.
const LocalTarget = "http://localhost:4321"

// Environment variable keys carried only in the Cypress child process. The raw
// test-user payload uses an internal key so it never appears in Cypress's
// public config.env or in argv.
const (
	EnvStage          = "SQLDEV_E2E_STAGE"
	EnvExpectedOrigin = "SQLDEV_E2E_EXPECTED_ORIGIN"
	EnvTestUsersJSON  = "SQLDEV_E2E_TEST_USERS_JSON"
)

// SensitiveString wraps a secret value so it cannot leak through formatting,
// logging, or serialization. Only Reveal returns the underlying value, and it
// is called only when building the child process environment.
type SensitiveString struct {
	value string
}

// NewSensitiveString wraps v.
func NewSensitiveString(v string) SensitiveString { return SensitiveString{value: v} }

// Reveal returns the wrapped value. Call it only at the transport boundary.
func (s SensitiveString) Reveal() string { return s.value }

// String intentionally hides the value from fmt verbs and logging.
func (s SensitiveString) String() string { return "[redacted]" }

// GoString hides the value from %#v.
func (s SensitiveString) GoString() string { return "e2econfig.SensitiveString{[redacted]}" }

// MarshalJSON hides the value from JSON encoders.
func (s SensitiveString) MarshalJSON() ([]byte, error) { return []byte(`"[redacted]"`), nil }

// RuntimeConfig is the resolved, non-secret runtime plus the opaque raw secret.
type RuntimeConfig struct {
	Stage          Stage
	ExpectedOrigin string
	RawTestUsers   SensitiveString
}

// ResourceReader is the subset of sst.Resources this package needs, so tests
// can supply fakes without constructing the full loader.
type ResourceReader interface {
	String(name, property string) (string, error)
}

// ResolveRuntime builds the runtime config for the configured stage. It accepts
// only exact "dev" or "staging"; any other value is rejected before cleanup or
// Cypress execution. For staging it cross-checks Frontend.url against
// AstroAppDomain and requires their normalized origins to agree.
func ResolveRuntime(configuredStage string, res ResourceReader) (RuntimeConfig, error) {
	stage, err := parseStage(configuredStage)
	if err != nil {
		return RuntimeConfig{}, err
	}

	if err := assertLinkedAppStage(res, stage); err != nil {
		return RuntimeConfig{}, err
	}

	raw, err := res.String("CyTestUsersJson", "value")
	if err != nil {
		return RuntimeConfig{}, fmt.Errorf("CyTestUsersJson is not configured for stage %q: %w", stage, errRedactable(err))
	}

	origin, err := expectedOrigin(stage, res)
	if err != nil {
		return RuntimeConfig{}, err
	}

	return RuntimeConfig{
		Stage:          stage,
		ExpectedOrigin: origin,
		RawTestUsers:   NewSensitiveString(raw),
	}, nil
}

// CypressEnvironment renders the child-only environment entries. The raw secret
// is included exactly once here and nowhere else.
func (c RuntimeConfig) CypressEnvironment() []string {
	return []string{
		EnvStage + "=" + string(c.Stage),
		EnvExpectedOrigin + "=" + c.ExpectedOrigin,
		EnvTestUsersJSON + "=" + c.RawTestUsers.Reveal(),
	}
}

func parseStage(s string) (Stage, error) {
	switch s {
	case string(StageDev):
		return StageDev, nil
	case string(StageStaging):
		return StageStaging, nil
	default:
		return "", fmt.Errorf("stage %q is not a supported E2E stage; expected exactly %q or %q", s, StageDev, StageStaging)
	}
}

// assertLinkedAppStage requires the linked App.stage to match the configured
// stage so a mislinked environment cannot be targeted.
func assertLinkedAppStage(res ResourceReader, stage Stage) error {
	linked, err := res.String("App", "stage")
	if err != nil {
		return fmt.Errorf("linked App.stage is unavailable: %w", errRedactable(err))
	}
	if linked != string(stage) {
		return fmt.Errorf("linked App.stage does not equal configured stage %q", stage)
	}
	return nil
}

func expectedOrigin(stage Stage, res ResourceReader) (string, error) {
	if stage == StageDev {
		// Dev is fixed at localhost and never consults deployed values.
		return LocalTarget, nil
	}

	frontendURL, err := res.String("Frontend", "url")
	if err != nil {
		return "", fmt.Errorf("Frontend.url is unavailable for staging: %w", errRedactable(err))
	}
	appDomain, err := res.String("AstroAppDomain", "value")
	if err != nil {
		return "", fmt.Errorf("AstroAppDomain is unavailable for staging: %w", errRedactable(err))
	}

	frontendOrigin, err := NormalizeOrigin(frontendURL, false)
	if err != nil {
		return "", fmt.Errorf("Frontend.url is not a valid origin: %w", err)
	}
	domainOrigin, err := NormalizeOrigin(appDomain, true)
	if err != nil {
		return "", fmt.Errorf("AstroAppDomain is not a valid origin: %w", err)
	}
	if frontendOrigin != domainOrigin {
		return "", errors.New("staging Frontend.url and AstroAppDomain resolve to different origins")
	}
	return frontendOrigin, nil
}

// NormalizeOrigin converts a URL or hostname into a canonical scheme://host[:port]
// origin: lowercase scheme and host, explicit non-default port only, no user
// info, path, query, or fragment. When hostnameMayDefaultHTTPS is true, a bare
// hostname (no scheme) is treated as https. Errors never echo the raw value.
func NormalizeOrigin(raw string, hostnameMayDefaultHTTPS bool) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", errors.New("origin is empty")
	}

	if hostnameMayDefaultHTTPS && !strings.Contains(trimmed, "://") {
		trimmed = "https://" + trimmed
	}

	u, err := url.Parse(trimmed)
	if err != nil {
		return "", errors.New("origin is not a parseable URL")
	}

	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return "", errors.New("origin scheme must be http or https")
	}
	if u.User != nil {
		return "", errors.New("origin must not contain user information")
	}
	if u.Path != "" && u.Path != "/" {
		return "", errors.New("origin must not contain a path")
	}
	if u.RawQuery != "" || u.Fragment != "" {
		return "", errors.New("origin must not contain a query or fragment")
	}

	host := strings.ToLower(u.Hostname())
	if host == "" {
		return "", errors.New("origin must contain a host")
	}

	port := u.Port()
	if port != "" && isDefaultPort(scheme, port) {
		port = ""
	}

	if port == "" {
		return scheme + "://" + host, nil
	}
	return scheme + "://" + host + ":" + port, nil
}

func isDefaultPort(scheme, port string) bool {
	return (scheme == "http" && port == "80") || (scheme == "https" && port == "443")
}

// errRedactable keeps resource-not-configured errors category-only. The sst
// loader already avoids echoing decrypted values, so wrapping is sufficient.
func errRedactable(err error) error {
	if err == nil {
		return nil
	}
	return errors.New(err.Error())
}
