package e2ereset

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"sort"
	"strings"

	"github.com/gregidonut/sqldev/packages/cli/internal/process"
)

// Names of the Supabase Vault secrets the database triggers read. Locally they
// come from packages/backend/supabase/config.toml [db.vault]; the deployed host
// has nothing that creates them, so this command provisions them.
const (
	VaultRenderMdURL   = "render_md_url"
	VaultNotifyURL     = "notify_ig_posts_view_url"
	VaultNotifySecret  = "notify_ig_posts_view_secret"
	vaultHeredocMarker = "SQLDEV_VAULT_SQL"
)

// RequiredVaultSecrets lists every secret name the triggers need, sorted.
func RequiredVaultSecrets() []string {
	names := []string{VaultRenderMdURL, VaultNotifyURL, VaultNotifySecret}
	sort.Strings(names)
	return names
}

// VaultSecret is one name/value pair to store in the host's Vault.
type VaultSecret struct {
	Name  string
	Value string
}

// String hides the value so a secret cannot leak through formatting or logs.
func (s VaultSecret) String() string { return s.Name + "=[redacted]" }

// GoString hides the value from %#v.
func (s VaultSecret) GoString() string { return "e2ereset.VaultSecret{" + s.Name + ", [redacted]}" }

// BuildVaultSecrets derives the three secrets from linked values. The URLs use
// the same shape the local config.toml uses: the linked GoApi.url plus the path.
// Errors are category-only and never echo a value.
func BuildVaultSecrets(goAPIURL, notifySecret string) ([]VaultSecret, error) {
	base, err := normalizeAPIBase(goAPIURL)
	if err != nil {
		return nil, err
	}
	if err := validateSecretValue(notifySecret); err != nil {
		return nil, errors.New("linked NotifySecret is not usable")
	}
	return []VaultSecret{
		{Name: VaultRenderMdURL, Value: base + "renderMd"},
		{Name: VaultNotifyURL, Value: base + "notify"},
		{Name: VaultNotifySecret, Value: notifySecret},
	}, nil
}

// normalizeAPIBase requires an https URL with a host and returns it with exactly
// one trailing slash, so "renderMd" and "notify" append cleanly.
func normalizeAPIBase(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	u, err := url.Parse(trimmed)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" {
		return "", errors.New("linked GoApi.url is not an https URL")
	}
	if u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", errors.New("linked GoApi.url must not contain credentials, a query, or a fragment")
	}
	if err := validateSecretValue(trimmed); err != nil {
		return "", errors.New("linked GoApi.url is not usable")
	}
	return strings.TrimRight(trimmed, "/") + "/", nil
}

// validateSecretValue rejects values that could break out of the fixed script:
// empty values, control characters (including newlines), and NUL.
func validateSecretValue(v string) error {
	if strings.TrimSpace(v) == "" {
		return errors.New("empty")
	}
	for _, r := range v {
		if r < 0x20 || r == 0x7f {
			return errors.New("control character")
		}
	}
	if strings.Contains(v, vaultHeredocMarker) {
		return errors.New("reserved marker")
	}
	return nil
}

// sqlLiteral renders v as a standard-conforming SQL string literal.
func sqlLiteral(v string) string {
	return "'" + strings.ReplaceAll(v, "'", "''") + "'"
}

const hostPsqlPrelude = `set -euo pipefail
set -a
source /run/sqldev/db.env
set +a
# terse verbosity keeps failing statements (and so values) out of error text.
q() { docker exec -i -e PGPASSWORD="${POSTGRES_PASSWORD}" sqldev-db psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=1 -v VERBOSITY=terse; }
`

// vaultCheckScript is read-only: it prints secret NAMES and whether postgres may
// call the vault functions. It never selects a decrypted value.
func vaultCheckScript() string {
	return hostPsqlPrelude + `echo "VAULT_NAMES_BEGIN"
q <<'` + vaultHeredocMarker + `'
select name from vault.secrets order by name;
` + vaultHeredocMarker + `
echo "VAULT_NAMES_END"
echo "VAULT_CAN_CREATE:"
q <<'` + vaultHeredocMarker + `'
select has_function_privilege(current_user, 'vault.create_secret(text,text,text,uuid)', 'execute');
` + vaultHeredocMarker + `
echo "VAULT_CAN_UPDATE:"
q <<'` + vaultHeredocMarker + `'
select has_function_privilege(current_user, 'vault.update_secret(uuid,text,text,text,uuid)', 'execute');
` + vaultHeredocMarker + `
`
}

// vaultSyncScript upserts each secret by name (create when absent, update when
// present) in one transaction, discards the returned ids, then lists NAMES only.
func vaultSyncScript(secrets []VaultSecret) (string, error) {
	if len(secrets) == 0 {
		return "", errors.New("no vault secrets to sync")
	}
	var sql strings.Builder
	sql.WriteString("BEGIN;\n")
	for _, s := range secrets {
		if err := validateSecretValue(s.Value); err != nil {
			return "", errors.New("a vault secret value is not usable")
		}
		name := sqlLiteral(s.Name)
		value := sqlLiteral(s.Value)
		fmt.Fprintf(&sql,
			"select case when exists (select 1 from vault.secrets where name = %[1]s) "+
				"then (select vault.update_secret(id, %[2]s, %[1]s) from vault.secrets where name = %[1]s)::text "+
				"else vault.create_secret(%[2]s, %[1]s)::text end \\g /dev/null\n",
			name, value)
	}
	sql.WriteString("COMMIT;\n")

	return hostPsqlPrelude + `q <<'` + vaultHeredocMarker + `'
` + sql.String() + vaultHeredocMarker + `
echo "VAULT_SYNCED"
echo "VAULT_NAMES_BEGIN"
q <<'` + vaultHeredocMarker + `'
select name from vault.secrets order by name;
` + vaultHeredocMarker + `
echo "VAULT_NAMES_END"
`, nil
}

