//go:build integration

package sqldb

// Example (non-property) tests for the registry identity and dialog copy defined in
// `20261101090100_create_app_confirmation_protocol.sql` (registry table, sequence, copy
// resolver) and `20261101090200_create_d_storage_visibility_functions.sql`
// (begin_d_storage_make_public), and the privileges around them. Registry writes happen only in
// transactions that are rolled back, and the real registry sequence is only ever read.

import (
	"context"
	"encoding/json"
	"math/rand"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// rand0 only seeds throwaway operation kinds inside rolled-back transactions.
var rand0 = rand.New(rand.NewSource(20261102))

const (
	approvedTitle       = "Make “{{targetLabel}}” public?"
	approvedDescription = "Anyone signed in to SQLDev will be able to see and download this file. The stored file stays private in S3."
	approvedConfirm     = "Make public"

	resolverMessage = "app_confirmation_resolve_dialog_copy: invalid dialog copy"
)

// registryUntouched fails the test at cleanup if the registry rows, the real sequence's state,
// or the keys that bind challenges differ from what they were when it was called.
func registryUntouched(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	before, err := snapshotRegistry(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		after, err := snapshotRegistry(ctx, pool)
		if err != nil || !reflect.DeepEqual(before, after) {
			t.Errorf("the registry or its real sequence changed:\nbefore %+v\nafter  %+v (err %v)", before, after, err)
		}
	})
}

func migrationPath(name string) string {
	return filepath.Join("..", "..", "..", "backend", "supabase", "migrations", name)
}

func readMigration(t *testing.T, name string) string {
	t.Helper()
	raw, err := os.ReadFile(migrationPath(name))
	if err != nil {
		t.Fatalf("read migration %s: %v", name, err)
	}
	return string(raw)
}

