//go:build integration

package sqldb

// Shared fixtures for the confirmation-dialog-copy integration tests.
//
// Safety rules these helpers enforce for every test that touches the registry:
//
//   - Registry and challenge writes happen inside a transaction that is always
//     rolled back (scratchTx). Nothing a test mutates in the registry is committed.
//   - The real registry sequence is never advanced. A test that inserts registry rows
//     swaps the column DEFAULT, inside the rolled-back transaction, to a TEMP sequence
//     created with the real sequence's options and state (useScratchRegistrySequence),
//     so allocation behaviour is exercised without consuming a real value.
//   - Fixtures that must be committed (actors, storage objects, a first challenge) are
//     created through the shared helpers and removed by cleanupActor.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"slices"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	copyFeature    = "confirmation-dialog-copy"
	makePublicKind = "storage.visibility.make_public"
	targetToken    = "{{targetLabel}}"
	maxRegistryID  = int64(9223372036854775807)

	registrySequence    = "public.app_confirmable_operations_registry_id_seq"
	scratchSequenceName = "sqldev_scratch_registry_id_seq"
)

// copyProperty runs fn as a subtest whose name carries the tag the validation script
// collects: "Feature: confirmation-dialog-copy, Property N: <title>".
func copyProperty(t *testing.T, n int, title string, fn func(t *testing.T)) {
	t.Helper()
	t.Run(fmt.Sprintf("Feature: %s, Property %d: %s", copyFeature, n, title), fn)
}

// sqlRunner is satisfied by both *pgxpool.Pool and pgx.Tx.
type sqlRunner interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

// registryRow is one app_confirmable_operations row.
type registryRow struct {
	OperationKind string
	TargetType    string
	RegistryID    int64
	Title         string
	Description   string
	ConfirmLabel  string
}

