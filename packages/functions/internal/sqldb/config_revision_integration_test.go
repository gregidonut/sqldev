//go:build integration

package sqldb

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestConfigRevisionConstraints(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	owner := newActor(t, pool)
	objectID := createObject(t, pool, owner)

	t.Run("prepare_d_storage_upload writes revision 1 and private", func(t *testing.T) {
		history := configHistory(t, pool, objectID)
		if len(history) != 1 || history[0].Version != 1 || history[0].Public {
			t.Fatalf("history = %+v", history)
		}
	})

	t.Run("non-positive revisions are rejected", func(t *testing.T) {
		for _, revision := range []int64{0, -1} {
			_, err := pool.Exec(ctx, `INSERT INTO public.d_storage_object_config (storage_object_id, public, config_version) VALUES ($1, FALSE, $2)`,
				objectID, revision)
			var pgErr *pgconn.PgError
			if !errors.As(err, &pgErr) || pgErr.Code != "23514" {
				t.Fatalf("revision %d: err = %v, want check violation", revision, err)
			}
		}
	})

	t.Run("a missing revision is rejected", func(t *testing.T) {
		_, err := pool.Exec(ctx, `INSERT INTO public.d_storage_object_config (storage_object_id, public) VALUES ($1, FALSE)`, objectID)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "23502" {
			t.Fatalf("err = %v, want not-null violation", err)
		}
	})

	t.Run("a duplicate revision for one object is rejected", func(t *testing.T) {
		_, err := pool.Exec(ctx, `INSERT INTO public.d_storage_object_config (storage_object_id, public, config_version) VALUES ($1, TRUE, 1)`, objectID)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
			t.Fatalf("err = %v, want unique violation", err)
		}
		if got := len(configHistory(t, pool, objectID)); got != 1 {
			t.Fatalf("history length = %d, want 1", got)
		}
	})

	t.Run("the same revision is allowed for a different object", func(t *testing.T) {
		other := createObject(t, pool, owner)
		if h := configHistory(t, pool, other); len(h) != 1 || h[0].Version != 1 {
			t.Fatalf("history = %+v", h)
		}
	})

	t.Run("update is rejected and nothing changes", func(t *testing.T) {
		before := configHistory(t, pool, objectID)
		_, err := pool.Exec(ctx, `UPDATE public.d_storage_object_config SET public = TRUE WHERE storage_object_id = $1`, objectID)
		if err == nil || !strings.Contains(err.Error(), "insert-only") {
			t.Fatalf("err = %v, want insert-only rejection", err)
		}
		if !historyEqual(before, configHistory(t, pool, objectID)) {
			t.Fatal("history changed")
		}
	})

	t.Run("get_d_storage_objects returns the current revision", func(t *testing.T) {
		makeObjectPublic(t, pool, owner, objectID)
		var revision int64
		var public bool
		err := asActorQuery(ctx, pool, owner.Sub,
			`SELECT config_version, public FROM public.get_d_storage_objects('mine') WHERE storage_object_id = $1`,
			[]any{objectID}, &revision, &public)
		if err != nil {
			t.Fatal(err)
		}
		if revision != 2 || !public {
			t.Fatalf("row = (%d, %v), want (2, true)", revision, public)
		}
	})

	t.Run("delete stays possible for the upload abort path", func(t *testing.T) {
		shell := createObject(t, pool, owner)
		if _, err := pool.Exec(ctx, `DELETE FROM public.d_storage_object_config WHERE storage_object_id = $1`, shell); err != nil {
			t.Fatalf("delete: %v", err)
		}
	})

	_ = uuid.Nil
}