func TestRegistryMigrationShape(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()

	t.Run("the make_public row holds identifier 1000 and the approved copy", func(t *testing.T) {
		want := registryRow{OperationKind: makePublicKind, TargetType: "storage_object", RegistryID: 1000,
			Title: approvedTitle, Description: approvedDescription, ConfirmLabel: approvedConfirm}
		if got := makePublicRegistry(t, pool); got != want {
			t.Fatalf("registry row = %+v, want %+v", got, want)
		}
	})

	t.Run("operation_kind is still the key and the challenge binding, registry_id is a unique non-null column", func(t *testing.T) {
		shape, err := snapshotRegistry(ctx, pool)
		if err != nil {
			t.Fatal(err)
		}
		if shape.PrimaryKey != "PRIMARY KEY (operation_kind)" ||
			!strings.Contains(shape.ForeignKey, "FOREIGN KEY (operation_kind) REFERENCES app_confirmable_operations(operation_kind)") {
			t.Fatalf("primary key %q foreign key %q", shape.PrimaryKey, shape.ForeignKey)
		}
		var challengeColumns []string
		rows, err := pool.Query(ctx, `SELECT column_name FROM information_schema.columns
			WHERE table_schema = 'public' AND table_name = 'app_confirmation_challenges' AND (column_name LIKE 'registry%' OR column_name LIKE 'dialog%')`)
		if err != nil {
			t.Fatal(err)
		}
		for rows.Next() {
			var c string
			if err := rows.Scan(&c); err != nil {
				t.Fatal(err)
			}
			challengeColumns = append(challengeColumns, c)
		}
		rows.Close()
		if len(challengeColumns) != 0 {
			t.Fatalf("challenges must not store the identifier or copy, found %v", challengeColumns)
		}

		nullable := map[string]string{}
		cols, err := pool.Query(ctx, `SELECT column_name, is_nullable FROM information_schema.columns
			WHERE table_schema = 'public' AND table_name = 'app_confirmable_operations'`)
		if err != nil {
			t.Fatal(err)
		}
		for cols.Next() {
			var name, null string
			if err := cols.Scan(&name, &null); err != nil {
				t.Fatal(err)
			}
			nullable[name] = null
		}
		cols.Close()
		for _, c := range []string{"registry_id", "dialog_title_template", "dialog_description", "dialog_confirm_label"} {
			if nullable[c] != "NO" {
				t.Errorf("column %s nullable = %q, want NO", c, nullable[c])
			}
		}

		defs := map[string]string{}
		cons, err := pool.Query(ctx, `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
			WHERE conrelid = 'public.app_confirmable_operations'::REGCLASS`)
		if err != nil {
			t.Fatal(err)
		}
		for cons.Next() {
			var name, def string
			if err := cons.Scan(&name, &def); err != nil {
				t.Fatal(err)
			}
			defs[name] = def
		}
		cons.Close()
		if defs["app_confirmable_operations_registry_id_key"] != "UNIQUE (registry_id)" {
			t.Errorf("registry_id uniqueness = %q", defs["app_confirmable_operations_registry_id_key"])
		}
		if !strings.Contains(defs["app_confirmable_operations_registry_id_min"], "registry_id >= 1000") {
			t.Errorf("registry_id minimum = %q", defs["app_confirmable_operations_registry_id_min"])
		}
		for _, name := range []string{"app_confirmable_operations_dialog_title_template_valid",
			"app_confirmable_operations_dialog_description_valid", "app_confirmable_operations_dialog_confirm_label_valid"} {
			if defs[name] == "" {
				t.Errorf("constraint %s is missing", name)
			}
		}
	})

	t.Run("the sequence is a BIGINT from 1000 that does not cycle and the column draws from it", func(t *testing.T) {
		var (
			dataType                           string
			start, min, inc, cache             int64
			maxIsInt64Max, cycle, owned, trigg bool
		)
		err := pool.QueryRow(ctx, `
			SELECT data_type::TEXT, start_value, min_value, max_value = 9223372036854775807, increment_by, cache_size, cycle,
			       pg_get_serial_sequence('public.app_confirmable_operations', 'registry_id') = 'public.app_confirmable_operations_registry_id_seq',
			       (SELECT tgenabled = 'O' FROM pg_trigger WHERE tgrelid = 'public.app_confirmable_operations'::REGCLASS
			          AND tgname = 'app_confirmable_operations_registry_id_immutable')
			  FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'app_confirmable_operations_registry_id_seq'`).
			Scan(&dataType, &start, &min, &maxIsInt64Max, &inc, &cache, &cycle, &owned, &trigg)
		if err != nil {
			t.Fatal(err)
		}
		if dataType != "bigint" || start != 1000 || min != 1000 || !maxIsInt64Max || inc != 1 || cache != 1 || cycle || !owned || !trigg {
			t.Fatalf("sequence: type=%s start=%d min=%d maxIsInt64Max=%v inc=%d cache=%d cycle=%v owned=%v trigger=%v",
				dataType, start, min, maxIsInt64Max, inc, cache, cycle, owned, trigg)
		}
		shape, _ := snapshotRegistry(ctx, pool)
		if shape.DefaultSQL != "nextval('app_confirmable_operations_registry_id_seq'::regclass)" {
			t.Fatalf("column default = %q", shape.DefaultSQL)
		}
	})

	t.Run("row level security stays on with no policies", func(t *testing.T) {
		var rls bool
		var policies int
		if err := pool.QueryRow(ctx, `
			SELECT c.relrowsecurity, (SELECT count(*) FROM pg_policy WHERE polrelid = c.oid)
			  FROM pg_class AS c WHERE c.oid = 'public.app_confirmable_operations'::REGCLASS`).Scan(&rls, &policies); err != nil || !rls || policies != 0 {
			t.Fatalf("rls = %v policies = %d err = %v", rls, policies, err)
		}
	})

	t.Run("the e2e reset neither truncates the registry nor restarts its sequence", func(t *testing.T) {
		raw, err := os.ReadFile(filepath.Join("..", "..", "..", "cli", "internal", "e2ereset", "application_reset.sql"))
		if err != nil {
			t.Fatal(err)
		}
		// Comments may explain what the file does not do; only statements count.
		var statements []string
		for _, line := range strings.Split(string(raw), "\n") {
			if i := strings.Index(line, "--"); i >= 0 {
				line = line[:i]
			}
			statements = append(statements, line)
		}
		text := strings.ToLower(strings.Join(statements, "\n"))
		for _, forbidden := range []string{"app_confirmable_operations", "registry_id", "restart identity", "cascade"} {
			if strings.Contains(text, forbidden) {
				t.Errorf("application_reset.sql mentions %q", forbidden)
			}
		}
		if !strings.Contains(text, "app_confirmation_challenges") {
			t.Error("application_reset.sql no longer truncates the challenges")
		}
	})
}

