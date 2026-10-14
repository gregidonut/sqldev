package e2ereset

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/gregidonut/sqldev/packages/cli/internal/process"
)

func TestBuildVaultSecretsDerivesURLsAndKeepsSecret(t *testing.T) {
	got, err := BuildVaultSecrets("https://abc.execute-api.ap-east-1.amazonaws.com/staging/", "n0tify-s3cret")
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		VaultRenderMdURL:  "https://abc.execute-api.ap-east-1.amazonaws.com/staging/renderMd",
		VaultNotifyURL:    "https://abc.execute-api.ap-east-1.amazonaws.com/staging/notify",
		VaultNotifySecret: "n0tify-s3cret",
	}
	if len(got) != len(want) {
		t.Fatalf("got %d secrets, want %d", len(got), len(want))
	}
	for _, s := range got {
		if want[s.Name] != s.Value {
			t.Errorf("%s has an unexpected value", s.Name)
		}
	}
}

func TestBuildVaultSecretsNormalizesTrailingSlash(t *testing.T) {
	for _, in := range []string{"https://x.example.com/s", "https://x.example.com/s/", "https://x.example.com/s//"} {
		got, err := BuildVaultSecrets(in, "s")
		if err != nil {
			t.Fatalf("%q: %v", in, err)
		}
		if got[0].Value != "https://x.example.com/s/renderMd" && got[1].Value != "https://x.example.com/s/notify" {
			t.Errorf("%q: unexpected %v", in, got)
		}
	}
}

func TestBuildVaultSecretsRejectsUnusableValues(t *testing.T) {
	cases := map[string][2]string{
		"http url":         {"http://x.example.com/s/", "ok"},
		"empty url":        {"", "ok"},
		"url credentials":  {"https://u:p@x.example.com/s/", "ok"},
		"url query":        {"https://x.example.com/s/?a=1", "ok"},
		"empty secret":     {"https://x.example.com/s/", "   "},
		"newline secret":   {"https://x.example.com/s/", "a\nb"},
		"control secret":   {"https://x.example.com/s/", "a\x00b"},
		"marker in secret": {"https://x.example.com/s/", "a" + vaultHeredocMarker},
	}
	for name, c := range cases {
		if _, err := BuildVaultSecrets(c[0], c[1]); err == nil {
			t.Errorf("%s: expected rejection", name)
		}
	}
}

func TestBuildVaultSecretsErrorsNeverEchoValues(t *testing.T) {
	_, err := BuildVaultSecrets("https://x.example.com/s/", "bad\nsecret-value")
	if err == nil {
		t.Fatal("expected rejection")
	}
	if strings.Contains(err.Error(), "secret-value") {
		t.Errorf("error leaked the value: %v", err)
	}
	_, err = BuildVaultSecrets("http://leaky-host.example.com/path", "ok")
	if err == nil || strings.Contains(err.Error(), "leaky-host") {
		t.Errorf("error leaked the URL: %v", err)
	}
}

func TestVaultSecretNeverFormatsItsValue(t *testing.T) {
	s := VaultSecret{Name: VaultNotifySecret, Value: "super-secret-value"}
	for _, rendered := range []string{
		fmt.Sprintf("%v", s), fmt.Sprintf("%s", s), fmt.Sprintf("%+v", s), fmt.Sprintf("%#v", s),
	} {
		if strings.Contains(rendered, "super-secret-value") {
			t.Errorf("formatting leaked the value: %q", rendered)
		}
	}
}

func TestSQLLiteralEscapesQuotes(t *testing.T) {
	if got := sqlLiteral("it's"); got != "'it''s'" {
		t.Errorf("sqlLiteral = %q", got)
	}
	if got := sqlLiteral(`a\b`); got != `'a\b'` {
		t.Errorf("backslash must pass through for standard strings, got %q", got)
	}
}

func TestVaultSyncScriptIsSafeAndUpserts(t *testing.T) {
	secrets, _ := BuildVaultSecrets("https://x.example.com/s/", "pa'ss")
	script, err := vaultSyncScript(secrets)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"<<'" + vaultHeredocMarker + "'", // quoted heredoc: the shell never expands values
		"BEGIN;", "COMMIT;",              // one transaction
		"vault.update_secret", "vault.create_secret", // upsert by name
		"VERBOSITY=terse", // keeps statements out of error text
		`\g /dev/null`,    // discards returned ids
		"'pa''ss'",        // quote escaped
		"VAULT_SYNCED",
	} {
		if !strings.Contains(script, want) {
			t.Errorf("script missing %q", want)
		}
	}
	if strings.Contains(script, "decrypted_secret") {
		t.Error("the sync script must never read decrypted values")
	}
	for _, name := range RequiredVaultSecrets() {
		if !strings.Contains(script, "'"+name+"'") {
			t.Errorf("script missing secret name %s", name)
		}
	}
}

