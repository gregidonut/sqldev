//go:build integration

package sqldb

// Integration tests run against the local Supabase database. They are skipped
// unless SQLDEV_TEST_DATABASE_URL is set, for example:
//
//	SQLDEV_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
//	  CGO_ENABLED=0 go -C packages/functions test -tags integration ./internal/sqldb/...
//
// The URL must connect as a role that may SET ROLE authenticated and write the
// storage tables (the local `postgres` role). Every actor created here is named
// it_<random>, and cleanup removes only rows belonging to those actors.

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const testActorPrefix = "it_"

var (
	poolOnce sync.Once
	poolErr  error
	sharedDB *pgxpool.Pool
)

// openTestDB returns a shared pool, or skips the test when no database is configured.
func openTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("SQLDEV_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("SQLDEV_TEST_DATABASE_URL is not set")
	}
	poolOnce.Do(func() {
		cfg, err := pgxpool.ParseConfig(url)
		if err != nil {
			poolErr = err
			return
		}
		cfg.MaxConns = 24
		sharedDB, poolErr = pgxpool.NewWithConfig(context.Background(), cfg)
	})
	if poolErr != nil {
		t.Fatalf("open test database: %v", poolErr)
	}
	return sharedDB
}

// actor is a signed-in user as the worker sees one: a Clerk subject.
type actor struct {
	Sub    string
	UserID uuid.UUID
}