func resolveCopy(ctx context.Context, q sqlRunner, template, description, confirm string, label any) (map[string]any, error) {
	var raw string
	if err := q.QueryRow(ctx, `SELECT public.app_confirmation_resolve_dialog_copy($1, $2, $3, $4)::TEXT`,
		template, description, confirm, label).Scan(&raw); err != nil {
		return nil, err
	}
	var out map[string]any
	return out, json.Unmarshal([]byte(raw), &out)
}

func TestDialogCopyResolverExamples(t *testing.T) {
	pool := openTestDB(t)
	registryUntouched(t, pool)
	ctx := context.Background()

	t.Run("report.pdf resolves to the approved copy", func(t *testing.T) {
		got, err := resolveCopy(ctx, pool, approvedTitle, approvedDescription, approvedConfirm, "report.pdf")
		want := map[string]any{"title": "Make “report.pdf” public?", "description": approvedDescription, "confirmLabel": "Make public"}
		if err != nil || !reflect.DeepEqual(got, want) {
			t.Fatalf("got %#v err %v, want %#v", got, err, want)
		}
	})

	t.Run("the resolver is IMMUTABLE, internal, and not executable by application roles", func(t *testing.T) {
		var volatility string
		var anon, authenticated, public bool
		if err := pool.QueryRow(ctx, `
			SELECT p.provolatile::TEXT,
			       has_function_privilege('anon', p.oid, 'EXECUTE'),
			       has_function_privilege('authenticated', p.oid, 'EXECUTE'),
			       has_function_privilege(0::OID, p.oid, 'EXECUTE')
			  FROM pg_proc AS p WHERE p.oid = 'public.app_confirmation_resolve_dialog_copy(text, text, text, text)'::REGPROCEDURE`).
			Scan(&volatility, &anon, &authenticated, &public); err != nil {
			t.Fatal(err)
		}
		if volatility != "i" || anon || authenticated || public {
			t.Fatalf("volatility=%s anon=%v authenticated=%v public=%v", volatility, anon, authenticated, public)
		}
	})

	t.Run("a label is substituted literally and exactly once", func(t *testing.T) {
		labels := []string{
			"report.pdf", `a "quoted" name`, "“curly” ‘single’", "{{targetLabel}}", `back\slash \1 \\ \n`,
			"a&b &amp; &#x27;", "<script>alert(1)</script>", "javascript:alert(1)", "😀𝒳", "e\u0301\u0302", "שלום עולם", "\u202e rtl",
			"  keeps  its  spaces  ", "\ufeff", strings.Repeat("a", 185), strings.Repeat("😀", 185),
		}
		for _, label := range labels {
			got, err := resolveCopy(ctx, pool, approvedTitle, approvedDescription, approvedConfirm, label)
			if err != nil {
				t.Errorf("label %q: %v", label, err)
				continue
			}
			want := strings.ReplaceAll(approvedTitle, targetToken, label)
			if got["title"] != want || utf8.RuneCountInString(want) > 200 {
				t.Errorf("label %q: title = %q, want %q", label, got["title"], want)
			}
		}
	})

	t.Run("a title of exactly 200 code points passes and 201 fails", func(t *testing.T) {
		if got, err := resolveCopy(ctx, pool, approvedTitle, approvedDescription, approvedConfirm, strings.Repeat("a", 185)); err != nil ||
			utf8.RuneCountInString(got["title"].(string)) != 200 {
			t.Fatalf("185-character name: %v %v", got, err)
		}
		for _, n := range []int{186, 187} {
			_, err := resolveCopy(ctx, pool, approvedTitle, approvedDescription, approvedConfirm, strings.Repeat("a", n))
			if e := pgErrorOf(err); e == nil || e.Code != "P0001" || e.Message != resolverMessage {
				t.Errorf("%d-character name: err = %v, want %q", n, err, resolverMessage)
			}
		}
	})

	t.Run("a copy at its exact bounds passes and beyond them fails", func(t *testing.T) {
		if _, err := resolveCopy(ctx, pool, approvedTitle, strings.Repeat("😀", 2000), strings.Repeat("𝒳", 80), "x"); err != nil {
			t.Fatalf("exact bounds counted in code points: %v", err)
		}
		cases := []struct{ name, template, description, confirm string }{
			{"description over 2000", approvedTitle, strings.Repeat("d", 2001), "c"},
			{"confirm label over 80", approvedTitle, "d", strings.Repeat("c", 81)},
			{"blank template", "\u00a0\u0085", "d", "c"},
			{"blank description", approvedTitle, "\u2003", "c"},
			{"empty description", approvedTitle, "", "c"},
			{"blank confirm label", approvedTitle, "d", "\u3000\t"},
		}
		for _, c := range cases {
			_, err := resolveCopy(ctx, pool, c.template, c.description, c.confirm, "report.pdf")
			if e := pgErrorOf(err); e == nil || e.Code != "P0001" || e.Message != resolverMessage {
				t.Errorf("%s: err = %v, want %q", c.name, err, resolverMessage)
			}
		}
	})

	t.Run("a NULL, empty or blank-class label fails", func(t *testing.T) {
		labels := []any{nil, "", " ", "\t\n", "\u00a0", "\u0085", "\u3000\u2003\u200a", "\u2028\u2029", "\u1680\u202f\u205f"}
		for _, label := range labels {
			_, err := resolveCopy(ctx, pool, approvedTitle, approvedDescription, approvedConfirm, label)
			e := pgErrorOf(err)
			if e == nil || e.Code != "P0001" || e.Message != resolverMessage {
				t.Errorf("label %q: err = %v, want %q", label, err, resolverMessage)
			}
		}
	})

	t.Run("the committed name is the newest data row, with the larger id breaking a timestamp tie", func(t *testing.T) {
		owner := newActor(t, pool)
		objectID := createObject(t, pool, owner)
		scratchTx(t, pool, func(ctx context.Context, tx pgx.Tx) {
			insert := func(id uuid.UUID, name, offset string) {
				if _, err := tx.Exec(ctx, `SET LOCAL session_replication_role = replica`); err != nil {
					t.Fatal(err)
				}
				if _, err := tx.Exec(ctx, `INSERT INTO public.d_storage_object_data
					(storage_object_data_id, storage_object_id, file_name, s3_object_key, created_at)
					VALUES ($1, $2, $3, $5, now() + $4::INTERVAL)`, id, objectID, name, offset, "k/"+id.String()); err != nil {
					t.Fatal(err)
				}
				if _, err := tx.Exec(ctx, `SET LOCAL session_replication_role = origin`); err != nil {
					t.Fatal(err)
				}
			}
			titleOf := func() string {
				res, err := callInTx(ctx, tx, owner.Sub, nil, `public.begin_d_storage_make_public($1, $2, $3)`, objectID, int64(1), uuid.New())
				if err != nil || kindOf(res) != "confirmation_required" {
					t.Fatalf("begin = %v err = %v", res, err)
				}
				return res["dialogCopy"].(map[string]any)["title"].(string)
			}
			ids := []uuid.UUID{uuid.New(), uuid.New()}
			if ids[0].String() > ids[1].String() {
				ids[0], ids[1] = ids[1], ids[0]
			}
			insert(ids[0], "tie-lower-id", "1 hour")
			insert(ids[1], "tie-higher-id", "1 hour")
			if got, want := titleOf(), "Make “tie-higher-id” public?"; got != want {
				t.Fatalf("tie: title = %q, want %q", got, want)
			}
			lowest := uuid.MustParse("00000000-0000-0000-0000-000000000001")
			insert(lowest, "strictly-newer", "2 hours")
			if got, want := titleOf(), "Make “strictly-newer” public?"; got != want {
				t.Fatalf("newest: title = %q, want %q", got, want)
			}
		})
	})

	t.Run("initiation for report.pdf returns the approved copy end to end", func(t *testing.T) {
		owner := newActor(t, pool)
		objectID := createObjectNamed(t, pool, owner, "report.pdf")
		res, err := begin(ctx, pool, owner, objectID, 1)
		want := map[string]any{"title": "Make “report.pdf” public?", "description": approvedDescription, "confirmLabel": "Make public"}
		if err != nil || res["registryId"] != "1000" || !reflect.DeepEqual(res["dialogCopy"], want) {
			t.Fatalf("result = %v err = %v", res, err)
		}
	})
}

