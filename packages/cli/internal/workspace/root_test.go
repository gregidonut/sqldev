package workspace

import (
	"os"
	"path/filepath"
	"testing"
)

func makeRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	for _, name := range []string{"sst.config.ts", "package.json"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func TestWalksUpToRoot(t *testing.T) {
	root := makeRoot(t)
	nested := filepath.Join(root, "packages", "cli", "cmd")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	got, err := FindRoot("", nested)
	if err != nil {
		t.Fatal(err)
	}
	// Resolve symlinks so macOS /var vs /private/var does not matter.
	if resolve(t, got) != resolve(t, root) {
		t.Errorf("root = %q, want %q", got, root)
	}
}

func TestExplicitRootValidated(t *testing.T) {
	root := makeRoot(t)
	got, err := FindRoot(root, "")
	if err != nil {
		t.Fatal(err)
	}
	if resolve(t, got) != resolve(t, root) {
		t.Errorf("root = %q, want %q", got, root)
	}
}

func TestExplicitRootWithoutMarkersErrors(t *testing.T) {
	dir := t.TempDir()
	if _, err := FindRoot(dir, ""); err == nil {
		t.Fatal("expected error for a directory without markers")
	}
}

func TestNoRootAboveErrors(t *testing.T) {
	dir := t.TempDir() // no markers anywhere up to the temp root
	if _, err := FindRoot("", dir); err == nil {
		t.Fatal("expected error when no root is found")
	}
}

func resolve(t *testing.T, path string) string {
	t.Helper()
	r, err := filepath.EvalSymlinks(path)
	if err != nil {
		return path
	}
	return r
}
