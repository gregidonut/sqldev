package sst

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/gregidonut/sqldev/packages/cli/internal/process"
)

func TestLoadIndividualResources(t *testing.T) {
	env := EnvFromSlice([]string{
		`SST_RESOURCE_App={"name":"sqldev","stage":"dev"}`,
		`SST_RESOURCE_GoApi={"url":"https://api.example.com/"}`,
	})
	res, err := Load(env)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Has("GoApi") {
		t.Fatal("GoApi should be present")
	}
	url, err := res.String("GoApi", "url")
	if err != nil {
		t.Fatal(err)
	}
	if url != "https://api.example.com/" {
		t.Errorf("url = %q", url)
	}
}

func TestResourcesJSONOverlaysIndividual(t *testing.T) {
	env := EnvFromSlice([]string{
		`SST_RESOURCE_GoApi={"url":"https://old/"}`,
		`SST_RESOURCES_JSON={"GoApi":{"url":"https://new/"},"SQLDevBucket":{"name":"b"}}`,
	})
	res, err := Load(env)
	if err != nil {
		t.Fatal(err)
	}
	url, _ := res.String("GoApi", "url")
	if url != "https://new/" {
		t.Errorf("overlay failed: url = %q, want https://new/", url)
	}
	name, _ := res.String("SQLDevBucket", "name")
	if name != "b" {
		t.Errorf("name = %q, want b", name)
	}
}

func TestEncryptedKeyFileOverlays(t *testing.T) {
	key := make([]byte, 32) // all-zero 256-bit key
	payload := map[string]map[string]any{
		"SupabaseKey": {"value": "secret-value"},
	}
	plaintext, _ := json.Marshal(payload)

	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatal(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	nonce := make([]byte, gcm.NonceSize())
	ciphertext := gcm.Seal(nil, nonce, plaintext, nil)

	dir := t.TempDir()
	file := filepath.Join(dir, "resource.enc")
	if err := os.WriteFile(file, ciphertext, 0o600); err != nil {
		t.Fatal(err)
	}

	env := EnvFromSlice([]string{
		"SST_KEY=" + base64.StdEncoding.EncodeToString(key),
		"SST_KEY_FILE=" + file,
	})
	res, err := Load(env)
	if err != nil {
		t.Fatal(err)
	}
	value, err := res.String("SupabaseKey", "value")
	if err != nil {
		t.Fatal(err)
	}
	if value != "secret-value" {
		t.Errorf("value = %q, want secret-value", value)
	}
}

func TestMalformedResourceErrors(t *testing.T) {
	env := EnvFromSlice([]string{`SST_RESOURCE_GoApi={not json`})
	if _, err := Load(env); err == nil {
		t.Fatal("expected malformed resource JSON to error")
	}
}

func TestMissingPropertyErrors(t *testing.T) {
	env := EnvFromSlice([]string{`SST_RESOURCE_GoApi={"url":""}`})
	res, _ := Load(env)
	if _, err := res.String("GoApi", "url"); err == nil {
		t.Fatal("expected empty property to error")
	}
	if _, err := res.String("Nope", "x"); err == nil {
		t.Fatal("expected missing resource to error")
	}
}

func TestLinkedDetection(t *testing.T) {
	if EnvFromSlice([]string{"PATH=/x"}).Linked() {
		t.Error("plain env should not be linked")
	}
	if !EnvFromSlice([]string{`SST_RESOURCE_App={"name":"sqldev"}`}).Linked() {
		t.Error("App resource should mark linked")
	}
}

func TestBuildArgsPreservesOrder(t *testing.T) {
	args := BuildArgs(BootstrapConfig{
		Executable: "/abs/sqldev",
		Stage:      "dev",
		Args:       []string{"supabase", "db", "reset", "--local"},
	})
	want := []string{"--no-install", "sst", "--stage", "dev", "shell", "/abs/sqldev", "supabase", "db", "reset", "--local"}
	if len(args) != len(want) {
		t.Fatalf("args = %v", args)
	}
	for i := range want {
		if args[i] != want[i] {
			t.Fatalf("args = %v, want %v", args, want)
		}
	}
}

// recordingRunner captures the single request it receives.
type recordingRunner struct {
	req process.RunRequest
	ran bool
}

func (r *recordingRunner) Run(_ context.Context, req process.RunRequest) error {
	r.req = req
	r.ran = true
	return nil
}

func TestBootstrapRefusesRecursion(t *testing.T) {
	runner := &recordingRunner{}
	env := EnvFromSlice([]string{"SQLDEV_SST_BOOTSTRAPPED=1"})
	err := Bootstrap(context.Background(), runner, BootstrapConfig{
		Executable: "/abs/sqldev",
		Env:        env,
	})
	if err == nil {
		t.Fatal("expected recursion guard to error")
	}
	if runner.ran {
		t.Fatal("runner should not have been invoked on recursion")
	}
}

func TestBootstrapRunsFromRoot(t *testing.T) {
	runner := &recordingRunner{}
	err := Bootstrap(context.Background(), runner, BootstrapConfig{
		Executable: "/abs/sqldev",
		Args:       []string{"storage", "empty", "--yes"},
		Root:       "/repo",
		Stage:      "staging",
		Env:        EnvFromSlice(nil),
	})
	if err != nil {
		t.Fatal(err)
	}
	if runner.req.Program != "bunx" {
		t.Errorf("program = %q", runner.req.Program)
	}
	if runner.req.Dir != "/repo" {
		t.Errorf("dir = %q, want /repo", runner.req.Dir)
	}
	joined := join(runner.req.Args)
	if joined != "--no-install sst --stage staging shell /abs/sqldev storage empty --yes" {
		t.Errorf("args = %q", joined)
	}
}

func join(parts []string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += " "
		}
		out += p
	}
	return out
}