func TestRegistryConstraintAndAllocationExamples(t *testing.T) {
	pool := openTestDB(t)
	registryUntouched(t, pool)

	t.Run("registry_id cannot be changed but authored copy can", func(t *testing.T) {
		scratchTx(t, pool, func(ctx context.Context, tx pgx.Tx) {
			err := tryTx(ctx, tx, `UPDATE public.app_confirmable_operations SET registry_id = registry_id + 1 WHERE operation_kind = $1`, makePublicKind)
			if e := pgErrorOf(err); e == nil || e.Code != "P0001" || e.Message != "app_confirmable_operations: registry_id is immutable" {
				t.Fatalf("registry_id update: err = %v", err)
			}
			if err := tryTx(ctx, tx, `UPDATE public.app_confirmable_operations SET registry_id = registry_id WHERE operation_kind = $1`, makePublicKind); err != nil {
				t.Fatalf("writing the same identifier back must be allowed: %v", err)
			}
			if err := tryTx(ctx, tx, `UPDATE public.app_confirmable_operations
				SET dialog_description = 'edited', dialog_confirm_label = 'Go', dialog_title_template = 'Share “{{targetLabel}}”?'
				WHERE operation_kind = $1`, makePublicKind); err != nil {
				t.Fatalf("copy edit must be allowed: %v", err)
			}
			reg := makePublicRegistry(t, tx)
			if reg.RegistryID != 1000 || reg.Description != "edited" || reg.Title != "Share “{{targetLabel}}”?" {
				t.Fatalf("row after edit = %+v", reg)
			}
		})
	})

	t.Run("invalid copy violates a constraint and valid boundary copy is accepted", func(t *testing.T) {
		scratchTx(t, pool, func(ctx context.Context, tx pgx.Tx) {
			if _, err := useScratchRegistrySequence(ctx, tx); err != nil {
				t.Fatal(err)
			}
			used := map[string]bool{}
			rejected := []struct{ name, template, description, confirm string }{
				{"template without a token", "Make it public?", "d", "c"},
				{"template with two tokens", targetToken + targetToken, "d", "c"},
				{"template with a stray opening delimiter", "{{ " + targetToken, "d", "c"},
				{"template with a stray closing delimiter", targetToken + " }}", "d", "c"},
				{"a near-miss token", "Make {{targetlabel}}", "d", "c"},
				{"blank template", "\u00a0", "d", "c"},
				{"empty description", approvedTitle, "", "c"},
				{"NBSP-only description", approvedTitle, "\u00a0\u00a0", "c"},
				{"NEL-only description", approvedTitle, "\u0085", "c"},
				{"description of 2001 code points", approvedTitle, strings.Repeat("d", 2001), "c"},
				{"blank confirm label", approvedTitle, "d", "\u3000"},
				{"confirm label of 81 code points", approvedTitle, "d", strings.Repeat("😀", 81)},
			}
			for _, c := range rejected {
				_, err := insertRegistryRow(ctx, tx, genKind(rand0, used), c.template, c.description, c.confirm)
				if e := pgErrorOf(err); e == nil || e.Code != "23514" {
					t.Errorf("%s: err = %v, want a check violation", c.name, err)
				}
			}
			accepted := []struct{ name, template, description, confirm string }{
				{"U+FEFF-only description is not blank by the shared class", approvedTitle, "\ufeff", "c"},
				{"description of exactly 2000 astral code points", approvedTitle, strings.Repeat("😀", 2000), "c"},
				{"confirm label of exactly 80 astral code points", approvedTitle, "d", strings.Repeat("𝒳", 80)},
				{"markup in copy is only text", "<b>" + targetToken + "</b>", "<script>alert(1)</script>", "&amp;"},
			}
			for _, c := range accepted {
				if _, err := insertRegistryRow(ctx, tx, genKind(rand0, used), c.template, c.description, c.confirm); err != nil {
					t.Errorf("%s: %v", c.name, err)
				}
			}
		})
	})

	t.Run("a rolled-back allocation leaves a gap and renumbers nothing", func(t *testing.T) {
		scratchTx(t, pool, func(ctx context.Context, tx pgx.Tx) {
			next, err := useScratchRegistrySequence(ctx, tx)
			if err != nil {
				t.Fatal(err)
			}
			used := map[string]bool{}
			first, err := insertRegistryRow(ctx, tx, genKind(rand0, used), approvedTitle, "d", "c")
			if err != nil || first != next {
				t.Fatalf("first = %d err = %v, want %d", first, err, next)
			}
			if _, err := tx.Exec(ctx, `SAVEPOINT gap`); err != nil {
				t.Fatal(err)
			}
			lost, err := insertRegistryRow(ctx, tx, genKind(rand0, used), approvedTitle, "d", "c")
			if err != nil || lost != first+1 {
				t.Fatalf("lost = %d err = %v, want %d", lost, err, first+1)
			}
			if _, err := tx.Exec(ctx, `ROLLBACK TO SAVEPOINT gap`); err != nil {
				t.Fatal(err)
			}
			third, err := insertRegistryRow(ctx, tx, genKind(rand0, used), approvedTitle, "d", "c")
			if err != nil || third != first+2 {
				t.Fatalf("third = %d err = %v, want a gap: %d", third, err, first+2)
			}
			rows, err := readRegistry(ctx, tx)
			if err != nil {
				t.Fatal(err)
			}
			ids := []int64{}
			for _, r := range rows {
				ids = append(ids, r.RegistryID)
			}
			if !slices.Equal(ids, []int64{1000, first, third}) {
				t.Fatalf("retained identifiers = %v, want [1000 %d %d]", ids, first, third)
			}
		})
	})

	t.Run("allocation past the signed 64-bit maximum fails and changes nothing", func(t *testing.T) {
		scratchTx(t, pool, func(ctx context.Context, tx pgx.Tx) {
			if _, err := useScratchRegistrySequence(ctx, tx); err != nil {
				t.Fatal(err)
			}
			if _, err := tx.Exec(ctx, `SELECT setval('pg_temp.`+scratchSequenceName+`', $1, true)`, maxRegistryID-1); err != nil {
				t.Fatal(err)
			}
			used := map[string]bool{}
			snapshot, err := snapshotRegistry(ctx, tx)
			if err != nil {
				t.Fatal(err)
			}
			challengesBefore := countRows(t, ctx, tx, "app_confirmation_challenges")
			configBefore := countRows(t, ctx, tx, "d_storage_object_config")

			last, err := insertRegistryRow(ctx, tx, genKind(rand0, used), approvedTitle, "d", "c")
			if err != nil || last != maxRegistryID {
				t.Fatalf("the maximum identifier: %d err = %v", last, err)
			}
			for i := 0; i < 2; i++ {
				_, err = insertRegistryRow(ctx, tx, genKind(rand0, used), approvedTitle, "d", "c")
				if e := pgErrorOf(err); e == nil || e.Code != "2200H" {
					t.Fatalf("past the maximum (attempt %d): err = %v, want sequence_generator_limit_exceeded", i, err)
				}
			}
			if err := tryTx(ctx, tx, `SELECT nextval('pg_temp.`+scratchSequenceName+`')`); pgErrorOf(err) == nil || pgErrorOf(err).Code != "2200H" {
				t.Fatalf("the sequence must not cycle: err = %v", err)
			}
			rows, err := readRegistry(ctx, tx)
			if err != nil {
				t.Fatal(err)
			}
			if want := append(append([]registryRow{}, snapshot.Rows...), rows[len(rows)-1]); !reflect.DeepEqual(rows, want) || len(rows) != len(snapshot.Rows)+1 {
				t.Fatalf("retained rows changed: %+v", rows)
			}
			if countRows(t, ctx, tx, "app_confirmation_challenges") != challengesBefore || countRows(t, ctx, tx, "d_storage_object_config") != configBefore {
				t.Fatal("exhaustion changed challenges or configuration rows")
			}
		})
	})
}

