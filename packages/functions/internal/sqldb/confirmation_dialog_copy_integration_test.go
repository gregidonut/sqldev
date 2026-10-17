//go:build integration

package sqldb

import (
	"context"
	"math/rand"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"testing"
	"testing/quick"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Feature: confirmation-dialog-copy, Property 2: PostgreSQL returns authoritative copy only to
// authorized initiations and preserves it on replay.
//
// This is the database half of Property 2. The production-path half (API handler, status
// store, DBOS replay with an edited registry) lives in cmd/supabaseworker.
//
// Everything that mutates the registry runs in a transaction that is rolled back; the
// storage objects, actors and first challenges are committed fixtures that cleanupActor
// removes.
func TestAuthoritativeDialogCopyProperty(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	reg := makePublicRegistry(t, pool)
	owner, editor, stranger := newActor(t, pool), newActor(t, pool), newActor(t, pool)

	currentKeys := []string{"challengeId", "dialogCopy", "expectedRevision", "expiresAt", "kind",
		"operationKind", "proof", "registryId", "target"}

	copyProperty(t, 2, "PostgreSQL returns authoritative copy only to authorized initiations and preserves it on replay", func(t *testing.T) {
		t.Run("an owner receives the registry identity and the copy resolved from the committed name", func(t *testing.T) {
			check := func(seed int64) bool {
				rng := rand.New(rand.NewSource(seed))
				name := genLabel(rng, reg.Title)
				objectID := createObjectNamed(t, pool, owner, name)
				// A hostile client tries to supply its own label, identifier and copy. The
				// function takes three arguments and none of them is presentation.
				hostile := map[string]any{
					"label": genText(rng, 5, false), "title": genText(rng, 5, false), "registryId": "999999",
					"confirmLabel": "Delete everything", "dialog_title_template": "pwned " + targetToken,
					"dialogCopy": map[string]any{"title": "pwned", "description": "pwned", "confirmLabel": "pwned"},
				}
				res, err := callJSONClaims(ctx, pool, owner.Sub, hostile,
					`public.begin_d_storage_make_public($1, $2, $3)`, objectID, int64(1), uuid.New())
				if err != nil || kindOf(res) != "confirmation_required" {
					t.Errorf("seed %d name %q: begin = %v err = %v", seed, name, res, err)
					return false
				}
				if got := sortedKeys(res); !slices.Equal(got, currentKeys) {
					t.Errorf("seed %d: result keys = %v, want %v", seed, got, currentKeys)
					return false
				}
				if res["registryId"] != strconv.FormatInt(reg.RegistryID, 10) || res["operationKind"] != reg.OperationKind {
					t.Errorf("seed %d: identity = %v %v, want %d %s", seed, res["registryId"], res["operationKind"], reg.RegistryID, reg.OperationKind)
					return false
				}
				want := expectedDialogCopy(reg, name)
				if !reflect.DeepEqual(res["dialogCopy"], want) {
					t.Errorf("seed %d name %q:\n got  %#v\n want %#v", seed, name, res["dialogCopy"], want)
					return false
				}
				copyMap := res["dialogCopy"].(map[string]any)
				if utf8.RuneCountInString(copyMap["title"].(string)) > 200 {
					t.Errorf("seed %d: title exceeds 200 code points", seed)
					return false
				}
				// Exactly one challenge exists and it is bound, through operation_kind, to the
				// registry row whose identity the result carries.
				challenges, err := challengeSnapshots(ctx, pool, objectID)
				if err != nil || len(challenges) != 1 || challenges[0].State != "active" || challenges[0].ID.String() != res["challengeId"] {
					t.Errorf("seed %d: challenges = %+v err = %v, result %v", seed, challenges, err, res["challengeId"])
					return false
				}
				var boundID string
				if err := pool.QueryRow(ctx, `
					SELECT o.registry_id::TEXT FROM public.app_confirmation_challenges AS c
					  JOIN public.app_confirmable_operations AS o USING (operation_kind)
					 WHERE c.challenge_id = $1`, res["challengeId"]).Scan(&boundID); err != nil || boundID != res["registryId"] {
					t.Errorf("seed %d: bound registry id = %q err = %v, result %v", seed, boundID, err, res["registryId"])
					return false
				}
				if versions, err := configVersions(ctx, pool, objectID); err != nil || !slices.Equal(versions, []int64{1}) {
					t.Errorf("seed %d: initiation changed the configuration: %v %v", seed, versions, err)
					return false
				}
				return true
			}
			if err := quick.Check(check, &quick.Config{MaxCount: 100}); err != nil {
				t.Fatal(err)
			}
		})

		t.Run("an unauthorized, inaccessible, public or stale initiation discloses no identity or copy", func(t *testing.T) {
			check := func(seed int64) bool {
				rng := rand.New(rand.NewSource(seed))
				name := genLabel(rng, reg.Title)
				objectID := createObjectNamed(t, pool, owner, name)
				grantRole(t, pool, objectID, editor, "editor")
				type attempt struct {
					label    string
					who      actor
					object   uuid.UUID
					revision int64
				}
				attempts := []attempt{
					{"editor", editor, objectID, 1},
					{"stranger", stranger, objectID, 1},
					{"missing object", owner, uuid.New(), 1},
					{"stale revision", owner, objectID, 2},
				}
				if rng.Intn(5) == 0 {
					publicID := createObjectNamed(t, pool, owner, name)
					makeObjectPublic(t, pool, owner, publicID)
					revision, _ := currentRevision(t, pool, publicID)
					attempts = append(attempts, attempt{"already public", owner, publicID, revision})
				}
				for _, a := range attempts {
					before, _ := challengeSnapshots(ctx, pool, a.object)
					res, err := begin(ctx, pool, a.who, a.object, a.revision)
					if err != nil || !strings.HasPrefix(kindOf(res), "rejected") {
						t.Errorf("seed %d %s: result = %v err = %v, want a rejection", seed, a.label, res, err)
						return false
					}
					if got := sortedKeys(res); !slices.Equal(got, []string{"kind", "reason"}) || disclosesCopy(res, reg) {
						t.Errorf("seed %d %s: rejection discloses presentation: %v", seed, a.label, res)
						return false
					}
					after, _ := challengeSnapshots(ctx, pool, a.object)
					if !reflect.DeepEqual(before, after) {
						t.Errorf("seed %d %s: a rejected initiation changed challenges: %v -> %v", seed, a.label, before, after)
						return false
					}
				}
				if got, _ := challengeSnapshots(ctx, pool, objectID); len(got) != 0 {
					t.Errorf("seed %d: unauthorized initiations created challenges: %+v", seed, got)
					return false
				}
				return true
			}
			if err := quick.Check(check, &quick.Config{MaxCount: 100}); err != nil {
				t.Fatal(err)
			}
		})

		// An invalid or missing registry row can never be committed through the table
		// constraints, so each variant removes the constraint and breaks the row inside a
		// transaction that is rolled back.
		const dropTitle = `ALTER TABLE public.app_confirmable_operations DROP CONSTRAINT app_confirmable_operations_dialog_title_template_valid`
		const dropDescription = `ALTER TABLE public.app_confirmable_operations DROP CONSTRAINT app_confirmable_operations_dialog_description_valid`
		const dropConfirm = `ALTER TABLE public.app_confirmable_operations DROP CONSTRAINT app_confirmable_operations_dialog_confirm_label_valid`
		type step struct {
			sql  string
			args []any
		}
		const invalidRow = "app_confirmation_issue: registry row is invalid"
		registryFailures := []struct {
			name    string
			message string
			steps   []step
		}{
			{"blank title template", invalidRow, []step{{dropTitle, nil},
				{`UPDATE public.app_confirmable_operations SET dialog_title_template = $1 WHERE operation_kind = $2`, []any{"\u00a0\u0085", makePublicKind}}}},
			{"blank description", invalidRow, []step{{dropDescription, nil},
				{`UPDATE public.app_confirmable_operations SET dialog_description = $1 WHERE operation_kind = $2`, []any{"\u2003", makePublicKind}}}},
			{"description over 2000 code points", invalidRow, []step{{dropDescription, nil},
				{`UPDATE public.app_confirmable_operations SET dialog_description = $1 WHERE operation_kind = $2`, []any{strings.Repeat("d", 2001), makePublicKind}}}},
			{"blank confirm label", invalidRow, []step{{dropConfirm, nil},
				{`UPDATE public.app_confirmable_operations SET dialog_confirm_label = $1 WHERE operation_kind = $2`, []any{"\u3000", makePublicKind}}}},
			{"confirm label over 80 code points", invalidRow, []step{{dropConfirm, nil},
				{`UPDATE public.app_confirmable_operations SET dialog_confirm_label = $1 WHERE operation_kind = $2`, []any{strings.Repeat("c", 81), makePublicKind}}}},
			{"null registry identity", invalidRow, []step{
				{`ALTER TABLE public.app_confirmable_operations ALTER COLUMN registry_id DROP NOT NULL`, nil},
				{`SET LOCAL session_replication_role = replica`, nil},
				{`UPDATE public.app_confirmable_operations SET registry_id = NULL WHERE operation_kind = $1`, []any{makePublicKind}},
				{`SET LOCAL session_replication_role = origin`, nil}}},
			{"registry identity below 1000", invalidRow, []step{
				{`ALTER TABLE public.app_confirmable_operations DROP CONSTRAINT app_confirmable_operations_registry_id_min`, nil},
				{`SET LOCAL session_replication_role = replica`, nil},
				{`UPDATE public.app_confirmable_operations SET registry_id = 999 WHERE operation_kind = $1`, []any{makePublicKind}},
				{`SET LOCAL session_replication_role = origin`, nil}}},
			{"missing registry row", "app_confirmation_issue: operation is not registered", []step{
				{`SET LOCAL session_replication_role = replica`, nil},
				{`DELETE FROM public.app_confirmable_operations WHERE operation_kind = $1`, []any{makePublicKind}},
				{`SET LOCAL session_replication_role = origin`, nil}}},
		}

		// failsClosed runs mutate then an owner initiation inside a rolled-back transaction and
		// checks that it raised msg and left challenges and configuration exactly as they were,
		// including the earlier active challenge.
		failsClosed := func(t *testing.T, seed int64, objectID uuid.UUID, msg string, mutate func(ctx context.Context, tx pgx.Tx) error) bool {
			ok := true
			scratchTx(t, pool, func(ctx context.Context, tx pgx.Tx) {
				beforeChallenges, err1 := challengeSnapshots(ctx, tx, objectID)
				beforeConfig, err2 := configVersions(ctx, tx, objectID)
				if err1 != nil || err2 != nil || len(beforeChallenges) != 1 || beforeChallenges[0].State != "active" {
					t.Errorf("seed %d: fixture challenges = %+v (%v, %v)", seed, beforeChallenges, err1, err2)
					ok = false
					return
				}
				if err := mutate(ctx, tx); err != nil {
					t.Errorf("seed %d: mutate: %v", seed, err)
					ok = false
					return
				}
				res, err := callInTx(ctx, tx, owner.Sub, nil, `public.begin_d_storage_make_public($1, $2, $3)`, objectID, int64(1), uuid.New())
				if res != nil {
					t.Errorf("seed %d: a confirmation_required result was returned: %v", seed, kindOf(res))
					ok = false
				}
				if pgErr := pgErrorOf(err); pgErr == nil || pgErr.Code != "P0001" || pgErr.Message != msg {
					t.Errorf("seed %d: err = %v, want RAISE %q", seed, err, msg)
					ok = false
				}
				afterChallenges, err1 := challengeSnapshots(ctx, tx, objectID)
				afterConfig, err2 := configVersions(ctx, tx, objectID)
				if err1 != nil || err2 != nil || !reflect.DeepEqual(beforeChallenges, afterChallenges) || !reflect.DeepEqual(beforeConfig, afterConfig) {
					t.Errorf("seed %d: a failed initiation changed state: challenges %+v -> %+v, config %v -> %v", seed, beforeChallenges, afterChallenges, beforeConfig, afterConfig)
					ok = false
				}
			})
			return ok
		}
		renameInTx := func(ctx context.Context, tx pgx.Tx, objectID uuid.UUID, name string) error {
			if _, err := tx.Exec(ctx, `SET LOCAL session_replication_role = replica`); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE public.d_storage_object_data SET file_name = $2 WHERE storage_object_id = $1`, objectID, name); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `SET LOCAL session_replication_role = origin`)
			return err
		}

		t.Run("an invalid or missing registry row or copy fails the job with no challenge, no configuration row and no supersession", func(t *testing.T) {
			objectID := createObject(t, pool, owner)
			if first, err := begin(ctx, pool, owner, objectID, 1); err != nil || kindOf(first) != "confirmation_required" {
				t.Fatalf("first challenge = %v err = %v", first, err)
			}
			check := func(seed int64) bool {
				rng := rand.New(rand.NewSource(seed))
				variant := registryFailures[rng.Intn(len(registryFailures))]
				name := genLabel(rng, reg.Title)
				return failsClosed(t, seed, objectID, variant.message, func(ctx context.Context, tx pgx.Tx) error {
					if err := renameInTx(ctx, tx, objectID, name); err != nil {
						return err
					}
					for _, s := range variant.steps {
						if _, err := tx.Exec(ctx, s.sql, s.args...); err != nil {
							t.Logf("variant %q step failed: %s", variant.name, s.sql)
							return err
						}
					}
					return nil
				})
			}
			if err := quick.Check(check, &quick.Config{MaxCount: 100}); err != nil {
				t.Fatal(err)
			}
		})

		t.Run("a missing, blank or over-long committed name fails the job with no challenge, no configuration row and no supersession", func(t *testing.T) {
			objectID := createObject(t, pool, owner)
			if first, err := begin(ctx, pool, owner, objectID, 1); err != nil || kindOf(first) != "confirmation_required" {
				t.Fatalf("first challenge = %v err = %v", first, err)
			}
			titleOverhead := utf8.RuneCountInString(reg.Title) - utf8.RuneCountInString(targetToken)
			const unresolvable = "app_confirmation_resolve_dialog_copy: invalid dialog copy"
			check := func(seed int64) bool {
				rng := rand.New(rand.NewSource(seed))
				var mutate func(ctx context.Context, tx pgx.Tx) error
				switch rng.Intn(3) {
				case 0: // only characters of the shared blank class
					blank := make([]rune, 1+rng.Intn(10))
					for i := range blank {
						blank[i] = blankRunes[rng.Intn(len(blankRunes))]
					}
					mutate = func(ctx context.Context, tx pgx.Tx) error { return renameInTx(ctx, tx, objectID, string(blank)) }
				case 1: // an upload with no committed data row has no label
					mutate = func(ctx context.Context, tx pgx.Tx) error {
						if _, err := tx.Exec(ctx, `SET LOCAL session_replication_role = replica`); err != nil {
							return err
						}
						if _, err := tx.Exec(ctx, `DELETE FROM public.d_storage_object_data WHERE storage_object_id = $1`, objectID); err != nil {
							return err
						}
						_, err := tx.Exec(ctx, `SET LOCAL session_replication_role = origin`)
						return err
					}
				default: // the resolved title is one or more code points over 200
					name := genText(rng, 200-titleOverhead+1+rng.Intn(100), false)
					mutate = func(ctx context.Context, tx pgx.Tx) error { return renameInTx(ctx, tx, objectID, name) }
				}
				return failsClosed(t, seed, objectID, unresolvable, mutate)
			}
			if err := quick.Check(check, &quick.Config{MaxCount: 100}); err != nil {
				t.Fatal(err)
			}
		})

		t.Run("an identical replay returns no copy, issues no second challenge, and ignores later registry edits", func(t *testing.T) {
			check := func(seed int64) bool {
				rng := rand.New(rand.NewSource(seed))
				name := genLabel(rng, reg.Title)
				objectID := createObjectNamed(t, pool, owner, name)
				request := uuid.New()
				first, err := beginWith(ctx, pool, owner, objectID, 1, request)
				if err != nil || kindOf(first) != "confirmation_required" {
					t.Errorf("seed %d: first = %v err = %v", seed, first, err)
					return false
				}
				for i, repeats := 0, 1+rng.Intn(3); i < repeats; i++ {
					again, err := beginWith(ctx, pool, owner, objectID, 1, request)
					if err != nil || kindOf(again) == "confirmation_required" || disclosesCopy(again, reg) {
						t.Errorf("seed %d: replay %d = %v err = %v", seed, i, again, err)
						return false
					}
				}
				// The registry copy is edited after the first result: a replay still mints and
				// shows nothing new.
				scratchTx(t, pool, func(ctx context.Context, tx pgx.Tx) {
					if _, err := tx.Exec(ctx, `UPDATE public.app_confirmable_operations SET dialog_description = $1 WHERE operation_kind = $2`,
						genText(rng, 30, false), makePublicKind); err != nil {
						t.Errorf("seed %d: edit registry: %v", seed, err)
						return
					}
					again, err := callInTx(ctx, tx, owner.Sub, nil, `public.begin_d_storage_make_public($1, $2, $3)`, objectID, int64(1), request)
					if err != nil || kindOf(again) == "confirmation_required" || disclosesCopy(again, reg) {
						t.Errorf("seed %d: replay after a registry edit = %v err = %v", seed, again, err)
					}
				})
				got, err := challengeSnapshots(ctx, pool, objectID)
				if err != nil || len(got) != 1 || got[0].State != "active" || got[0].ID.String() != first["challengeId"] {
					t.Errorf("seed %d: challenges after replays = %+v err = %v", seed, got, err)
					return false
				}

				// Concurrent identical replays on a fresh object: exactly one challenge exists
				// and exactly one request is answered with a confirmation_required result.
				concurrentID := createObjectNamed(t, pool, owner, name)
				concurrentRequest := uuid.New()
				var jobs []func() workerResult
				for w, workers := 0, 2+rng.Intn(4); w < workers; w++ {
					jobs = append(jobs, func() workerResult {
						res, err := beginWith(ctx, pool, owner, concurrentID, 1, concurrentRequest)
						return workerResult{kind: kindOf(res), err: err}
					})
				}
				issued := 0
				for _, r := range raceAll(jobs) {
					switch {
					case r.err != nil:
						// A losing racer that passes the replay check before the winner commits
						// can only fail on the unique initiation_request_id.
						if e := pgErrorOf(r.err); e == nil || e.Code != "23505" {
							t.Errorf("seed %d: concurrent replay err = %v", seed, r.err)
							return false
						}
					case r.kind == "confirmation_required":
						issued++
					case !strings.HasPrefix(r.kind, "rejected"):
						t.Errorf("seed %d: concurrent replay kind = %s", seed, r.kind)
						return false
					}
				}
				concurrent, err := challengeSnapshots(ctx, pool, concurrentID)
				if issued != 1 || err != nil || len(concurrent) != 1 || concurrent[0].State != "active" {
					t.Errorf("seed %d: %d results issued, challenges = %+v err = %v", seed, issued, concurrent, err)
					return false
				}
				return true
			}
			if err := quick.Check(check, &quick.Config{MaxCount: 100}); err != nil {
				t.Fatal(err)
			}
		})

		t.Run("altering the presentation after the result changes no authorization decision", func(t *testing.T) {
			check := func(seed int64) bool {
				rng := rand.New(rand.NewSource(seed))
				name := genLabel(rng, reg.Title)
				plainObj := createObjectNamed(t, pool, owner, name)
				tamperedObj := createObjectNamed(t, pool, owner, name)
				wrongPlainObj := createObjectNamed(t, pool, owner, name)
				wrongTamperedObj := createObjectNamed(t, pool, owner, name)
				challenge := func(objectID uuid.UUID) map[string]any {
					c, err := begin(ctx, pool, owner, objectID, 1)
					if err != nil || kindOf(c) != "confirmation_required" {
						t.Fatalf("seed %d: begin = %v err = %v", seed, c, err)
					}
					return c
				}
				plainC, tamperedC, wrongPlainC, wrongTamperedC := challenge(plainObj), challenge(tamperedObj), challenge(wrongPlainObj), challenge(wrongTamperedObj)

				// What a hostile client or a concurrent registry edit could change after the
				// result was returned: JWT claims, and the registry copy itself.
				hostile := map[string]any{
					"registryId": "1", "dialogCopy": map[string]any{"title": genText(rng, 10, false)},
					"title": genText(rng, 10, false), "confirmLabel": genText(rng, 10, false),
				}
				confirmSQL := `public.confirm_app_operation($1, $2, $3, $4, $5, $6, $7)`
				plain, err := callJSON(ctx, pool, owner.Sub, confirmSQL,
					plainC["challengeId"], makePublicKind, "storage_object", plainObj, int64(1), plainC["proof"], uuid.New())
				if err != nil || kindOf(plain) != "visibility_changed" {
					t.Errorf("seed %d: plain confirm = %v err = %v", seed, plain, err)
					return false
				}
				wrongPlain, err := callJSON(ctx, pool, owner.Sub, confirmSQL,
					wrongPlainC["challengeId"], makePublicKind, "storage_object", wrongPlainObj, int64(1), "not-the-proof", uuid.New())
				if err != nil || kindOf(wrongPlain) != "rejected:invalid_challenge" {
					t.Errorf("seed %d: plain wrong proof = %v err = %v", seed, wrongPlain, err)
					return false
				}

				ok := true
				scratchTx(t, pool, func(ctx context.Context, tx pgx.Tx) {
					if _, err := tx.Exec(ctx, `UPDATE public.app_confirmable_operations
						SET dialog_title_template = $1, dialog_description = $2, dialog_confirm_label = $3 WHERE operation_kind = $4`,
						"Tampered "+targetToken, genText(rng, 20, false), genText(rng, 20, false), makePublicKind); err != nil {
						t.Errorf("seed %d: edit registry: %v", seed, err)
						ok = false
						return
					}
					tampered, err := callInTx(ctx, tx, owner.Sub, hostile, confirmSQL,
						tamperedC["challengeId"], makePublicKind, "storage_object", tamperedObj, int64(1), tamperedC["proof"], uuid.New())
					if err != nil || kindOf(tampered) != kindOf(plain) || !reflect.DeepEqual(tampered["revision"], plain["revision"]) {
						t.Errorf("seed %d: tampered confirm = %v err = %v, want the decision %v", seed, tampered, err, plain)
						ok = false
					}
					wrongTampered, err := callInTx(ctx, tx, owner.Sub, hostile, confirmSQL,
						wrongTamperedC["challengeId"], makePublicKind, "storage_object", wrongTamperedObj, int64(1), "not-the-proof", uuid.New())
					if err != nil || kindOf(wrongTampered) != kindOf(wrongPlain) {
						t.Errorf("seed %d: tampered wrong proof = %v err = %v, want %v", seed, wrongTampered, err, wrongPlain)
						ok = false
					}
				})
				return ok
			}
			if err := quick.Check(check, &quick.Config{MaxCount: 100}); err != nil {
				t.Fatal(err)
			}
		})
	})
}
