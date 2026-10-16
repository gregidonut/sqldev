//go:build integration

package sqldb

import (
	"context"
	"fmt"
	"math/rand"
	"sync"
	"testing"

	"github.com/google/uuid"
)

type workerResult struct {
	kind      string
	requestID uuid.UUID
	confirmed bool // this worker confirmed a challenge
	err       error
}

// raceAll starts every job at once on its own connection and collects results.
func raceAll(jobs []func() workerResult) []workerResult {
	results := make([]workerResult, len(jobs))
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i, job := range jobs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			results[i] = job()
		}()
	}
	close(start)
	wg.Wait()
	return results
}

func TestConcurrentWritersAllocateAtMostOneRevision(t *testing.T) {
	pool := openTestDB(t)
	property(t, 7, "Concurrent writers allocate at most one next revision", func(t *testing.T) {
		ctx := context.Background()
		owner := newActor(t, pool)

		for i := 0; i < 120; i++ {
			seed := int64(7000 + i)
			rng := rand.New(rand.NewSource(seed))
			workers := 2 + rng.Intn(7)
			family := []string{"shared-challenge", "make-private", "supersession", "confirm-and-private", "confirm-and-initiate"}[i%5]

			objectID := createObject(t, pool, owner)
			var jobs []func() workerResult
			var challenges []map[string]any
			var revision int64
			strict := true // non-winners must be stale/consumed/superseded only
			wantWinner := false

			switch family {
			case "make-private":
				makeObjectPublic(t, pool, owner, objectID)
				revision, _ = currentRevision(t, pool, objectID)
				for w := 0; w < workers; w++ {
					id := uuid.New()
					jobs = append(jobs, func() workerResult {
						r, err := callJSON(ctx, pool, owner.Sub, `public.make_d_storage_object_private($1, $2, $3)`, objectID, revision, id)
						return workerResult{kind: kindOf(r), requestID: id, err: err}
					})
				}
				wantWinner = true
			case "supersession":
				revision = 1
				first, err := begin(ctx, pool, owner, objectID, revision)
				if err != nil {
					t.Fatal(err)
				}
				second, err := begin(ctx, pool, owner, objectID, revision) // supersedes first
				if err != nil {
					t.Fatal(err)
				}
				challenges = []map[string]any{first, second}
				usesSecond := false
				for w := 0; w < workers; w++ {
					which := rng.Intn(2)
					usesSecond = usesSecond || which == 1
					id, c := uuid.New(), challenges[which]
					jobs = append(jobs, func() workerResult {
						r, err := confirm(ctx, pool, owner, c, objectID, revision, id)
						return workerResult{kind: kindOf(r), requestID: id, confirmed: true, err: err}
					})
				}
				wantWinner = usesSecond
			default:
				revision = 1
				c, err := begin(ctx, pool, owner, objectID, revision)
				if err != nil {
					t.Fatal(err)
				}
				challenges = []map[string]any{c}
				if family == "confirm-and-initiate" {
					strict = false
				}
				confirms := 0
				for w := 0; w < workers; w++ {
					id := uuid.New()
					kind := "confirm"
					if family == "confirm-and-private" && rng.Intn(3) == 0 {
						kind = "private"
					}
					if family == "confirm-and-initiate" && rng.Intn(3) == 0 {
						kind = "initiate"
					}
					switch kind {
					case "private":
						jobs = append(jobs, func() workerResult {
							r, err := callJSON(ctx, pool, owner.Sub, `public.make_d_storage_object_private($1, $2, $3)`, objectID, revision, id)
							return workerResult{kind: kindOf(r), requestID: id, err: err}
						})
					case "initiate":
						jobs = append(jobs, func() workerResult {
							r, err := beginWith(ctx, pool, owner, objectID, revision, id)
							return workerResult{kind: kindOf(r), requestID: id, err: err}
						})
					default:
						confirms++
						jobs = append(jobs, func() workerResult {
							r, err := confirm(ctx, pool, owner, c, objectID, revision, id)
							return workerResult{kind: kindOf(r), requestID: id, confirmed: true, err: err}
						})
					}
				}
				wantWinner = confirms > 0 && family != "confirm-and-initiate"
			}

			results := raceAll(jobs)

			successes := 0
			var winner workerResult
			for _, r := range results {
				if r.err != nil {
					t.Fatalf("seed %d family %s: worker error (deadlock or failure): %v", seed, family, r.err)
				}
				switch r.kind {
				case "visibility_changed":
					successes++
					winner = r
				case "rejected:stale_revision", "rejected:consumed_challenge", "rejected:superseded_challenge":
				case "confirmation_required":
					if strict {
						t.Fatalf("seed %d family %s: unexpected %s", seed, family, r.kind)
					}
				default:
					t.Fatalf("seed %d family %s: unexpected result %s", seed, family, r.kind)
				}
			}
			if successes > 1 {
				t.Fatalf("seed %d family %s: %d successes, want at most 1: %+v", seed, family, successes, results)
			}
			if wantWinner && successes != 1 {
				t.Fatalf("seed %d family %s: %d successes, want exactly 1: %+v", seed, family, successes, results)
			}

			history := configHistory(t, pool, objectID)
			next := 0
			seen := map[int64]bool{}
			for _, row := range history {
				if seen[row.Version] {
					t.Fatalf("seed %d family %s: duplicate revision %d", seed, family, row.Version)
				}
				seen[row.Version] = true
				if row.Version == revision+1 {
					next++
				}
			}
			if next > 1 {
				t.Fatalf("seed %d family %s: %d rows at revision %d", seed, family, next, revision+1)
			}
			if successes == 1 && next != 1 {
				t.Fatalf("seed %d family %s: a success must be the one row at revision %d", seed, family, revision+1)
			}
			if successes == 0 && next != 0 {
				t.Fatalf("seed %d family %s: a row was appended without a success", seed, family)
			}

			// If the winner confirmed, the consumed challenge is exactly the one it presented.
			if successes == 1 && winner.confirmed {
				var consumed int
				var by uuid.UUID
				if err := pool.QueryRow(ctx, `SELECT count(*), COALESCE(max(consumed_by_request_id::text)::uuid, $2)
					FROM public.app_confirmation_challenges WHERE target_id = $1 AND state = 'consumed'`, objectID, uuid.Nil).Scan(&consumed, &by); err != nil {
					t.Fatal(err)
				}
				if consumed != 1 || by != winner.requestID {
					t.Fatalf("seed %d family %s: consumed=%d by=%s, winner=%s", seed, family, consumed, by, winner.requestID)
				}
			}
			_ = fmt.Sprint(challenges)
		}
	})
}
