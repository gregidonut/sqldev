//go:build integration

package sqldb

import (
	"context"
	"math/rand"
	"testing"
	"testing/quick"

	"github.com/google/uuid"
)

func TestRefreshSupersedesEarlierChallenges(t *testing.T) {
	pool := openTestDB(t)
	property(t, 9, "Refresh supersedes earlier matching challenges", func(t *testing.T) {
		ctx := context.Background()
		owner := newActor(t, pool)
		objectID := createObject(t, pool, owner)

		check := func(seed int64) bool {
			rng := rand.New(rand.NewSource(seed))
			revision := ensurePrivate(t, pool, owner, objectID)
			refreshes := 1 + rng.Intn(6)

			issued := make([]map[string]any, 0, refreshes+1)
			for i := 0; i <= refreshes; i++ {
				c, err := begin(ctx, pool, owner, objectID, revision)
				if err != nil || kindOf(c) != "confirmation_required" {
					t.Errorf("seed %d: initiation %d = %v err %v", seed, i, c, err)
					return false
				}
				issued = append(issued, c)
			}

			active := 0
			var activeID string
			states := map[string]string{}
			for _, row := range challengesFor(t, pool, objectID) {
				states[row.ID.String()] = row.State
				if row.State == "active" && row.Expected == revision {
					active++
					activeID = row.ID.String()
				}
			}
			last := issued[len(issued)-1]["challengeId"].(string)
			if active != 1 || activeID != last {
				t.Errorf("seed %d: %d active challenges (%s), want exactly the last (%s)", seed, active, activeID, last)
				return false
			}
			for _, earlier := range issued[:len(issued)-1] {
				if states[earlier["challengeId"].(string)] != "superseded" {
					t.Errorf("seed %d: an earlier challenge is %s, want superseded", seed, states[earlier["challengeId"].(string)])
					return false
				}
			}

			before := configHistory(t, pool, objectID)
			for _, earlier := range issued[:len(issued)-1] {
				result, err := confirm(ctx, pool, owner, earlier, objectID, revision, uuid.New())
				if err != nil || kindOf(result) != "rejected:superseded_challenge" {
					t.Errorf("seed %d: earlier challenge confirm = %v err %v", seed, result, err)
					return false
				}
			}
			if !historyEqual(before, configHistory(t, pool, objectID)) {
				t.Errorf("seed %d: a superseded challenge appended a row", seed)
				return false
			}
			result, err := confirm(ctx, pool, owner, last2(issued), objectID, revision, uuid.New())
			if err != nil || kindOf(result) != "visibility_changed" {
				t.Errorf("seed %d: last challenge confirm = %v err %v", seed, result, err)
				return false
			}
			return true
		}
		if err := quick.Check(check, &quick.Config{MaxCount: 100}); err != nil {
			t.Fatal(err)
		}
	})
}

func last2(items []map[string]any) map[string]any { return items[len(items)-1] }
