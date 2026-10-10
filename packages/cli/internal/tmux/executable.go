package tmux

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// Materialize copies the running executable into an immutable, content-addressed
// cache path so detached tmux panes can re-exec a stable binary even when the
// outer CLI was started through `go run` (whose temp binary disappears). It
// returns the absolute cached path.
//
// cacheDir is the directory to store binaries in; when empty the caller should
// have already resolved the default. currentExe is the path to the running
// binary (os.Executable()).
func Materialize(cacheDir, currentExe string) (string, error) {
	if cacheDir == "" {
		return "", fmt.Errorf("tmux: cache directory is required")
	}
	if currentExe == "" {
		return "", fmt.Errorf("tmux: current executable path is required")
	}
	if err := os.MkdirAll(cacheDir, 0o700); err != nil {
		return "", err
	}

	src, err := os.Open(currentExe)
	if err != nil {
		return "", err
	}
	defer src.Close()

	hasher := sha256.New()
	if _, err := io.Copy(hasher, src); err != nil {
		return "", err
	}
	digest := hex.EncodeToString(hasher.Sum(nil))
	dest := filepath.Join(cacheDir, "sqldev-"+digest)

	// Reuse an existing cached binary only when its content matches the digest.
	if existing, err := os.Open(dest); err == nil {
		matches, verifyErr := digestMatches(existing, digest)
		existing.Close()
		if verifyErr == nil && matches {
			return dest, nil
		}
		// A corrupted or mismatched cache entry is replaced atomically below;
		// never write in place.
	}

	if _, err := src.Seek(0, io.SeekStart); err != nil {
		return "", err
	}
	tmp, err := os.CreateTemp(cacheDir, "sqldev-*.tmp")
	if err != nil {
		return "", err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // no-op after a successful rename

	if _, err := io.Copy(tmp, src); err != nil {
		tmp.Close()
		return "", err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return "", err
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}
	if err := os.Chmod(tmpName, 0o700); err != nil {
		return "", err
	}
	if err := os.Rename(tmpName, dest); err != nil {
		return "", err
	}
	return dest, nil
}

func digestMatches(r io.Reader, want string) (bool, error) {
	hasher := sha256.New()
	if _, err := io.Copy(hasher, r); err != nil {
		return false, err
	}
	return hex.EncodeToString(hasher.Sum(nil)) == want, nil
}
