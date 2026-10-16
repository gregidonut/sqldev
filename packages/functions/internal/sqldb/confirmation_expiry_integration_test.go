//go:build integration

package sqldb

import (
	"context"
	"testing"
	"testing/quick"
	"time"

	"github.com/google/uuid"
)

func TestExpiryBoundary(t *testing.T) {
	pool := openTestDB(t)
	property(t, 5, "PostgreSQL time defines the expiry boundary", func(t *testing.T) {
		ctx := context.Background()
		owner := newActor(t, pool)
		objectID := createObject(t, pool, owner)

		// One committed challenge; every iteration only reads it and rolls back.
		challenge, err := begin(ctx, pool, owner, objectID, 1)
		if err != nil || kindOf(challenge) != "confirmation_required" {
			t.Fatalf("begin: %v %v", challenge, err)
		}
		challengeID := uuid.MustParse(challenge["challengeId"].(string))
		proof := challenge["proof"].(string)

		var createdAt, expiresAt time.Time
		if err := pool.QueryRow(ctx, `SELECT created_at, expires_at FROM public.app_confirmation_challenges WHERE challenge_id = $1`,
			challengeID).Scan(&createdAt, &expiresAt); err != nil {
			t.Fatal(err)
		}
		if got := expiresAt.Sub(createdAt); got != 5*time.Minute {
			t.Fatalf("expires_at - created_at = %v, want exactly 5m", got)
		}

		classify := func(deltaMicros int64) (string, string) {
			tx, err := pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(ctx) //nolint:errcheck
			var verdict, state string
			err = tx.QueryRow(ctx, `
				SELECT public.app_confirmation_classify(c, c.actor_user_id, c.operation_kind, c.target_type, c.target_id,
				                                        c.expected_revision, $2, $3, c.expires_at + make_interval(secs => $4::double precision / 1000000.0))
				FROM public.app_confirmation_challenges AS c WHERE c.challenge_id = $1`,
				challengeID, proof, uuid.New(), deltaMicros).Scan(&verdict)
			if err != nil {
				t.Fatalf("classify: %v", err)
			}
			if err := tx.QueryRow(ctx, `SELECT state::text FROM public.app_confirmation_challenges WHERE challenge_id = $1`, challengeID).Scan(&state); err != nil {
				t.Fatal(err)
			}
			return verdict, state
		}

		// The three boundary points named by the property.
		if verdict, state := classify(-1); verdict != "ok" || state != "active" {
			t.Fatalf("1µs before expiry: verdict=%s state=%s", verdict, state)
		}
		if verdict, state := classify(0); verdict != "expired_challenge" || state != "expired" {
			t.Fatalf("at expiry: verdict=%s state=%s", verdict, state)
		}
		if verdict, state := classify(1); verdict != "expired_challenge" || state != "expired" {
			t.Fatalf("1µs after expiry: verdict=%s state=%s", verdict, state)
		}

		// And for arbitrary offsets: expired exactly when at >= expires_at.
		check := func(delta int32) bool {
			micros := int64(delta)
			verdict, state := classify(micros)
			if micros < 0 {
				return verdict == "ok" && state == "active"
			}
			return verdict == "expired_challenge" && state == "expired"
		}
		if err := quick.Check(check, &quick.Config{MaxCount: 100}); err != nil {
			t.Fatal(err)
		}

		// Nothing above committed: the challenge is still active and no row was appended.
		if got := challengesFor(t, pool, objectID); len(got) != 1 || got[0].State != "active" {
			t.Fatalf("challenges = %+v", got)
		}
		if got := configHistory(t, pool, objectID); len(got) != 1 {
			t.Fatalf("history = %+v", got)
		}
	})

	t.Run("an elapsed challenge commits as expired and appends nothing", func(t *testing.T) {
		ctx := context.Background()
		owner := newActor(t, pool)
		objectID := createObject(t, pool, owner)
		challenge, err := begin(ctx, pool, owner, objectID, 1)
		if err != nil {
			t.Fatal(err)
		}
		// Move the whole lifetime into the past, as if five minutes had gone by.
		if _, err := pool.Exec(ctx, `UPDATE public.app_confirmation_challenges
			SET created_at = created_at - INTERVAL '10 minutes', expires_at = expires_at - INTERVAL '10 minutes'
			WHERE challenge_id = $1`, challenge["challengeId"]); err != nil {
			t.Fatal(err)
		}
		before := configHistory(t, pool, objectID)
		result, err := confirm(ctx, pool, owner, challenge, objectID, 1, uuid.New())
		if err != nil {
			t.Fatal(err)
		}
		if kindOf(result) != "rejected:expired_challenge" {
			t.Fatalf("result = %v", result)
		}
		if got := challengesFor(t, pool, objectID); len(got) != 1 || got[0].State != "expired" {
			t.Fatalf("challenge state must commit as expired: %+v", got)
		}
		if !historyEqual(before, configHistory(t, pool, objectID)) {
			t.Fatal("config history changed")
		}
		// An expired challenge stays expired and cannot be used again.
		again, _ := confirm(ctx, pool, owner, challenge, objectID, 1, uuid.New())
		if kindOf(again) != "rejected:expired_challenge" {
			t.Fatalf("second attempt = %v", again)
		}
	})
}