func countRows(t *testing.T, ctx context.Context, q sqlRunner, table string) int {
	t.Helper()
	var n int
	if err := q.QueryRow(ctx, `SELECT count(*) FROM public.`+table).Scan(&n); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return n
}

// ---- the applicability block and the whole migration ------------------------------------

func TestRegistryPrivileges(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()

	denied := []string{
		`SELECT 1 FROM public.app_confirmable_operations`,
		`SELECT registry_id FROM public.app_confirmable_operations`,
		`INSERT INTO public.app_confirmable_operations (operation_kind, target_type, validity, dialog_title_template, dialog_description, dialog_confirm_label)
		   VALUES ('it.scratch_denied', 'storage_object', INTERVAL '1 minute', 'T {{targetLabel}}', 'd', 'c')`,
		`UPDATE public.app_confirmable_operations SET dialog_description = 'x'`,
		`DELETE FROM public.app_confirmable_operations`,
		`SELECT last_value FROM public.app_confirmable_operations_registry_id_seq`,
		`SELECT public.app_confirmation_resolve_dialog_copy('T {{targetLabel}}', 'd', 'c', 'l')`,
		`SELECT public.app_confirmation_text_is_blank('x')`,
		`SELECT * FROM public.app_confirmation_issue(gen_random_uuid(), 'storage.visibility.make_public', gen_random_uuid(), 1, gen_random_uuid())`,
	}
	for _, role := range []string{"anon", "authenticated"} {
		for _, statement := range denied {
			scratchTx(t, pool, func(ctx context.Context, tx pgx.Tx) {
				if _, err := tx.Exec(ctx, `SET LOCAL ROLE `+role); err != nil {
					t.Fatal(err)
				}
				if _, err := tx.Exec(ctx, statement); !isPgCode(err, "42501") {
					t.Errorf("%s: %.70s: err = %v, want permission denied", role, statement, err)
				}
			})
		}
	}

	t.Run("no application role holds a privilege on the sequence, helper or trigger function", func(t *testing.T) {
		for _, role := range []string{"anon", "authenticated"} {
			var usage, sel, upd, helper, guard, resolver, issue, table bool
			if err := pool.QueryRow(ctx, `
				SELECT has_sequence_privilege($1, 'public.app_confirmable_operations_registry_id_seq', 'USAGE'),
				       has_sequence_privilege($1, 'public.app_confirmable_operations_registry_id_seq', 'SELECT'),
				       has_sequence_privilege($1, 'public.app_confirmable_operations_registry_id_seq', 'UPDATE'),
				       has_function_privilege($1, 'public.app_confirmation_text_is_blank(text)', 'EXECUTE'),
				       has_function_privilege($1, 'public.app_confirmable_operations_registry_id_guard()', 'EXECUTE'),
				       has_function_privilege($1, 'public.app_confirmation_resolve_dialog_copy(text, text, text, text)', 'EXECUTE'),
				       has_function_privilege($1, 'public.app_confirmation_issue(uuid, text, uuid, bigint, uuid)', 'EXECUTE'),
				       has_any_column_privilege($1, 'public.app_confirmable_operations', 'SELECT, INSERT, UPDATE, REFERENCES')`, role).
				Scan(&usage, &sel, &upd, &helper, &guard, &resolver, &issue, &table); err != nil {
				t.Fatal(err)
			}
			if usage || sel || upd || helper || guard || resolver || issue || table {
				t.Errorf("%s: usage=%v select=%v update=%v blank=%v guard=%v resolver=%v issue=%v table=%v", role, usage, sel, upd, helper, guard, resolver, issue, table)
			}
		}
	})
}

