package tmux

import (
	"os"
	"path/filepath"
	"testing"
)

func writeExe(t *testing.T, dir, name string, content []byte) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, content, 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestMaterializeReusesSameDigest(t *testing.T) {
	src := t.TempDir()
	cache := filepath.Join(t.TempDir(), "bin")
	exe := writeExe(t, src, "sqldev", []byte("binary-A"))

	first, err := Materialize(cache, exe)
	if err != nil {
		t.Fatal(err)
	}
	second, err := Materialize(cache, exe)
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Errorf("same bytes produced different paths: %q vs %q", first, second)
	}
	info, err := os.Stat(first)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o700 {
		t.Errorf("mode = %v, want 0700", info.Mode().Perm())
	}
	dirInfo, _ := os.Stat(cache)
	if dirInfo.Mode().Perm() != 0o700 {
		t.Errorf("cache dir mode = %v, want 0700", dirInfo.Mode().Perm())
	}
}

func TestMaterializeDifferentBytesDifferentPaths(t *testing.T) {
	src := t.TempDir()
	cache := filepath.Join(t.TempDir(), "bin")
	a := writeExe(t, src, "a", []byte("binary-A"))
	b := writeExe(t, src, "b", []byte("binary-B-different"))

	pa, err := Materialize(cache, a)
	if err != nil {
		t.Fatal(err)
	}
	pb, err := Materialize(cache, b)
	if err != nil {
		t.Fatal(err)
	}
	if pa == pb {
		t.Error("different bytes should map to different cache paths")
	}
}

func TestMaterializeReplacesCorruptedEntry(t *testing.T) {
	src := t.TempDir()
	cache := filepath.Join(t.TempDir(), "bin")
	exe := writeExe(t, src, "sqldev", []byte("good-bytes"))

	dest, err := Materialize(cache, exe)
	if err != nil {
		t.Fatal(err)
	}
	// Corrupt the cached file in place.
	if err := os.WriteFile(dest, []byte("corrupted"), 0o700); err != nil {
		t.Fatal(err)
	}
	again, err := Materialize(cache, exe)
	if err != nil {
		t.Fatal(err)
	}
	if again != dest {
		t.Fatalf("digest path changed: %q vs %q", again, dest)
	}
	got, err := os.ReadFile(dest)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "good-bytes" {
		t.Errorf("cache not restored to source bytes: %q", got)
	}
}

func TestMaterializeRequiresInputs(t *testing.T) {
	if _, err := Materialize("", "x"); err == nil {
		t.Error("expected error for empty cache dir")
	}
	if _, err := Materialize("/tmp/x", ""); err == nil {
		t.Error("expected error for empty executable")
	}
}