// asActor runs fn in one transaction as the `authenticated` role with the
// actor's claims, the same way Session.apply does, then commits it.
func asActor(ctx context.Context, pool *pgxpool.Pool, sub string, fn func(tx pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	claims, _ := json.Marshal(map[string]string{"sub": sub, "role": "authenticated"})
	if _, err := tx.Exec(ctx, `SELECT set_config('request.jwt.claims', $1, true)`, string(claims)); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `SET LOCAL ROLE authenticated`); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// callJSON invokes `SELECT <call>::text` as the actor and decodes the jsonb result.
func callJSON(ctx context.Context, pool *pgxpool.Pool, sub, call string, args ...any) (map[string]any, error) {
	var out map[string]any
	err := asActor(ctx, pool, sub, func(tx pgx.Tx) error {
		var raw string
		if err := tx.QueryRow(ctx, "SELECT "+call+"::text", args...).Scan(&raw); err != nil {
			return err
		}
		return json.Unmarshal([]byte(raw), &out)
	})
	return out, err
}

// newActor registers a fresh user (set_owner creates the users row).
func newActor(t *testing.T, pool *pgxpool.Pool) actor {
	t.Helper()
	ctx := context.Background()
	a := actor{Sub: testActorPrefix + strings.ReplaceAll(uuid.NewString(), "-", "")}
	err := asActor(ctx, pool, a.Sub, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT public.set_owner()`).Scan(&a.UserID)
	})
	if err != nil {
		t.Fatalf("create actor: %v", err)
	}
	t.Cleanup(func() { cleanupActor(pool, a) })
	return a
}

// createObject creates a committed object owned by owner and returns its id.
// It uses the real prepare_d_storage_upload, then inserts the data row with
// triggers disabled for that one transaction: commit_d_storage_upload's insert
// trigger posts to the notify URL, which is unreachable locally and costs ~700 ms
// per object. createObjectViaRPC keeps the full path covered.
func createObject(t *testing.T, pool *pgxpool.Pool, owner actor) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	var objectID, dataID uuid.UUID
	var key string
	name := "it-" + uuid.NewString() + ".txt"
	err := asActor(ctx, pool, owner.Sub, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT storage_object_id, storage_object_data_id, s3_object_key FROM public.prepare_d_storage_upload($1)`, name,
		).Scan(&objectID, &dataID, &key)
	})
	if err != nil {
		t.Fatalf("prepare object: %v", err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, `SET LOCAL session_replication_role = replica`); err != nil {
		t.Fatalf("disable triggers: %v", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO public.d_storage_object_data (storage_object_data_id, storage_object_id, file_name, s3_object_key) VALUES ($1, $2, $3, $4)`,
		dataID, objectID, name, key); err != nil {
		t.Fatalf("insert data: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
	return objectID
}

// createObjectViaRPC uploads through prepare + commit exactly as the worker does.
func createObjectViaRPC(t *testing.T, pool *pgxpool.Pool, owner actor) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	var objectID, dataID uuid.UUID
	name := "it-" + uuid.NewString() + ".txt"
	err := asActor(ctx, pool, owner.Sub, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx,
			`SELECT storage_object_id, storage_object_data_id FROM public.prepare_d_storage_upload($1)`, name,
		).Scan(&objectID, &dataID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `SELECT public.commit_d_storage_upload($1, $2, $3)`, objectID, dataID, name)
		return err
	})
	if err != nil {
		t.Fatalf("create object: %v", err)
	}
	return objectID
}

// grantRole gives user a non-owner role on the object (as the test superuser).
func grantRole(t *testing.T, pool *pgxpool.Pool, objectID uuid.UUID, user actor, role string) {
	t.Helper()
	_, err := pool.Exec(context.Background(),
		`INSERT INTO public.d_storage_objects_roles (storage_object_id, user_id, role) VALUES ($1, $2, $3::public.d_storage_objects_role)`,
		objectID, user.UserID, role)
	if err != nil {
		t.Fatalf("grant %s: %v", role, err)
	}
}

type configRow struct {
	ID       uuid.UUID
	Version  int64
	Public   bool
	CreateAt time.Time
}

// configHistory returns every config row for the object ordered by revision.
func configHistory(t *testing.T, pool *pgxpool.Pool, objectID uuid.UUID) []configRow {
	t.Helper()
	rows, err := pool.Query(context.Background(),
		`SELECT storage_object_config_id, config_version, public, created_at
		   FROM public.d_storage_object_config WHERE storage_object_id = $1 ORDER BY config_version`, objectID)
	if err != nil {
		t.Fatalf("config history: %v", err)
	}
	defer rows.Close()
	var out []configRow
	for rows.Next() {
		var r configRow
		if err := rows.Scan(&r.ID, &r.Version, &r.Public, &r.CreateAt); err != nil {
			t.Fatalf("scan config: %v", err)
		}
		out = append(out, r)
	}
	return out
}

type challengeRow struct {
	ID        uuid.UUID
	State     string
	Expected  int64
	ExpiresAt time.Time
	Created   time.Time
}

// challengesFor returns every challenge targeting the object, oldest first.
func challengesFor(t *testing.T, pool *pgxpool.Pool, objectID uuid.UUID) []challengeRow {
	t.Helper()
	rows, err := pool.Query(context.Background(),
		`SELECT challenge_id, state::text, expected_revision, expires_at, created_at
		   FROM public.app_confirmation_challenges WHERE target_id = $1 ORDER BY created_at, challenge_id`, objectID)
	if err != nil {
		t.Fatalf("challenges: %v", err)
	}
	defer rows.Close()
	var out []challengeRow
	for rows.Next() {
		var r challengeRow
		if err := rows.Scan(&r.ID, &r.State, &r.Expected, &r.ExpiresAt, &r.Created); err != nil {
			t.Fatalf("scan challenge: %v", err)
		}
		out = append(out, r)
	}
	return out
}

// begin initiates make-public and returns the decoded result.
func begin(ctx context.Context, pool *pgxpool.Pool, who actor, objectID uuid.UUID, revision int64) (map[string]any, error) {
	return callJSON(ctx, pool, who.Sub, `public.begin_d_storage_make_public($1, $2, $3)`, objectID, revision, uuid.New())
}

// confirm submits a confirmation with an explicit request id.
func confirm(ctx context.Context, pool *pgxpool.Pool, who actor, challenge map[string]any, objectID uuid.UUID, revision int64, requestID uuid.UUID) (map[string]any, error) {
	return callJSON(ctx, pool, who.Sub,
		`public.confirm_app_operation($1, $2, $3, $4, $5, $6, $7)`,
		challenge["challengeId"], "storage.visibility.make_public", "storage_object", objectID, revision,
		challenge["proof"], requestID)
}

func makePrivate(ctx context.Context, pool *pgxpool.Pool, who actor, objectID uuid.UUID, revision int64) (map[string]any, error) {
	return callJSON(ctx, pool, who.Sub, `public.make_d_storage_object_private($1, $2, $3)`, objectID, revision, uuid.New())
}

// kindOf extracts the result discriminator, or the rejection reason.
func kindOf(result map[string]any) string {
	kind, _ := result["kind"].(string)
	if kind == "rejected" {
		reason, _ := result["reason"].(string)
		return "rejected:" + reason
	}
	return kind
}

// cleanupActor removes everything the actor created. It runs as the test superuser.
func cleanupActor(pool *pgxpool.Pool, a actor) {
	ctx := context.Background()
	if a.UserID == uuid.Nil {
		return
	}
	stmts := []string{
		`DELETE FROM public.app_confirmation_challenges WHERE actor_user_id = $1`,
		`DELETE FROM public.d_storage_object_config WHERE storage_object_id IN (SELECT storage_object_id FROM public.d_storage_objects_roles WHERE user_id = $1 AND role = 'owner')`,
		`DELETE FROM public.d_storage_object_data WHERE storage_object_id IN (SELECT storage_object_id FROM public.d_storage_objects_roles WHERE user_id = $1 AND role = 'owner')`,
		`DELETE FROM public.d_storage_objects WHERE storage_object_id IN (SELECT storage_object_id FROM public.d_storage_objects_roles WHERE user_id = $1 AND role = 'owner')`,
		`DELETE FROM public.d_storage_objects_roles WHERE user_id = $1`,
		`DELETE FROM public.users WHERE user_id = $1`,
	}
	for _, stmt := range stmts {
		if _, err := pool.Exec(ctx, stmt, a.UserID); err != nil {
			fmt.Fprintf(os.Stderr, "cleanup %s: %v\n", a.Sub, err)
		}
	}
}

// property runs fn as a subtest whose name carries the tag the validation
// script collects: "Feature: storage-visibility-confirmation, Property N: <title>".
func property(t *testing.T, n int, title string, fn func(t *testing.T)) {
	t.Helper()
	t.Run(fmt.Sprintf("Feature: storage-visibility-confirmation, Property %d: %s", n, title), fn)
}

// beginWith initiates make-public with an explicit request id.
func beginWith(ctx context.Context, pool *pgxpool.Pool, who actor, objectID uuid.UUID, revision int64, requestID uuid.UUID) (map[string]any, error) {
	return callJSON(ctx, pool, who.Sub, `public.begin_d_storage_make_public($1, $2, $3)`, objectID, revision, requestID)
}

// currentRevision returns the object's current (revision, public).
func currentRevision(t *testing.T, pool *pgxpool.Pool, objectID uuid.UUID) (int64, bool) {
	t.Helper()
	var revision int64
	var public bool
	err := pool.QueryRow(context.Background(),
		`SELECT config_version, public FROM public.d_storage_object_current_config($1)`, objectID).Scan(&revision, &public)
	if err != nil {
		t.Fatalf("current revision: %v", err)
	}
	return revision, public
}

// makeObjectPublic drives the real two-step flow and returns the new revision.
func makeObjectPublic(t *testing.T, pool *pgxpool.Pool, owner actor, objectID uuid.UUID) int64 {
	t.Helper()
	ctx := context.Background()
	revision, public := currentRevision(t, pool, objectID)
	if public {
		t.Fatalf("object is already public")
	}
	challenge, err := begin(ctx, pool, owner, objectID, revision)
	if err != nil || kindOf(challenge) != "confirmation_required" {
		t.Fatalf("begin: %v %v", challenge, err)
	}
	done, err := confirm(ctx, pool, owner, challenge, objectID, revision, uuid.New())
	if err != nil || kindOf(done) != "visibility_changed" {
		t.Fatalf("confirm: %v %v", done, err)
	}
	next, _ := currentRevision(t, pool, objectID)
	return next
}

// historyEqual reports whether two histories are identical row for row.
func historyEqual(a, b []configRow) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i].ID != b[i].ID || a[i].Version != b[i].Version || a[i].Public != b[i].Public || !a[i].CreateAt.Equal(b[i].CreateAt) {
			return false
		}
	}
	return true
}

func challengesEqual(a, b []challengeRow) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i].ID != b[i].ID || a[i].State != b[i].State || a[i].Expected != b[i].Expected {
			return false
		}
	}
	return true
}

// asActorQuery runs one single-row query as the actor and scans it into dest.
func asActorQuery(ctx context.Context, pool *pgxpool.Pool, sub, query string, args []any, dest ...any) error {
	return asActor(ctx, pool, sub, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, query, args...).Scan(dest...)
	})
}