func TestVaultCheckScriptNeverReadsValues(t *testing.T) {
	script := vaultCheckScript()
	// It names the vault functions only to test the privilege to call them; it
	// must never read a decrypted value, open a transaction, or upsert.
	for _, forbidden := range []string{"decrypted_secret", "BEGIN;", "case when", "update_secret(id"} {
		if strings.Contains(script, forbidden) {
			t.Errorf("check script must be read-only and name-only; found %q", forbidden)
		}
	}
	if !strings.Contains(script, "from vault.secrets") {
		t.Error("check script should list names from vault.secrets")
	}
	if !strings.Contains(script, "has_function_privilege") {
		t.Error("check script should test the privilege to call the vault functions")
	}
}

func TestVaultSyncScriptRejectsBadInput(t *testing.T) {
	if _, err := vaultSyncScript(nil); err == nil {
		t.Error("expected rejection of an empty list")
	}
	if _, err := vaultSyncScript([]VaultSecret{{Name: "n", Value: "a\nb"}}); err == nil {
		t.Error("expected rejection of a newline value")
	}
}

func TestParseVaultState(t *testing.T) {
	out := "VAULT_NAMES_BEGIN\nnotify_ig_posts_view_url\nrender_md_url\nVAULT_NAMES_END\nVAULT_CAN_CREATE:\nt\nVAULT_CAN_UPDATE:\nf\n"
	st, err := parseVaultState(out)
	if err != nil {
		t.Fatal(err)
	}
	if len(st.Names) != 2 || !st.CanCreate || st.CanUpdate {
		t.Errorf("state = %+v", st)
	}
	missing := st.Missing()
	if len(missing) != 1 || missing[0] != VaultNotifySecret {
		t.Errorf("missing = %v", missing)
	}
	if _, err := parseVaultState("nothing here"); err == nil {
		t.Error("expected an error for an unparseable listing")
	}
}

// --- flow tests with a fake AWS CLI ---

type vaultFakeResources map[string]string

func (r vaultFakeResources) String(name, prop string) (string, error) {
	v, ok := r[name+"."+prop]
	if !ok || v == "" {
		return "", fmt.Errorf("%s.%s unavailable", name, prop)
	}
	return v, nil
}

func goodResources() vaultFakeResources {
	return vaultFakeResources{
		"App.stage":          "staging",
		"App.name":           "sqldev",
		"GoApi.url":          "https://x.execute-api.ap-east-1.amazonaws.com/staging/",
		"NotifySecret.value": "flow-secret-value",
	}
}

// vaultRunner fakes ec2 describe + ssm and records every SSM script.
type vaultRunner struct {
	scripts []string
	ssmOut  []string // stdout for successive ssm invocations
	idx     int
	hosts   string
}

func (r *vaultRunner) Run(_ context.Context, req process.RunRequest) error {
	args := strings.Join(req.Args, " ")
	switch {
	case strings.Contains(args, "ec2 describe-instances"):
		hosts := r.hosts
		if hosts == "" {
			hosts = `{"Reservations":[{"Instances":[{"InstanceId":"i-111","Tags":[{"Key":"Name","Value":"sqldev-staging-supabase"},{"Key":"Application","Value":"sqldev"},{"Key":"Stage","Value":"staging"}]}]}]}`
		}
		req.Stdout.Write([]byte(hosts))
	case strings.Contains(args, "ssm send-command"):
		for i, a := range req.Args {
			if a == "--parameters" {
				r.scripts = append(r.scripts, req.Args[i+1])
			}
		}
		req.Stdout.Write([]byte("cmd-1\n"))
	case strings.Contains(args, "ssm get-command-invocation"):
		out := ""
		if r.idx < len(r.ssmOut) {
			out = r.ssmOut[r.idx]
		}
		r.idx++
		req.Stdout.Write([]byte(`{"Status":"Success","StandardOutputContent":` + jsonString(out) + `}`))
	}
	return nil
}

const probeOut = `{"app_name":"sqldev","stage":"staging","app_bucket":"b","job_result_bucket":"j"}`
const emptyVault = "VAULT_NAMES_BEGIN\nVAULT_NAMES_END\nVAULT_CAN_CREATE:\nt\nVAULT_CAN_UPDATE:\nt\n"
const fullVault = "VAULT_SYNCED\nVAULT_NAMES_BEGIN\nnotify_ig_posts_view_secret\nnotify_ig_posts_view_url\nrender_md_url\nVAULT_NAMES_END\n"

func newVaultOpts(r process.Runner, preflight bool, out *bytes.Buffer) VaultOptions {
	return VaultOptions{
		ConfiguredStage: "staging", Region: "ap-east-1",
		Resources: goodResources(), Runner: r, Preflight: preflight, Stdout: out,
	}
}

