//go:build integration

package sqldb

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func isPgCode(err error, code string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == code
}

func TestConfirmationPrimitives(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	owner := newActor(t, pool)

	t.Run("authenticated cannot read the tables or call any primitive", func(t *testing.T) {
		statements := []string{
			`SELECT 1 FROM public.app_confirmation_challenges`,
			`SELECT 1 FROM public.app_confirmable_operations`,
			`SELECT public.app_confirmation_cleanup(1)`,
			`SELECT public.app_confirmation_proof_verifier('x')`,
			`SELECT public.app_confirmation_lock(gen_random_uuid())`,
			`SELECT public.d_storage_visibility_guard(gen_random_uuid(), gen_random_uuid(), 1, FALSE)`,
			`SELECT public.d_storage_apply_make_public(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1, 'x', gen_random_uuid())`,
			`SELECT public.d_storage_object_current_config(gen_random_uuid())`,
		}
		for _, statement := range statements {
			err := asActor(ctx, pool, owner.Sub, func(tx pgx.Tx) error {
				_, err := tx.Exec(ctx, statement)
				return err
			})
			if !isPgCode(err, "42501") {
				t.Errorf("%s: err = %v, want permission denied", statement, err)
			}
		}
	})

	t.Run("anon cannot call the entry points", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx) //nolint:errcheck
		if _, err := tx.Exec(ctx, `SET LOCAL ROLE anon`); err != nil {
			t.Fatal(err)
		}
		for _, statement := range []string{
			`SELECT public.begin_d_storage_make_public(gen_random_uuid(), 1, gen_random_uuid())`,
			`SELECT public.make_d_storage_object_private(gen_random_uuid(), 1, gen_random_uuid())`,
			`SELECT public.confirm_app_operation(gen_random_uuid(), 'k', 't', gen_random_uuid(), 1, 'p', gen_random_uuid())`,
		} {
			if _, err := tx.Exec(ctx, `SAVEPOINT s`); err != nil {
				t.Fatal(err)
			}
			_, err := tx.Exec(ctx, statement)
			if !isPgCode(err, "42501") {
				t.Errorf("%s: err = %v, want permission denied", statement, err)
			}
			if _, err := tx.Exec(ctx, `ROLLBACK TO s`); err != nil {
				t.Fatal(err)
			}
		}
	})

	t.Run("the partial unique index allows one active challenge per binding", func(t *testing.T) {
		target := uuid.New()
		insert := func(state string) error {
			_, err := pool.Exec(ctx, `
				INSERT INTO public.app_confirmation_challenges
				  (actor_user_id, operation_kind, target_type, target_id, expected_revision, created_at, expires_at,
				   proof_verifier, state, state_changed_at, initiation_request_id)
				VALUES ($1, 'storage.visibility.make_public', 'storage_object', $2, 1, now(), now() + INTERVAL '5 minutes',
				        public.app_confirmation_proof_verifier($3), $4::public.app_confirmation_state, now(), $5)`,
				owner.UserID, target, uuid.NewString(), state, uuid.New())
			return err
		}
		if err := insert("active"); err != nil {
			t.Fatal(err)
		}
		if err := insert("active"); !isPgCode(err, "23505") {
			t.Fatalf("second active: err = %v, want unique violation", err)
		}
		// A terminal row for the same binding is fine.
		if err := insert("superseded"); err != nil {
			t.Fatalf("superseded row: %v", err)
		}
	})

	t.Run("the verifier is a 32-byte hash and never the proof", func(t *testing.T) {
		objectID := createObject(t, pool, owner)
		challenge, err := begin(ctx, pool, owner, objectID, 1)
		if err != nil {
			t.Fatal(err)
		}
		proof := challenge["proof"].(string)
		if len(proof) != 43 {
			t.Fatalf("proof length = %d, want 43 (256 bits, unpadded base64url)", len(proof))
		}
		var size int
		var stored string
		if err := pool.QueryRow(ctx, `SELECT octet_length(proof_verifier), encode(proof_verifier, 'hex') FROM public.app_confirmation_challenges WHERE challenge_id = $1`,
			challenge["challengeId"]).Scan(&size, &stored); err != nil {
			t.Fatal(err)
		}
		if size != 32 || stored == proof {
			t.Fatalf("verifier size=%d", size)
		}
		// The proof appears in no column of the row.
		var leaked bool
		if err := pool.QueryRow(ctx, `SELECT c::text LIKE '%' || $2 || '%' FROM public.app_confirmation_challenges AS c WHERE challenge_id = $1`,
			challenge["challengeId"], proof).Scan(&leaked); err != nil {
			t.Fatal(err)
		}
		if leaked {
			t.Fatal("the proof is stored in the challenge row")
		}
	})

	t.Run("cleanup is bounded and keeps active unexpired challenges", func(t *testing.T) {
		cleaner := newActor(t, pool)
		objectID := createObject(t, pool, cleaner)
		live, err := begin(ctx, pool, cleaner, objectID, 1)
		if err != nil {
			t.Fatal(err)
		}
		for i := 0; i < 5; i++ {
			if _, err := pool.Exec(ctx, `
				INSERT INTO public.app_confirmation_challenges
				  (actor_user_id, operation_kind, target_type, target_id, expected_revision, created_at, expires_at,
				   proof_verifier, state, state_changed_at, initiation_request_id)
				VALUES ($1, 'storage.visibility.make_public', 'storage_object', $2, $3, now() - INTERVAL '3 days',
				        now() - INTERVAL '3 days' + INTERVAL '5 minutes', public.app_confirmation_proof_verifier($4),
				        'expired', now() - INTERVAL '3 days', $5)`,
				cleaner.UserID, objectID, int64(100+i), uuid.NewString(), uuid.New()); err != nil {
				t.Fatal(err)
			}
		}
		old := func() int {
			var n int
			if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.app_confirmation_challenges WHERE actor_user_id = $1 AND created_at < now() - INTERVAL '1 day'`,
				cleaner.UserID).Scan(&n); err != nil {
				t.Fatal(err)
			}
			return n
		}
		if got := old(); got != 5 {
			t.Fatalf("seeded %d old rows, want 5", got)
		}
		if _, err := pool.Exec(ctx, `SELECT public.app_confirmation_cleanup(2)`); err != nil {
			t.Fatal(err)
		}
		if got := old(); got != 3 {
			t.Fatalf("after cleanup(2): %d old rows remain, want 3", got)
		}
		if _, err := pool.Exec(ctx, `SELECT public.app_confirmation_cleanup(100)`); err != nil {
			t.Fatal(err)
		}
		if got := old(); got != 0 {
			t.Fatalf("after cleanup(100): %d old rows remain, want 0", got)
		}
		var state string
		if err := pool.QueryRow(ctx, `SELECT state::text FROM public.app_confirmation_challenges WHERE challenge_id = $1`, live["challengeId"]).Scan(&state); err != nil || state != "active" {
			t.Fatalf("active challenge was removed or changed: %v %s", err, state)
		}
		// A negative limit deletes nothing.
		if _, err := pool.Exec(ctx, `SELECT public.app_confirmation_cleanup(-5)`); err != nil {
			t.Fatal(err)
		}
	})
}