// VaultState is what a check or sync reports: names only.
type VaultState struct {
	Names     []string
	CanCreate bool
	CanUpdate bool
}

// Missing returns required names absent from the host's Vault.
func (s VaultState) Missing() []string {
	have := map[string]bool{}
	for _, n := range s.Names {
		have[n] = true
	}
	var missing []string
	for _, n := range RequiredVaultSecrets() {
		if !have[n] {
			missing = append(missing, n)
		}
	}
	return missing
}

func parseVaultState(out string) (VaultState, error) {
	begin := strings.Index(out, "VAULT_NAMES_BEGIN")
	end := strings.Index(out, "VAULT_NAMES_END")
	if begin < 0 || end < begin {
		return VaultState{}, errors.New("vault listing was not returned by the host")
	}
	var names []string
	for _, line := range strings.Split(out[begin+len("VAULT_NAMES_BEGIN"):end], "\n") {
		if name := strings.TrimSpace(line); name != "" {
			names = append(names, name)
		}
	}
	state := VaultState{Names: names}
	state.CanCreate = markerIsTrue(out, "VAULT_CAN_CREATE:")
	state.CanUpdate = markerIsTrue(out, "VAULT_CAN_UPDATE:")
	return state, nil
}

func markerIsTrue(out, marker string) bool {
	i := strings.Index(out, marker)
	if i < 0 {
		return false
	}
	rest := strings.TrimLeft(out[i+len(marker):], " \t\r\n")
	return strings.HasPrefix(rest, "t")
}

// VaultOptions configures a vault provisioning run.
type VaultOptions struct {
	ConfiguredStage string
	Region          string
	Resources       ResourceReader
	Runner          process.Runner
	Preflight       bool
	Stdout          io.Writer
}

// SyncVault provisions the Vault secrets on the exact staging host, or with
// Preflight only reports which names are present. It authorizes only when the
// configured and linked stages are exactly "staging" and the host's own view of
// its application and stage agrees. It prints names, never values.
func SyncVault(ctx context.Context, opts VaultOptions) error {
	if opts.ConfiguredStage != stagingStage {
		return fmt.Errorf("vault sync refused: configured stage is not exactly %q", stagingStage)
	}
	linkedStage, err := opts.Resources.String("App", "stage")
	if err != nil || linkedStage != stagingStage {
		return fmt.Errorf("vault sync refused: linked App.stage is not exactly %q", stagingStage)
	}
	appName, err := opts.Resources.String("App", "name")
	if err != nil {
		return errors.New("vault sync refused: linked App.name is unavailable")
	}
	goAPI, err := opts.Resources.String("GoApi", "url")
	if err != nil {
		return errors.New("vault sync refused: linked GoApi.url is unavailable")
	}
	notifySecret, err := opts.Resources.String("NotifySecret", "value")
	if err != nil {
		return errors.New("vault sync refused: linked NotifySecret is unavailable")
	}
	secrets, err := BuildVaultSecrets(goAPI, notifySecret)
	if err != nil {
		return err
	}

	host, err := (&HostDiscoverer{Runner: opts.Runner, Region: opts.Region}).ResolveStagingHost(ctx, appName)
	if err != nil {
		return err
	}
	if host.NameTag != "sqldev-"+stagingStage+"-supabase" || host.AppTag != appName || host.StageTag != stagingStage {
		return errors.New("vault sync refused: staging host tags do not match")
	}

	executor := NewHostExecutor(opts.Runner, opts.Region)
	identity, err := executor.ProbeIdentity(ctx, host.InstanceID)
	if err != nil {
		return err
	}
	if identity.Stage != stagingStage || identity.AppName != appName {
		return errors.New("vault sync refused: staging host identity disagrees with the linked app")
	}

	out, err := executor.runShell(ctx, host.InstanceID, vaultCheckScript())
	if err != nil {
		return err
	}
	before, err := parseVaultState(out)
	if err != nil {
		return err
	}

	if opts.Preflight {
		fmt.Fprintf(opts.Stdout, "vault preflight: host=%s present=%v missing=%v can_create=%t can_update=%t\n",
			host.InstanceID, before.Names, before.Missing(), before.CanCreate, before.CanUpdate)
		return nil
	}
	if !before.CanCreate || !before.CanUpdate {
		return errors.New("vault sync refused: the database user cannot call the vault functions")
	}

	script, err := vaultSyncScript(secrets)
	if err != nil {
		return err
	}
	out, err = executor.runShell(ctx, host.InstanceID, script)
	if err != nil {
		// The host's stderr is never surfaced: it could echo a statement.
		return errors.New("vault sync failed on the staging host")
	}
	if !strings.Contains(out, "VAULT_SYNCED") {
		return errors.New("vault sync did not confirm completion")
	}
	after, err := parseVaultState(out)
	if err != nil {
		return err
	}
	if missing := after.Missing(); len(missing) > 0 {
		return fmt.Errorf("vault sync incomplete: still missing %v", missing)
	}
	fmt.Fprintf(opts.Stdout, "vault synced: secrets=%v\n", after.Names)
	return nil
}