func TestSyncVaultRefusesNonStagingBeforeAnyAWSCall(t *testing.T) {
	for _, stage := range []string{"dev", "prod", "production", "Staging", "staging ", ""} {
		r := &vaultRunner{}
		opts := newVaultOpts(r, false, &bytes.Buffer{})
		opts.ConfiguredStage = stage
		if err := SyncVault(context.Background(), opts); err == nil {
			t.Errorf("stage %q was accepted", stage)
		}
		if len(r.scripts) != 0 {
			t.Errorf("stage %q reached the host", stage)
		}
	}
}

func TestSyncVaultRefusesLinkedStageMismatch(t *testing.T) {
	r := &vaultRunner{}
	opts := newVaultOpts(r, false, &bytes.Buffer{})
	res := goodResources()
	res["App.stage"] = "dev"
	opts.Resources = res
	if err := SyncVault(context.Background(), opts); err == nil {
		t.Error("expected refusal when App.stage is not staging")
	}
}

func TestSyncVaultRefusesWhenHostIdentityDisagrees(t *testing.T) {
	r := &vaultRunner{ssmOut: []string{`{"app_name":"sqldev","stage":"prod","app_bucket":"b","job_result_bucket":"j"}`}}
	if err := SyncVault(context.Background(), newVaultOpts(r, false, &bytes.Buffer{})); err == nil {
		t.Error("expected refusal when the host reports another stage")
	}
	if len(r.scripts) != 1 {
		t.Errorf("only the identity probe may run, ran %d scripts", len(r.scripts))
	}
}

func TestSyncVaultPreflightWritesNothing(t *testing.T) {
	r := &vaultRunner{ssmOut: []string{probeOut, emptyVault}}
	var out bytes.Buffer
	if err := SyncVault(context.Background(), newVaultOpts(r, true, &out)); err != nil {
		t.Fatal(err)
	}
	for _, s := range r.scripts {
		if strings.Contains(s, "BEGIN;") || strings.Contains(s, "case when") {
			t.Error("preflight must not run the sync script")
		}
	}
	if !strings.Contains(out.String(), "missing=") {
		t.Errorf("preflight should report missing names: %q", out.String())
	}
	if strings.Contains(out.String(), "flow-secret-value") {
		t.Error("preflight output leaked a value")
	}
}

func TestSyncVaultSyncsAndNeverPrintsValues(t *testing.T) {
	r := &vaultRunner{ssmOut: []string{probeOut, emptyVault, fullVault}}
	var out bytes.Buffer
	if err := SyncVault(context.Background(), newVaultOpts(r, false, &out)); err != nil {
		t.Fatal(err)
	}
	if len(r.scripts) != 3 {
		t.Fatalf("expected probe + check + sync, got %d scripts", len(r.scripts))
	}
	if !strings.Contains(r.scripts[2], "BEGIN") {
		t.Error("the third script should be the sync")
	}
	for _, leaked := range []string{"flow-secret-value", "execute-api"} {
		if strings.Contains(out.String(), leaked) {
			t.Errorf("stdout leaked %q: %q", leaked, out.String())
		}
	}
	if !strings.Contains(out.String(), "render_md_url") {
		t.Errorf("stdout should list secret names: %q", out.String())
	}
}

func TestSyncVaultFailsWhenNamesStillMissing(t *testing.T) {
	partial := "VAULT_SYNCED\nVAULT_NAMES_BEGIN\nrender_md_url\nVAULT_NAMES_END\n"
	r := &vaultRunner{ssmOut: []string{probeOut, emptyVault, partial}}
	if err := SyncVault(context.Background(), newVaultOpts(r, false, &bytes.Buffer{})); err == nil {
		t.Error("expected failure when names are still missing after sync")
	}
}

func TestSyncVaultRefusesWithoutVaultPrivileges(t *testing.T) {
	noPriv := "VAULT_NAMES_BEGIN\nVAULT_NAMES_END\nVAULT_CAN_CREATE:\nf\nVAULT_CAN_UPDATE:\nf\n"
	r := &vaultRunner{ssmOut: []string{probeOut, noPriv}}
	if err := SyncVault(context.Background(), newVaultOpts(r, false, &bytes.Buffer{})); err == nil {
		t.Error("expected refusal without vault privileges")
	}
	if len(r.scripts) != 2 {
		t.Errorf("must not run the sync script, ran %d scripts", len(r.scripts))
	}
}

func TestSyncVaultFailureDoesNotEchoHostOutput(t *testing.T) {
	// A sync that returns without the confirmation marker must fail without
	// echoing whatever the host printed.
	r := &vaultRunner{ssmOut: []string{probeOut, emptyVault, "ERROR: statement contains flow-secret-value"}}
	err := SyncVault(context.Background(), newVaultOpts(r, false, &bytes.Buffer{}))
	if err == nil {
		t.Fatal("expected failure")
	}
	if strings.Contains(err.Error(), "flow-secret-value") {
		t.Errorf("error leaked host output: %v", err)
	}
}