// A confirmation takes the challenge and the proof and nothing that is shown to the user.
func TestConfirmationEntryPointsTakeNoPresentationArgument(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	presentation := regexp.MustCompile(`(?i)label|title|copy|registry|description|dialog|present|display|text`)

	cases := []struct {
		signature string
		args      []string
	}{
		{"public.confirm_app_operation(uuid, text, text, uuid, bigint, text, uuid)",
			[]string{"p_challenge_id", "p_operation_kind", "p_target_type", "p_target_id", "p_expected_revision", "p_proof", "p_request_id"}},
		{"public.begin_d_storage_make_public(uuid, bigint, uuid)",
			[]string{"p_storage_object_id", "p_expected_revision", "p_request_id"}},
		{"public.make_d_storage_object_private(uuid, bigint, uuid)",
			[]string{"p_storage_object_id", "p_expected_revision", "p_request_id"}},
	}
	for _, c := range cases {
		var names []string
		if err := pool.QueryRow(ctx, `SELECT p.proargnames FROM pg_proc AS p WHERE p.oid = $1::REGPROCEDURE`, c.signature).Scan(&names); err != nil {
			t.Fatalf("%s: %v", c.signature, err)
		}
		if !slices.Equal(names, c.args) {
			t.Errorf("%s arguments = %v, want %v", c.signature, names, c.args)
		}
		for _, n := range names {
			if presentation.MatchString(n) {
				t.Errorf("%s takes a presentation-looking argument %q", c.signature, n)
			}
		}
	}
}
