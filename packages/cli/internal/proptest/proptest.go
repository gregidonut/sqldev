// Package proptest provides a shared, reproducible property-test seed source
// for the Go property tests in this module. Seeds come from PBT_SEED when set
// so a reported failure can be replayed deterministically; otherwise a stable
// default is used so CI runs are reproducible by default.
package proptest

import (
	"os"
	"strconv"
	"testing"
)

// DefaultSeed is used when PBT_SEED is unset or invalid.
const DefaultSeed int64 = 1

// Seed returns the property-test seed, honoring the PBT_SEED environment
// variable, and logs it so a failure is replayable.
func Seed(t testing.TB) int64 {
	t.Helper()
	seed := DefaultSeed
	if raw, ok := os.LookupEnv("PBT_SEED"); ok {
		if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil {
			seed = parsed
		}
	}
	t.Logf("property seed = %d (set PBT_SEED to replay)", seed)
	return seed
}
