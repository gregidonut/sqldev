//go:build integration

package sqldb

import (
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func publicListHas(t *testing.T, pool *pgxpool.Pool, viewer actor, objectID uuid.UUID) bool {
	t.Helper()
	var n int
	err := asActorQuery(context.Background(), pool, viewer.Sub,
		`SELECT count(*) FROM public.get_d_storage_objects('public') WHERE storage_object_id = $1`, []any{objectID}, &n)
	if err != nil {
		t.Fatal(err)
	}
	return n > 0
}

func TestVisibilityRPCExamples(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()

	t.Run("the full upload path through prepare and commit still works", func(t *testing.T) {
		owner := newActor(t, pool)
		objectID := createObjectViaRPC(t, pool, owner)
		if h := configHistory(t, pool, objectID); len(h) != 1 || h[0].Version != 1 || h[0].Public {
			t.Fatalf("history = %+v", h)
		}
		makeObjectPublic(t, pool, owner, objectID)
	})

	t.Run("a failure after the challenge is consumed rolls back both writes", func(t *testing.T) {
		owner := newActor(t, pool)
		objectID := createObject(t, pool, owner)
		challenge, err := begin(ctx, pool, owner, objectID, 1)
		if err != nil {
			t.Fatal(err)
		}
		id := challenge["challengeId"].(string)
		suffix := uuid.NewString()[:8]
		fn, trg := "it_fail_consume_"+suffix, "it_fail_consume_trg_"+suffix
		must := func(sql string) {
			if _, err := pool.Exec(ctx, sql); err != nil {
				t.Fatalf("%s: %v", sql, err)
			}
		}
		must(fmt.Sprintf(`CREATE FUNCTION public.%s() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$`, fn))
		must(fmt.Sprintf(`CREATE TRIGGER %s BEFORE UPDATE ON public.app_confirmation_challenges FOR EACH ROW
			WHEN (NEW.state = 'consumed' AND OLD.challenge_id = '%s') EXECUTE FUNCTION public.%s()`, trg, id, fn))
		t.Cleanup(func() {
			pool.Exec(ctx, fmt.Sprintf(`DROP TRIGGER IF EXISTS %s ON public.app_confirmation_challenges`, trg)) //nolint:errcheck
			pool.Exec(ctx, fmt.Sprintf(`DROP FUNCTION IF EXISTS public.%s()`, fn))                              //nolint:errcheck
		})

		before := configHistory(t, pool, objectID)
		if _, err := confirm(ctx, pool, owner, challenge, objectID, 1, uuid.New()); err == nil {
			t.Fatal("expected the injected failure to surface")
		}
		if !historyEqual(before, configHistory(t, pool, objectID)) {
			t.Fatal("the config row survived a failed consume")
		}
		if got := challengesFor(t, pool, objectID); len(got) != 1 || got[0].State != "active" {
			t.Fatalf("the challenge state changed: %+v", got)
		}
	})

	t.Run("an unregistered operation kind executes nothing", func(t *testing.T) {
		owner := newActor(t, pool)
		objectID := createObject(t, pool, owner)
		challenge, _ := begin(ctx, pool, owner, objectID, 1)
		before := configHistory(t, pool, objectID)
		result, err := callJSON(ctx, pool, owner.Sub, `public.confirm_app_operation($1, $2, $3, $4, $5, $6, $7)`,
			challenge["challengeId"], "storage.visibility.destroy", "storage_object", objectID, int64(1), challenge["proof"], uuid.New())
		if err != nil || kindOf(result) != "rejected:invalid_challenge" {
			t.Fatalf("result = %v err = %v", result, err)
		}
		if !historyEqual(before, configHistory(t, pool, objectID)) {
			t.Fatal("config history changed")
		}
	})

	t.Run("a repeated initiation request id issues no second challenge", func(t *testing.T) {
		owner := newActor(t, pool)
		objectID := createObject(t, pool, owner)
		request := uuid.New()
		first, err := beginWith(ctx, pool, owner, objectID, 1, request)
		if err != nil || kindOf(first) != "confirmation_required" {
			t.Fatalf("first = %v err = %v", first, err)
		}
		second, err := beginWith(ctx, pool, owner, objectID, 1, request)
		if err != nil {
			t.Fatal(err)
		}
		if kindOf(second) == "confirmation_required" {
			t.Fatalf("a replay must not mint a challenge: %v", second)
		}
		if got := challengesFor(t, pool, objectID); len(got) != 1 {
			t.Fatalf("%d challenges, want 1", len(got))
		}
	})

	t.Run("a same-request confirmation replay returns the recorded revision", func(t *testing.T) {
		owner := newActor(t, pool)
		objectID := createObject(t, pool, owner)
		challenge, _ := begin(ctx, pool, owner, objectID, 1)
		request := uuid.New()
		first, err := confirm(ctx, pool, owner, challenge, objectID, 1, request)
		if err != nil || kindOf(first) != "visibility_changed" {
			t.Fatalf("first = %v err = %v", first, err)
		}
		before := configHistory(t, pool, objectID)
		again, err := confirm(ctx, pool, owner, challenge, objectID, 1, request)
		if err != nil || kindOf(again) != "visibility_changed" || again["revision"] != first["revision"] {
			t.Fatalf("replay = %v err = %v", again, err)
		}
		if !historyEqual(before, configHistory(t, pool, objectID)) {
			t.Fatal("a replay appended a row")
		}
		if got := challengesFor(t, pool, objectID); got[0].State != "consumed" {
			t.Fatalf("challenge state = %s, want consumed", got[0].State)
		}
		other, _ := confirm(ctx, pool, owner, challenge, objectID, 1, uuid.New())
		if kindOf(other) != "rejected:consumed_challenge" {
			t.Fatalf("a different request id = %v", other)
		}
	})

	t.Run("another user sees the object in the public list exactly when it is public", func(t *testing.T) {
		owner, viewer := newActor(t, pool), newActor(t, pool)
		objectID := createObject(t, pool, owner)
		if publicListHas(t, pool, viewer, objectID) {
			t.Fatal("a private object is visible")
		}
		makeObjectPublic(t, pool, owner, objectID)
		if !publicListHas(t, pool, viewer, objectID) {
			t.Fatal("a public object is not visible")
		}
		revision, _ := currentRevision(t, pool, objectID)
		if result, _ := makePrivate(ctx, pool, owner, objectID, revision); kindOf(result) != "visibility_changed" {
			t.Fatalf("make private = %v", result)
		}
		if publicListHas(t, pool, viewer, objectID) {
			t.Fatal("an object made private is still visible")
		}
	})

	t.Run("an owner who lost the role cannot confirm and the challenge stays usable", func(t *testing.T) {
		owner := newActor(t, pool)
		objectID := createObject(t, pool, owner)
		challenge, _ := begin(ctx, pool, owner, objectID, 1)
		if _, err := pool.Exec(ctx, `DELETE FROM public.d_storage_objects_roles WHERE storage_object_id = $1 AND user_id = $2`,
			objectID, owner.UserID); err != nil {
			t.Fatal(err)
		}
		// Put the role back so cleanup can find the object.
		t.Cleanup(func() {
			pool.Exec(ctx, `INSERT INTO public.d_storage_objects_roles (storage_object_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`, //nolint:errcheck
				objectID, owner.UserID)
		})
		before := configHistory(t, pool, objectID)
		result, err := confirm(ctx, pool, owner, challenge, objectID, 1, uuid.New())
		if err != nil || kindOf(result) != "rejected:forbidden" {
			t.Fatalf("result = %v err = %v", result, err)
		}
		if !historyEqual(before, configHistory(t, pool, objectID)) {
			t.Fatal("config history changed")
		}
		if got := challengesFor(t, pool, objectID); got[0].State != "active" {
			t.Fatalf("challenge state = %s, want active", got[0].State)
		}
	})
}
