// Package workspace discovers the repository root. The CLI must not depend on
// the directory it was invoked from, so it either trusts an explicit root or
// walks upward looking for the markers that identify this repository.
package workspace

import (
	"fmt"
	"os"
	"path/filepath"
)

// Markers that together identify the SQLDev repository root.
var rootMarkers = []string{"sst.config.ts", "package.json"}

// FindRoot resolves the repository root. When explicit is non-empty it is
// validated and returned absolute. Otherwise FindRoot walks upward from start
// (defaulting to the current directory) until it finds a directory containing
// every marker.
func FindRoot(explicit, start string) (string, error) {
	if explicit != "" {
		abs, err := filepath.Abs(explicit)
		if err != nil {
			return "", err
		}
		if !hasMarkers(abs) {
			return "", fmt.Errorf("%s is not a sqldev repository root (expected %v)", abs, rootMarkers)
		}
		return abs, nil
	}

	if start == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return "", err
		}
		start = cwd
	}
	dir, err := filepath.Abs(start)
	if err != nil {
		return "", err
	}
	for {
		if hasMarkers(dir) {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf(
				"could not find the sqldev repository root above %s; pass --root or set SQLDEV_ROOT",
				start,
			)
		}
		dir = parent
	}
}

func hasMarkers(dir string) bool {
	for _, marker := range rootMarkers {
		if _, err := os.Stat(filepath.Join(dir, marker)); err != nil {
			return false
		}
	}
	return true
}
