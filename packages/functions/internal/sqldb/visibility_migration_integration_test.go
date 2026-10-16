//go:build integration

package sqldb

import (
	"context"
	"math/rand"
	"testing"
	"testing/quick"
	"time"
)

// Feature: storage-visibility-confirmation, Property 2: The greatest revision is the current config.
//
// Every reader agrees the greatest config_version is current, even when it carries the
// oldest created_at and the rows are inserted in shuffled order.
func TestRevisionCurrentRow(t *testing.T) {
	pool := openTestDB(t)
	property(t, 2, "The greatest revision is current for every reader", func(t *testing.T) {
		ctx := context.Background()
		owner := newActor(t, pool)
		objectID := createObject(t, pool, owner)

		check := func(seed int64) bool {
			rng := rand.New(rand.NewSource(seed))
			n := 1 + rng.Intn(6)
			order := rng.Perm(n)
			if _, err := pool.Exec(ctx, `DELETE FROM public.d_storage_object_config WHERE storage_object_id = $1`, objectID); err != nil {
				t.Errorf("seed %d: reset history: %v", seed, err)
				return false
			}
			publics := make([]bool, n+1)
			now := time.Now().UTC()
			for _, idx := range order {
				revision := int64(idx + 1)
				publics[revision] = rng.Intn(2) == 0
				// The greatest revision gets the oldest timestamp.
				created := now.Add(-time.Duration(revision) * time.Minute).Add(time.Duration(rng.Intn(3)) * time.Second)
				if _, err := pool.Exec(ctx, `INSERT INTO public.d_storage_object_config (storage_object_id, public, config_version, created_at)
					VALUES ($1, $2, $3, $4)`, objectID, publics[revision], revision, created); err != nil {
					t.Errorf("seed %d: insert revision %d: %v", seed, revision, err)
					return false
				}
			}
			wantRev, wantPublic := int64(n), publics[n]
			gotRev, gotPublic := currentRevision(t, pool, objectID)
			var isPublic bool
			if err := pool.QueryRow(ctx, `SELECT public.d_storage_object_is_public($1)`, objectID).Scan(&isPublic); err != nil {
				t.Errorf("seed %d: is_public: %v", seed, err)
				return false
			}
			var viewRev int64
			var viewPublic bool
			if err := pool.QueryRow(ctx, `SELECT config_version, public FROM public.d_storage_objects_base_view WHERE storage_object_id = $1`,
				objectID).Scan(&viewRev, &viewPublic); err != nil {
				t.Errorf("seed %d: base view: %v", seed, err)
				return false
			}
			if gotRev != wantRev || gotPublic != wantPublic || isPublic != wantPublic || viewRev != wantRev || viewPublic != wantPublic {
				t.Errorf("seed %d: current = (%d,%v) is_public=%v view=(%d,%v), want (%d,%v)",
					seed, gotRev, gotPublic, isPublic, viewRev, viewPublic, wantRev, wantPublic)
				return false
			}
			return true
		}
		if err := quick.Check(check, &quick.Config{MaxCount: 100}); err != nil {
			t.Fatal(err)
		}
	})
}
