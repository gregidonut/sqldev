//go:build integration

package sqldb

import (
	"context"
	"math/rand"
	"reflect"
	"strings"
	"testing"
	"testing/quick"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Feature: confirmation-dialog-copy, Property 1: Registry identifiers are generated, unique, and monotonic.
//
// Every iteration is a random pattern of registry insertions that omit registry_id, valid
// and invalid, kept and rolled back to a savepoint, plus reads and a real operation
// execution. All writes happen in a transaction that is rolled back, and the column DEFAULT
// is swapped to a TEMP sequence with the real sequence's options and state inside it, so
// the real registry and the real sequence are never changed. The test checks that, at the
// end of the run, both are exactly as they were.
func TestRegistryIdentifierProperty(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	owner := newActor(t, pool)
	objectID := createObject(t, pool, owner)

	copyProperty(t, 1, "Registry identifiers are generated, unique, and monotonic", func(t *testing.T) {
		before, err := snapshotRegistry(ctx, pool)
		if err != nil {
			t.Fatal(err)
		}
		if before.PrimaryKey != "PRIMARY KEY (operation_kind)" {
			t.Fatalf("primary key = %q, want operation_kind", before.PrimaryKey)
		}
		if !strings.Contains(before.ForeignKey, "FOREIGN KEY (operation_kind) REFERENCES app_confirmable_operations(operation_kind)") {
			t.Fatalf("challenge foreign key = %q, want operation_kind", before.ForeignKey)
		}
		if before.DefaultSQL != "nextval('app_confirmable_operations_registry_id_seq'::regclass)" {
			t.Fatalf("column default = %q, want the registry sequence", before.DefaultSQL)
		}
		var owned string
		if err := pool.QueryRow(ctx, `SELECT pg_get_serial_sequence('public.app_confirmable_operations', 'registry_id')`).Scan(&owned); err != nil ||
			owned != "public.app_confirmable_operations_registry_id_seq" {
			t.Fatalf("owned sequence = %q err = %v", owned, err)
		}
		if reg := makePublicRegistry(t, pool); reg.RegistryID != 1000 {
			t.Fatalf("make_public registry_id = %d, want 1000", reg.RegistryID)
		}

		check := func(seed int64) bool {
			rng := rand.New(rand.NewSource(seed))
			if !registryPatternHolds(t, pool, ctx, rng, seed) {
				return false
			}
			// Operation execution after the rolled-back inserts: the identity is stable and
			// the challenge is bound to the same operation_kind.
			result, err := begin(ctx, pool, owner, objectID, 1)
			if err != nil || kindOf(result) != "confirmation_required" {
				t.Errorf("seed %d: begin = %v err = %v", seed, result, err)
				return false
			}
			if result["registryId"] != "1000" || result["operationKind"] != makePublicKind {
				t.Errorf("seed %d: identity changed after an operation: %v", seed, result)
				return false
			}
			var kind string
			var id int64
			if err := pool.QueryRow(ctx, `
				SELECT c.operation_kind, o.registry_id
				  FROM public.app_confirmation_challenges AS c
				  JOIN public.app_confirmable_operations AS o USING (operation_kind)
				 WHERE c.challenge_id = $1`, result["challengeId"]).Scan(&kind, &id); err != nil || kind != makePublicKind || id != 1000 {
				t.Errorf("seed %d: challenge relationship = %q %d err = %v", seed, kind, id, err)
				return false
			}
			return true
		}
		if err := quick.Check(check, &quick.Config{MaxCount: 100}); err != nil {
			t.Fatal(err)
		}

		after, err := snapshotRegistry(ctx, pool)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(before, after) {
			t.Fatalf("the registry or its real sequence changed:\nbefore %+v\nafter  %+v", before, after)
		}
	})
}

// registryPatternHolds runs one random allocation pattern in a rolled-back transaction.
func registryPatternHolds(t *testing.T, pool *pgxpool.Pool, ctx context.Context, rng *rand.Rand, seed int64) bool {
	t.Helper()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Errorf("seed %d: begin: %v", seed, err)
		return false
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, `SET LOCAL lock_timeout = '20s'`); err != nil {
		t.Errorf("seed %d: lock_timeout: %v", seed, err)
		return false
	}

	next, err := useScratchRegistrySequence(ctx, tx)
	if err != nil {
		t.Errorf("seed %d: %v", seed, err)
		return false
	}
	pre, err := readRegistry(ctx, tx)
	if err != nil {
		t.Errorf("seed %d: %v", seed, err)
		return false
	}
	used := map[string]bool{}
	var maxPre int64
	for _, r := range pre {
		used[r.OperationKind] = true
		if r.RegistryID > maxPre {
			maxPre = r.RegistryID
		}
	}
	if next <= maxPre {
		t.Errorf("seed %d: the next allocation %d does not follow the highest identifier %d", seed, next, maxPre)
		return false
	}

	var kept []registryRow // retained rows, in allocation order
	fail := func(format string, args ...any) bool {
		t.Errorf("seed %d: "+format, append([]any{seed}, args...)...)
		return false
	}
	expectCode := func(err error, code string) bool {
		if e := pgErrorOf(err); e == nil || e.Code != code {
			t.Errorf("seed %d: err = %v, want SQLSTATE %s", seed, err, code)
			return false
		}
		return true
	}

	for i, n := 0, 1+rng.Intn(10); i < n; i++ {
		switch rng.Intn(7) {
		case 0, 1: // a valid insert is retained with the next value
			row := registryRow{OperationKind: genKind(rng, used), TargetType: "storage_object",
				Title: genTemplate(rng), Description: genBounded(rng, 2000, false), ConfirmLabel: genBounded(rng, 80, false)}
			id, err := insertRegistryRow(ctx, tx, row.OperationKind, row.Title, row.Description, row.ConfirmLabel)
			if err != nil {
				return fail("valid insert: %v", err)
			}
			if id != next {
				return fail("allocated %d, want %d", id, next)
			}
			row.RegistryID = id
			kept = append(kept, row)
			next++
		case 2: // an insert rolled back to a savepoint still consumes a value
			kind := genKind(rng, used)
			if _, err := tx.Exec(ctx, `SAVEPOINT patterned`); err != nil {
				return fail("savepoint: %v", err)
			}
			id, err := insertRegistryRow(ctx, tx, kind, genTemplate(rng), genBounded(rng, 2000, false), genBounded(rng, 80, false))
			if err != nil || id != next {
				return fail("rolled-back insert allocated %d err = %v, want %d", id, err, next)
			}
			next++
			if _, err := tx.Exec(ctx, `ROLLBACK TO SAVEPOINT patterned`); err != nil {
				return fail("rollback to savepoint: %v", err)
			}
			if _, err := tx.Exec(ctx, `RELEASE SAVEPOINT patterned`); err != nil {
				return fail("release: %v", err)
			}
			used[kind] = false
		case 3: // a row that violates a copy constraint fails after allocating
			tmpl, desc, conf := genTemplate(rng), genBounded(rng, 2000, false), genBounded(rng, 80, false)
			switch rng.Intn(10) {
			case 0:
				tmpl = "Make it public?"
			case 1:
				tmpl = targetToken + " and " + targetToken
			case 2:
				tmpl = "Make " + targetToken + " {{ public"
			case 3:
				tmpl = "Make " + targetToken + " }} public"
			case 4:
				tmpl = "\u00a0\u00a0"
			case 5:
				desc = "\u0085\u2003"
			case 6:
				desc = strings.Repeat("d", 2001)
			case 7:
				conf = "\u3000"
			case 8:
				conf = strings.Repeat("c", 81)
			case 9:
				desc = ""
			}
			_, err := insertRegistryRow(ctx, tx, genKind(rng, used), tmpl, desc, conf)
			if !expectCode(err, "23514") {
				return false
			}
			next++
		case 4: // a duplicate operation_kind fails after allocating
			dup := makePublicKind
			if len(kept) > 0 && rng.Intn(2) == 0 {
				dup = kept[rng.Intn(len(kept))].OperationKind
			}
			_, err := insertRegistryRow(ctx, tx, dup, genTemplate(rng), genBounded(rng, 2000, false), genBounded(rng, 80, false))
			if !expectCode(err, "23505") {
				return false
			}
			next++
		case 5: // an explicit identifier is checked without touching the sequence
			explicit, code := []int64{0, -7, 5, 999, 1000}[rng.Intn(5)], "23514"
			if explicit == 1000 {
				code = "23505"
			}
			err := tryTx(ctx, tx, `
				INSERT INTO public.app_confirmable_operations
				  (operation_kind, target_type, validity, registry_id, dialog_title_template, dialog_description, dialog_confirm_label)
				VALUES ($1, 'storage_object', INTERVAL '5 minutes', $2, $3, 'd', 'c')`,
				genKind(rng, used), explicit, "T "+targetToken)
			if !expectCode(err, code) {
				return false
			}
		default: // reads change nothing
			rows, err := readRegistry(ctx, tx)
			if err != nil || len(rows) != len(pre)+len(kept) {
				return fail("read saw %d rows (err %v), want %d", len(rows), err, len(pre)+len(kept))
			}
		}
	}

	after, err := readRegistry(ctx, tx)
	if err != nil {
		return fail("final read: %v", err)
	}
	if len(after) != len(pre)+len(kept) {
		return fail("%d rows, want %d", len(after), len(pre)+len(kept))
	}
	byKind := map[string]registryRow{}
	seen := map[int64]bool{}
	for _, r := range after {
		byKind[r.OperationKind] = r
		if seen[r.RegistryID] {
			return fail("duplicate identifier %d", r.RegistryID)
		}
		seen[r.RegistryID] = true
		if r.RegistryID < 1000 || r.RegistryID > maxRegistryID {
			return fail("identifier %d is outside [1000, 2^63-1]", r.RegistryID)
		}
		if !validRegistryCopy(r) {
			return fail("operation %s holds invalid dialog copy %+v", r.OperationKind, r)
		}
		if r.TargetType == "" {
			return fail("operation %s has no target type", r.OperationKind)
		}
	}
	// Pre-existing rows are never renumbered, and retained rows keep the value they were
	// handed, which increases strictly in allocation order (gaps are allowed and expected).
	for _, r := range pre {
		if got := byKind[r.OperationKind]; got != r {
			return fail("pre-existing row changed: %+v -> %+v", r, got)
		}
	}
	last := maxPre
	for _, r := range kept {
		if got := byKind[r.OperationKind]; got != r {
			return fail("retained row changed: %+v -> %+v", r, got)
		}
		if r.RegistryID <= last {
			return fail("identifier %d does not exceed the previous allocation %d", r.RegistryID, last)
		}
		last = r.RegistryID
	}
	// Every existing challenge still resolves through operation_kind.
	var orphans int
	if err := tx.QueryRow(ctx, `
		SELECT count(*) FROM public.app_confirmation_challenges AS c
		  LEFT JOIN public.app_confirmable_operations AS o USING (operation_kind)
		 WHERE o.operation_kind IS NULL`).Scan(&orphans); err != nil || orphans != 0 {
		return fail("%d challenges lost their operation_kind relationship (err %v)", orphans, err)
	}
	return true
}