func readRegistry(ctx context.Context, q sqlRunner) ([]registryRow, error) {
	rows, err := q.Query(ctx, `
		SELECT operation_kind, target_type, registry_id, dialog_title_template, dialog_description, dialog_confirm_label
		  FROM public.app_confirmable_operations ORDER BY registry_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []registryRow
	for rows.Next() {
		var r registryRow
		if err := rows.Scan(&r.OperationKind, &r.TargetType, &r.RegistryID, &r.Title, &r.Description, &r.ConfirmLabel); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// makePublicRegistry returns the real registry row for the only registered operation.
func makePublicRegistry(t *testing.T, q sqlRunner) registryRow {
	t.Helper()
	rows, err := readRegistry(context.Background(), q)
	if err != nil {
		t.Fatalf("read registry: %v", err)
	}
	for _, r := range rows {
		if r.OperationKind == makePublicKind {
			return r
		}
	}
	t.Fatalf("registry has no %s row: %+v", makePublicKind, rows)
	return registryRow{}
}

// isBlankRune spells out the Unicode White_Space class the migration, the Go decoder and
// the TypeScript decoder share. It is deliberately not strings.TrimSpace.
func isBlankRune(r rune) bool {
	switch {
	case r >= 0x09 && r <= 0x0D, r == 0x20, r == 0x85, r == 0xA0, r == 0x1680,
		r >= 0x2000 && r <= 0x200A, r == 0x2028, r == 0x2029, r == 0x202F, r == 0x205F, r == 0x3000:
		return true
	}
	return false
}

func isBlankText(s string) bool {
	for _, r := range s {
		if !isBlankRune(r) {
			return false
		}
	}
	return true
}

// blankRunes lists one rune per member range of the blank class, for generators.
var blankRunes = []rune{0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0x85, 0xA0, 0x1680, 0x2000, 0x2005, 0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000}

func validTemplate(s string) bool {
	if isBlankText(s) || strings.Count(s, targetToken) != 1 {
		return false
	}
	rest := strings.ReplaceAll(s, targetToken, "")
	return !strings.Contains(rest, "{{") && !strings.Contains(rest, "}}")
}

func validRegistryCopy(r registryRow) bool {
	return validTemplate(r.Title) &&
		!isBlankText(r.Description) && utf8.RuneCountInString(r.Description) <= 2000 &&
		!isBlankText(r.ConfirmLabel) && utf8.RuneCountInString(r.ConfirmLabel) <= 80
}

// textPool holds fragments that stress literal handling: quotes, markup, backslashes,
// ampersands, the template token itself, astral code points, combining marks, right-to-left
// text, invisible characters and format-string look-alikes. It never holds a NUL or a lone
// surrogate: PostgreSQL rejects the first and Go's json turns the second into U+FFFD.
var textPool = []string{
	"a", "report", ".pdf", "Q3 results", "“", "”", `"`, "'", "`", "<b>bold</b>",
	"<script>alert(1)</script>", "<img src=x onerror=alert(1)>", `\`, `\n`, `\\`, "&", "&amp;", "&#x27;",
	"{{targetLabel}}", "{{", "}}", "{{x}}", "$1", "%s", "%", "100%", "😀", "𝒳", "a\u0301", "e\u0301\u0302",
	"שלום", "مرحبا", "\u202e", "\u200f", "\u00ad", "\ufeff", "日本語", "ß", "Ω", "javascript:alert(1)",
	"https://example.test/x?a=b&c=d", `style="x"`, "../../etc", " ", "-", "_", "1",
}

func hasBrace(s string) bool { return strings.ContainsAny(s, "{}") }

// genText returns a non-blank string of exactly n code points built from textPool. With
// noBraces it avoids template delimiters so the text is safe inside a title template.
func genText(rng *rand.Rand, n int, noBraces bool) string {
	if n <= 0 {
		return ""
	}
	var b []rune
	for len(b) < n {
		piece := textPool[rng.Intn(len(textPool))]
		if noBraces && hasBrace(piece) {
			continue
		}
		b = append(b, []rune(piece)...)
	}
	b = b[:n]
	if isBlankText(string(b)) {
		b[0] = 'x'
	}
	return string(b)
}

// genBounded returns non-blank text of 1..max code points, hitting both bounds often.
func genBounded(rng *rand.Rand, max int, noBraces bool) string {
	switch rng.Intn(6) {
	case 0:
		return genText(rng, max, noBraces)
	case 1:
		return genText(rng, 1, noBraces)
	}
	limit := max
	if limit > 120 {
		limit = 120
	}
	return genText(rng, 1+rng.Intn(limit), noBraces)
}

// genLabel returns a committed file name. One case in eight is exactly 185 code points,
// the longest name whose resolved title still fits the 200 code point limit.
func genLabel(rng *rand.Rand, template string) string {
	max := 200 - (utf8.RuneCountInString(template) - utf8.RuneCountInString(targetToken))
	if rng.Intn(8) == 0 {
		return genText(rng, max, false)
	}
	return genText(rng, 1+rng.Intn(40), false)
}

// genTemplate returns a valid title template: one token and no other delimiters.
func genTemplate(rng *rand.Rand) string {
	return genText(rng, rng.Intn(30), true) + targetToken + genText(rng, rng.Intn(30), true)
}

var kindLetters = []rune("abcdefghijklmnopqrstuvwxyz")

// genKind returns an operation kind matching ^[a-z]+(\.[a-z_]+)+$ that is not in used.
func genKind(rng *rand.Rand, used map[string]bool) string {
	for {
		b := make([]rune, 8)
		for i := range b {
			b[i] = kindLetters[rng.Intn(len(kindLetters))]
		}
		kind := "it.scratch_" + string(b)
		if !used[kind] {
			used[kind] = true
			return kind
		}
	}
}

// scratchTx runs fn in a transaction that is always rolled back.
func scratchTx(t *testing.T, pool *pgxpool.Pool, fn func(ctx context.Context, tx pgx.Tx)) {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin scratch transaction: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	// A registry DDL lock must never hang the suite if another session holds the table.
	if _, err := tx.Exec(ctx, `SET LOCAL lock_timeout = '20s'`); err != nil {
		t.Fatalf("set lock_timeout: %v", err)
	}
	fn(ctx, tx)
}

// tryTx runs sql inside a savepoint. A failure rolls the savepoint back and is returned;
// success keeps the effect (until the surrounding transaction rolls back).
func tryTx(ctx context.Context, tx pgx.Tx, sql string, args ...any) error {
	if _, err := tx.Exec(ctx, `SAVEPOINT try_sp`); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, sql, args...)
	if err != nil {
		if _, rerr := tx.Exec(ctx, `ROLLBACK TO SAVEPOINT try_sp`); rerr != nil {
			return rerr
		}
	}
	if _, rerr := tx.Exec(ctx, `RELEASE SAVEPOINT try_sp`); rerr != nil {
		return rerr
	}
	return err
}

// useScratchRegistrySequence points the registry column DEFAULT at a TEMP sequence that
// has the real sequence's options and state, and returns the value it will hand out next.
// The DDL and the sequence vanish when the transaction rolls back, and the real sequence
// is only read, never advanced.
func useScratchRegistrySequence(ctx context.Context, tx pgx.Tx) (int64, error) {
	var (
		minV, maxV, inc, cache int64
		cycle                  bool
	)
	if err := tx.QueryRow(ctx, `
		SELECT min_value, max_value, increment_by, cache_size, cycle
		  FROM pg_sequences
		 WHERE schemaname = 'public' AND sequencename = 'app_confirmable_operations_registry_id_seq'`).
		Scan(&minV, &maxV, &inc, &cache, &cycle); err != nil {
		return 0, fmt.Errorf("read sequence options: %w", err)
	}
	var (
		last   int64
		called bool
	)
	if err := tx.QueryRow(ctx, `SELECT last_value, is_called FROM `+registrySequence).Scan(&last, &called); err != nil {
		return 0, fmt.Errorf("read sequence state: %w", err)
	}
	cycleSQL := "NO CYCLE"
	if cycle {
		cycleSQL = "CYCLE"
	}
	if _, err := tx.Exec(ctx, fmt.Sprintf(
		`CREATE TEMP SEQUENCE %s AS BIGINT START WITH %d INCREMENT BY %d MINVALUE %d MAXVALUE %d CACHE %d %s`,
		scratchSequenceName, minV, inc, minV, maxV, cache, cycleSQL)); err != nil {
		return 0, fmt.Errorf("create scratch sequence: %w", err)
	}
	if _, err := tx.Exec(ctx, `SELECT setval('pg_temp.`+scratchSequenceName+`', $1, $2)`, last, called); err != nil {
		return 0, fmt.Errorf("copy sequence state: %w", err)
	}
	if _, err := tx.Exec(ctx, `ALTER TABLE public.app_confirmable_operations
		ALTER COLUMN registry_id SET DEFAULT nextval('pg_temp.`+scratchSequenceName+`'::REGCLASS)`); err != nil {
		return 0, fmt.Errorf("swap column default: %w", err)
	}
	if called {
		return last + inc, nil
	}
	return last, nil
}

// insertRegistryRow inserts one registry row that omits registry_id, inside a savepoint.
func insertRegistryRow(ctx context.Context, tx pgx.Tx, kind, template, description, confirm string) (int64, error) {
	if _, err := tx.Exec(ctx, `SAVEPOINT insert_sp`); err != nil {
		return 0, err
	}
	var id int64
	err := tx.QueryRow(ctx, `
		INSERT INTO public.app_confirmable_operations
		  (operation_kind, target_type, validity, dialog_title_template, dialog_description, dialog_confirm_label)
		VALUES ($1, 'storage_object', INTERVAL '5 minutes', $2, $3, $4) RETURNING registry_id`,
		kind, template, description, confirm).Scan(&id)
	if err != nil {
		if _, rerr := tx.Exec(ctx, `ROLLBACK TO SAVEPOINT insert_sp`); rerr != nil {
			return 0, rerr
		}
	}
	if _, rerr := tx.Exec(ctx, `RELEASE SAVEPOINT insert_sp`); rerr != nil {
		return 0, rerr
	}
	return id, err
}

// registryShape is the part of the registry that must be identical before and after a
// property run: its rows, the real sequence's state, and the keys that bind challenges.
type registryShape struct {
	Rows       []registryRow
	SeqLast    int64
	SeqCalled  bool
	DefaultSQL string
	PrimaryKey string
	ForeignKey string
}

func snapshotRegistry(ctx context.Context, q sqlRunner) (registryShape, error) {
	var s registryShape
	var err error
	if s.Rows, err = readRegistry(ctx, q); err != nil {
		return s, err
	}
	if err = q.QueryRow(ctx, `SELECT last_value, is_called FROM `+registrySequence).Scan(&s.SeqLast, &s.SeqCalled); err != nil {
		return s, err
	}
	if err = q.QueryRow(ctx, `
		SELECT pg_get_expr(d.adbin, d.adrelid)
		  FROM pg_attrdef AS d
		  JOIN pg_attribute AS a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
		 WHERE d.adrelid = 'public.app_confirmable_operations'::REGCLASS AND a.attname = 'registry_id'`).Scan(&s.DefaultSQL); err != nil {
		return s, err
	}
	if err = q.QueryRow(ctx, `
		SELECT pg_get_constraintdef(oid) FROM pg_constraint
		 WHERE conrelid = 'public.app_confirmable_operations'::REGCLASS AND contype = 'p'`).Scan(&s.PrimaryKey); err != nil {
		return s, err
	}
	err = q.QueryRow(ctx, `
		SELECT pg_get_constraintdef(oid) FROM pg_constraint
		 WHERE conrelid = 'public.app_confirmation_challenges'::REGCLASS AND contype = 'f'
		   AND confrelid = 'public.app_confirmable_operations'::REGCLASS`).Scan(&s.ForeignKey)
	return s, err
}

// callJSONClaims is callJSON with extra JWT claims. The extra claims model a hostile client
// that tries to supply a label, registry identifier or dialog copy: the database function
// has no such input, so they must change nothing.
func callJSONClaims(ctx context.Context, pool *pgxpool.Pool, sub string, extra map[string]any, call string, args ...any) (map[string]any, error) {
	var out map[string]any
	err := asActorClaims(ctx, pool, sub, extra, func(tx pgx.Tx) error {
		var raw string
		if err := tx.QueryRow(ctx, "SELECT "+call+"::text", args...).Scan(&raw); err != nil {
			return err
		}
		return json.Unmarshal([]byte(raw), &out)
	})
	return out, err
}

func claimsJSON(sub string, extra map[string]any) string {
	claims := map[string]any{}
	for k, v := range extra {
		claims[k] = v
	}
	claims["sub"] = sub
	claims["role"] = "authenticated"
	raw, _ := json.Marshal(claims)
	return string(raw)
}

func asActorClaims(ctx context.Context, pool *pgxpool.Pool, sub string, extra map[string]any, fn func(tx pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, `SELECT set_config('request.jwt.claims', $1, true)`, claimsJSON(sub, extra)); err != nil {
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

// callInTx runs `SELECT <call>::text` as the actor inside an existing (scratch) transaction.
// A failure rolls back to a savepoint, which also undoes the role switch, so the caller
// can keep inspecting the transaction afterwards.
func callInTx(ctx context.Context, tx pgx.Tx, sub string, extra map[string]any, call string, args ...any) (map[string]any, error) {
	if _, err := tx.Exec(ctx, `SAVEPOINT call_sp`); err != nil {
		return nil, err
	}
	var out map[string]any
	err := func() error {
		if _, err := tx.Exec(ctx, `SELECT set_config('request.jwt.claims', $1, true)`, claimsJSON(sub, extra)); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `SET LOCAL ROLE authenticated`); err != nil {
			return err
		}
		var raw string
		if err := tx.QueryRow(ctx, "SELECT "+call+"::text", args...).Scan(&raw); err != nil {
			return err
		}
		return json.Unmarshal([]byte(raw), &out)
	}()
	if err != nil {
		if _, rerr := tx.Exec(ctx, `ROLLBACK TO SAVEPOINT call_sp`); rerr != nil {
			return nil, rerr
		}
		tx.Exec(ctx, `RELEASE SAVEPOINT call_sp`) //nolint:errcheck
		return nil, err
	}
	if _, rerr := tx.Exec(ctx, `RESET ROLE`); rerr != nil {
		return nil, rerr
	}
	if _, rerr := tx.Exec(ctx, `RELEASE SAVEPOINT call_sp`); rerr != nil {
		return nil, rerr
	}
	return out, nil
}

// renameObject rewrites the committed file name of an object's data row without firing the
// data triggers (the insert trigger posts to an unreachable notify URL).
func renameObject(t *testing.T, pool *pgxpool.Pool, objectID uuid.UUID, name string) {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, `SET LOCAL session_replication_role = replica`); err != nil {
		t.Fatalf("disable triggers: %v", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE public.d_storage_object_data SET file_name = $2 WHERE storage_object_id = $1`, objectID, name); err != nil {
		t.Fatalf("rename: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
}

// createObjectNamed creates a committed private object whose committed file name is name.
func createObjectNamed(t *testing.T, pool *pgxpool.Pool, owner actor, name string) uuid.UUID {
	t.Helper()
	objectID := createObject(t, pool, owner)
	renameObject(t, pool, objectID, name)
	return objectID
}

// expectedDialogCopy is the oracle: the registry copy with the committed name substituted
// once, literally.
func expectedDialogCopy(reg registryRow, name string) map[string]any {
	return map[string]any{
		"title":        strings.ReplaceAll(reg.Title, targetToken, name),
		"description":  reg.Description,
		"confirmLabel": reg.ConfirmLabel,
	}
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	return keys
}

// disclosesCopy reports whether a result carries a registry identity or dialog copy, either
// as a key or as the registry's description or confirm label anywhere in its JSON.
func disclosesCopy(result map[string]any, reg registryRow) bool {
	if _, ok := result["registryId"]; ok {
		return true
	}
	if _, ok := result["dialogCopy"]; ok {
		return true
	}
	raw, _ := json.Marshal(result)
	text := string(raw)
	for _, needle := range []string{reg.Description, reg.ConfirmLabel} {
		escaped, _ := json.Marshal(needle)
		if strings.Contains(text, string(escaped[1:len(escaped)-1])) {
			return true
		}
	}
	return false
}

// challengeSnapshot is every challenge row of an object, for before/after comparison.
type challengeSnapshot struct {
	ID    uuid.UUID
	State string
}

func challengeSnapshots(ctx context.Context, q sqlRunner, objectID uuid.UUID) ([]challengeSnapshot, error) {
	rows, err := q.Query(ctx, `SELECT challenge_id, state::text FROM public.app_confirmation_challenges
		WHERE target_id = $1 ORDER BY created_at, challenge_id`, objectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []challengeSnapshot
	for rows.Next() {
		var s challengeSnapshot
		if err := rows.Scan(&s.ID, &s.State); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func configVersions(ctx context.Context, q sqlRunner, objectID uuid.UUID) ([]int64, error) {
	rows, err := q.Query(ctx, `SELECT config_version FROM public.d_storage_object_config WHERE storage_object_id = $1 ORDER BY config_version`, objectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var v int64
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// pgErrorOf returns the PostgreSQL error inside err, or nil.
func pgErrorOf(err error) *pgconn.PgError {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr
	}
	return nil
}
