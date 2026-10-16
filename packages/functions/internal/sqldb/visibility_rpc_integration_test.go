//go:build integration

package sqldb

import (
	"context"
	"math/rand"
	"strings"
	"testing"
	"testing/quick"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// flipTimes moves the object through n real visibility changes.
func flipTimes(t *testing.T, pool *pgxpool.Pool, owner actor, objectID uuid.UUID, n int) {
	t.Helper()
	ctx := context.Background()
	for i := 0; i < n; i++ {
		revision, public := currentRevision(t, pool, objectID)
		if public {
			result, err := makePrivate(ctx, pool, owner, objectID, revision)
			if err != nil || kindOf(result) != "visibility_changed" {
				t.Fatalf("make private: %v %v", result, err)
			}
			continue
		}
		makeObjectPublic(t, pool, owner, objectID)
	}
}

// ensurePrivate leaves the object private and returns its revision.
func ensurePrivate(t *testing.T, pool *pgxpool.Pool, owner actor, objectID uuid.UUID) int64 {
	t.Helper()
	revision, public := currentRevision(t, pool, objectID)
	if public {
		if result, err := makePrivate(context.Background(), pool, owner, objectID, revision); err != nil || kindOf(result) != "visibility_changed" {
			t.Fatalf("make private: %v %v", result, err)
		}
		revision, _ = currentRevision(t, pool, objectID)
	}
	return revision
}

func TestSuccessfulChangesAppendExactlyOneRevision(t *testing.T) {
	pool := openTestDB(t)
	property(t, 3, "Successful visibility changes append exactly one revision", func(t *testing.T) {
		ctx := context.Background()
		owner := newActor(t, pool)
		check := func(seed int64) bool {
			rng := rand.New(rand.NewSource(seed))
			objectID := createObject(t, pool, owner)
			flipTimes(t, pool, owner, objectID, rng.Intn(4))

			revision, wasPublic := currentRevision(t, pool, objectID)
			before := configHistory(t, pool, objectID)
			challengesBefore := challengesFor(t, pool, objectID)

			if wasPublic {
				result, err := makePrivate(ctx, pool, owner, objectID, revision)
				if err != nil || kindOf(result) != "visibility_changed" || result["visibility"] != "private" ||
					int64(result["revision"].(float64)) != revision+1 {
					t.Errorf("seed %d: make private result = %v err = %v", seed, result, err)
					return false
				}
				if !challengesEqual(challengesBefore, challengesFor(t, pool, objectID)) {
					t.Errorf("seed %d: make private touched the challenge table", seed)
					return false
				}
			} else {
				challenge, err := begin(ctx, pool, owner, objectID, revision)
				if err != nil || kindOf(challenge) != "confirmation_required" {
					t.Errorf("seed %d: begin = %v err = %v", seed, challenge, err)
					return false
				}
				if !historyEqual(before, configHistory(t, pool, objectID)) {
					t.Errorf("seed %d: initiation appended a config row", seed)
					return false
				}
				issued := challengesFor(t, pool, objectID)
				result, err := confirm(ctx, pool, owner, challenge, objectID, revision, uuid.New())
				if err != nil || kindOf(result) != "visibility_changed" || result["visibility"] != "public" ||
					int64(result["revision"].(float64)) != revision+1 {
					t.Errorf("seed %d: confirm = %v err = %v", seed, result, err)
					return false
				}
				consumed := 0
				after := challengesFor(t, pool, objectID)
				for i := range issued {
					if issued[i].State == "active" && after[i].State == "consumed" {
						consumed++
					} else if issued[i].State != after[i].State {
						t.Errorf("seed %d: unrelated challenge changed %s -> %s", seed, issued[i].State, after[i].State)
						return false
					}
				}
				if consumed != 1 {
					t.Errorf("seed %d: %d challenges consumed, want exactly 1", seed, consumed)
					return false
				}
			}

			after := configHistory(t, pool, objectID)
			if len(after) != len(before)+1 || !historyEqual(before, after[:len(before)]) {
				t.Errorf("seed %d: history was not append-only: %d -> %d rows", seed, len(before), len(after))
				return false
			}
			last := after[len(after)-1]
			if last.Version != revision+1 || last.Public == wasPublic {
				t.Errorf("seed %d: last row = %+v, want revision %d and public=%v", seed, last, revision+1, !wasPublic)
				return false
			}
			return true
		}
		if err := quick.Check(check, &quick.Config{MaxCount: 100}); err != nil {
			t.Fatal(err)
		}
	})
}

func TestNonOwnersCannotChangeVisibility(t *testing.T) {
	pool := openTestDB(t)
	property(t, 4, "Non-owners cannot change visibility", func(t *testing.T) {
		ctx := context.Background()
		owner := newActor(t, pool)
		viewer, editor, stranger := newActor(t, pool), newActor(t, pool), newActor(t, pool)
		unregistered := actor{Sub: testActorPrefix + "never_registered_" + uuid.NewString()}

		for _, priorFlips := range []int{0, 2, 4} {
			privateObj := createObject(t, pool, owner)
			publicObj := createObject(t, pool, owner)
			flipTimes(t, pool, owner, privateObj, priorFlips)
			ensurePrivateRev := ensurePrivate(t, pool, owner, privateObj)
			makeObjectPublic(t, pool, owner, publicObj)
			publicRev, _ := currentRevision(t, pool, publicObj)

			grantRole(t, pool, privateObj, viewer, "viewer")
			grantRole(t, pool, privateObj, editor, "editor")
			grantRole(t, pool, publicObj, viewer, "viewer")
			grantRole(t, pool, publicObj, editor, "editor")

			var canWrite bool
			if err := pool.QueryRow(ctx, `SELECT public.authorize_d_storage_object($1, 'd_storage_objects.write', $2)`,
				editor.UserID, privateObj).Scan(&canWrite); err != nil || !canWrite {
				t.Fatalf("the editor must hold generic write for this to mean anything: %v %v", canWrite, err)
			}

			live, err := begin(ctx, pool, owner, privateObj, ensurePrivateRev)
			if err != nil || kindOf(live) != "confirmation_required" {
				t.Fatalf("owner challenge: %v %v", live, err)
			}

			actors := map[string]actor{"viewer": viewer, "editor": editor, "none": stranger, "unregistered": unregistered}
			for name, who := range actors {
				beforePriv, beforePub := configHistory(t, pool, privateObj), configHistory(t, pool, publicObj)
				chPriv, chPub := challengesFor(t, pool, privateObj), challengesFor(t, pool, publicObj)

				initiate, _ := begin(ctx, pool, who, privateObj, ensurePrivateRev)
				confirmed, _ := confirm(ctx, pool, who, live, privateObj, ensurePrivateRev, uuid.New())
				private, _ := makePrivate(ctx, pool, who, publicObj, publicRev)
				ghostInitiate, _ := begin(ctx, pool, who, uuid.New(), 1)
				ghostPrivate, _ := makePrivate(ctx, pool, who, uuid.New(), 1)
				ghostConfirm, _ := confirm(ctx, pool, who, live, uuid.New(), ensurePrivateRev, uuid.New())

				want := map[string]string{
					"initiate": "rejected:forbidden", "private": "rejected:forbidden",
					"ghostInitiate": "rejected:forbidden", "ghostPrivate": "rejected:forbidden",
					"confirm": "rejected:invalid_challenge", "ghostConfirm": "rejected:invalid_challenge",
				}
				if name == "unregistered" {
					// No users row at all: get_owner() resolves nobody.
					want["confirm"], want["ghostConfirm"] = "rejected:forbidden", "rejected:forbidden"
				}
				got := map[string]string{
					"initiate": kindOf(initiate), "private": kindOf(private),
					"ghostInitiate": kindOf(ghostInitiate), "ghostPrivate": kindOf(ghostPrivate),
					"confirm": kindOf(confirmed), "ghostConfirm": kindOf(ghostConfirm),
				}
				for op, w := range want {
					if got[op] != w {
						t.Errorf("flips=%d actor=%s op=%s: got %s, want %s", priorFlips, name, op, got[op], w)
					}
				}
				if !historyEqual(beforePriv, configHistory(t, pool, privateObj)) || !historyEqual(beforePub, configHistory(t, pool, publicObj)) {
					t.Errorf("flips=%d actor=%s: config history changed", priorFlips, name)
				}
				if !challengesEqual(chPriv, challengesFor(t, pool, privateObj)) || !challengesEqual(chPub, challengesFor(t, pool, publicObj)) {
					t.Errorf("flips=%d actor=%s: challenges changed", priorFlips, name)
				}
			}
		}
	})
}

func TestChallengeBindingIsConjunctive(t *testing.T) {
	pool := openTestDB(t)
	property(t, 6, "Challenge binding is conjunctive", func(t *testing.T) {
		ctx := context.Background()
		owner, other := newActor(t, pool), newActor(t, pool)

		check := func(seed int64) bool {
			rng := rand.New(rand.NewSource(seed))
			objectID := createObject(t, pool, owner)
			flipTimes(t, pool, owner, objectID, rng.Intn(4))
			revision := ensurePrivate(t, pool, owner, objectID)
			challenge, err := begin(ctx, pool, owner, objectID, revision)
			if err != nil || kindOf(challenge) != "confirmation_required" {
				t.Errorf("seed %d: begin = %v err = %v", seed, challenge, err)
				return false
			}

			mutateActor, mutateKind, mutateType := rng.Intn(2) == 0, rng.Intn(4) == 0, rng.Intn(4) == 0
			mutateTarget, mutateRevision, mutateProof := rng.Intn(4) == 0, rng.Intn(4) == 0, rng.Intn(3) == 0
			drift := rng.Intn(3) // 0 none, 1 revision bump (still private), 2 flipped to public

			who, kind, targetType, target, expected := owner, "storage.visibility.make_public", "storage_object", objectID, revision
			proof := challenge["proof"].(string)
			if mutateActor {
				who = other
			}
			if mutateKind {
				kind = "storage.visibility.nope"
			}
			if mutateType {
				targetType = "other"
			}
			if mutateTarget {
				target = uuid.New()
			}
			if mutateRevision {
				expected = revision + 1
			}
			if mutateProof {
				flipped := []byte(proof)
				if flipped[0] == 'A' {
					flipped[0] = 'B'
				} else {
					flipped[0] = 'A'
				}
				proof = string(flipped)
			}
			switch drift {
			case 1:
				_, err = pool.Exec(ctx, `INSERT INTO public.d_storage_object_config (storage_object_id, public, config_version) VALUES ($1, FALSE, $2)`, objectID, revision+1)
			case 2:
				_, err = pool.Exec(ctx, `INSERT INTO public.d_storage_object_config (storage_object_id, public, config_version) VALUES ($1, TRUE, $2)`, objectID, revision+1)
			}
			if err != nil {
				t.Errorf("seed %d: drift: %v", seed, err)
				return false
			}

			mismatch := mutateActor || mutateKind || mutateType || mutateTarget || mutateRevision || mutateProof
			wantKind := "visibility_changed"
			switch {
			case mismatch:
				wantKind = "rejected:invalid_challenge"
			case drift != 0:
				wantKind = "rejected:stale_revision"
			}

			before := configHistory(t, pool, objectID)
			result, err := callJSON(ctx, pool, who.Sub, `public.confirm_app_operation($1, $2, $3, $4, $5, $6, $7)`,
				challenge["challengeId"], kind, targetType, target, expected, proof, uuid.New())
			if err != nil {
				t.Errorf("seed %d: confirm: %v", seed, err)
				return false
			}
			after := configHistory(t, pool, objectID)
			var state string
			if err := pool.QueryRow(ctx, `SELECT state::text FROM public.app_confirmation_challenges WHERE challenge_id = $1`,
				challenge["challengeId"]).Scan(&state); err != nil {
				t.Errorf("seed %d: read challenge: %v", seed, err)
				return false
			}
			if kindOf(result) != wantKind {
				t.Errorf("seed %d: got %s, want %s (actor=%v kind=%v type=%v target=%v rev=%v proof=%v drift=%d)",
					seed, kindOf(result), wantKind, mutateActor, mutateKind, mutateType, mutateTarget, mutateRevision, mutateProof, drift)
				return false
			}
			if wantKind == "visibility_changed" {
				if len(after) != len(before)+1 || state != "consumed" {
					t.Errorf("seed %d: success must append one row and consume (rows %d->%d, state %s)", seed, len(before), len(after), state)
					return false
				}
				return true
			}
			if !historyEqual(before, after) || state != "active" {
				t.Errorf("seed %d: a rejection must change nothing (rows %d->%d, state %s)", seed, len(before), len(after), state)
				return false
			}
			return true
		}
		if err := quick.Check(check, &quick.Config{MaxCount: 100}); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("initiation and make-private apply the same revision and visibility conjunction", func(t *testing.T) {
		ctx := context.Background()
		owner := newActor(t, pool)
		objectID := createObject(t, pool, owner)
		revision := ensurePrivate(t, pool, owner, objectID)

		cases := []struct {
			name string
			run  func() (map[string]any, error)
		}{
			{"initiate with a stale revision", func() (map[string]any, error) { return begin(ctx, pool, owner, objectID, revision+1) }},
			{"initiate with revision zero", func() (map[string]any, error) { return begin(ctx, pool, owner, objectID, 0) }},
			{"make private while already private", func() (map[string]any, error) { return makePrivate(ctx, pool, owner, objectID, revision) }},
		}
		for _, c := range cases {
			beforeHistory, beforeChallenges := configHistory(t, pool, objectID), challengesFor(t, pool, objectID)
			result, err := c.run()
			if err != nil {
				t.Fatalf("%s: %v", c.name, err)
			}
			if kindOf(result) != "rejected:stale_revision" {
				t.Errorf("%s: got %s", c.name, kindOf(result))
			}
			if !historyEqual(beforeHistory, configHistory(t, pool, objectID)) || !challengesEqual(beforeChallenges, challengesFor(t, pool, objectID)) {
				t.Errorf("%s: state changed", c.name)
			}
		}

		makeObjectPublic(t, pool, owner, objectID)
		publicRev, _ := currentRevision(t, pool, objectID)
		for _, c := range []struct {
			name string
			run  func() (map[string]any, error)
		}{
			{"initiate while already public", func() (map[string]any, error) { return begin(ctx, pool, owner, objectID, publicRev) }},
			{"make private with a stale revision", func() (map[string]any, error) { return makePrivate(ctx, pool, owner, objectID, publicRev-1) }},
		} {
			beforeHistory, beforeChallenges := configHistory(t, pool, objectID), challengesFor(t, pool, objectID)
			result, err := c.run()
			if err != nil || kindOf(result) != "rejected:stale_revision" {
				t.Errorf("%s: got %v err %v", c.name, result, err)
			}
			if !historyEqual(beforeHistory, configHistory(t, pool, objectID)) || !challengesEqual(beforeChallenges, challengesFor(t, pool, objectID)) {
				t.Errorf("%s: state changed", c.name)
			}
		}
		if strings.Contains(t.Name(), "never") {
			t.Fatal("unreachable")
		}
	})
}
