package sqldb

// Regression guard for how the confirmation objects are declared in the migration history.
//
// The registry identity and the dialog copy are part of the migrations that DEFINE the
// objects (`20261101090100_create_app_confirmation_protocol.sql`,
// `20261101090200_create_d_storage_visibility_functions.sql`). A reader must never find a
// declaration in one file that a later file then alters. This test reads the authored
// migrations only (no database) and fails if an object is declared twice, redefined with
// CREATE OR REPLACE, altered or dropped outside the file that declares it, or if a file
// whose name suggests a separate registry-id migration appears.

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

const (
	protocolMigration   = "20261101090100_create_app_confirmation_protocol.sql"
	visibilityMigration = "20261101090200_create_d_storage_visibility_functions.sql"
)

type declared struct {
	kind string // FUNCTION, TABLE or SEQUENCE
	name string
	file string // the one migration that declares it
}

var confirmationObjects = []declared{
	{"TABLE", "app_confirmable_operations", protocolMigration},
	{"TABLE", "app_confirmation_challenges", protocolMigration},
	{"SEQUENCE", "app_confirmable_operations_registry_id_seq", protocolMigration},
	{"FUNCTION", "app_confirmation_text_is_blank", protocolMigration},
	{"FUNCTION", "app_confirmable_operations_registry_id_guard", protocolMigration},
	{"FUNCTION", "app_confirmation_issue", protocolMigration},
	{"FUNCTION", "app_confirmation_resolve_dialog_copy", protocolMigration},
	{"FUNCTION", "begin_d_storage_make_public", visibilityMigration},
}

var lineComment = regexp.MustCompile(`(?m)--.*$`)

// enableRLS is part of declaring a table (the policy-free, definer-only access model), so it
// is allowed in the declaring file. Any other ALTER TABLE is an alteration.
var enableRLS = regexp.MustCompile(`(?i)ALTER\s+TABLE\s+public\.\w+\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;`)

// stripComments removes SQL line comments so prose in a comment is never counted as DDL.
func stripComments(sql string) string { return lineComment.ReplaceAllString(sql, "") }

// ddlAgainst returns every statement-start in sql that creates, replaces, alters or drops
// the object, as a short label such as "CREATE FUNCTION" or "ALTER TABLE".
func ddlAgainst(sql string, o declared) []string {
	name := regexp.QuoteMeta(o.name)
	patterns := []struct{ label, re string }{
		{"CREATE OR REPLACE " + o.kind, `(?i)\bCREATE\s+OR\s+REPLACE\s+` + o.kind + `\s+(?:public\.)?` + name + `\b`},
		{"CREATE " + o.kind, `(?i)\bCREATE\s+` + o.kind + `\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?` + name + `\b`},
		{"DROP " + o.kind, `(?i)\bDROP\s+` + o.kind + `\s+(?:IF\s+EXISTS\s+)?(?:public\.)?` + name + `\b`},
		{"ALTER " + o.kind, `(?i)\bALTER\s+` + o.kind + `\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?(?:public\.)?` + name + `\b`},
	}
	var found []string
	for _, p := range patterns {
		matches := regexp.MustCompile(p.re).FindAllString(sql, -1)
		for range matches {
			found = append(found, p.label)
		}
	}
	// "CREATE OR REPLACE X" is matched by both the first and second pattern; keep it once.
	replace := 0
	for _, l := range found {
		if strings.HasPrefix(l, "CREATE OR REPLACE") {
			replace++
		}
	}
	if replace > 0 {
		out := found[:0:0]
		skip := replace
		for _, l := range found {
			if l == "CREATE "+o.kind && skip > 0 {
				skip--
				continue
			}
			out = append(out, l)
		}
		found = out
	}
	return found
}

// violations lists every way the files break the declare-once rule.
func violations(files map[string]string) []string {
	var out []string
	names := make([]string, 0, len(files))
	for n := range files {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, o := range confirmationObjects {
		for _, n := range names {
			sql := stripComments(files[n])
			if n == o.file {
				sql = enableRLS.ReplaceAllString(sql, "")
			}
			ddl := ddlAgainst(sql, o)
			if n == o.file {
				creates := 0
				for _, l := range ddl {
					switch l {
					case "CREATE " + o.kind:
						creates++
					case "ALTER SEQUENCE":
						// The one allowed alteration in the declaring file: OWNED BY the column.
					default:
						out = append(out, n+": "+o.name+": "+l+" in its declaring file")
					}
				}
				if creates != 1 {
					out = append(out, n+": "+o.name+": declared "+string(rune('0'+creates))+" times, want exactly once")
				}
				continue
			}
			for _, l := range ddl {
				out = append(out, n+": "+o.name+": "+l+" outside its declaring file "+o.file)
			}
		}
	}
	return out
}

func readMigrations(t *testing.T) map[string]string {
	t.Helper()
	dir := filepath.Join("..", "..", "..", "backend", "supabase", "migrations")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	files := map[string]string{}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		files[e.Name()] = string(raw)
	}
	return files
}

func TestConfirmationObjectsAreDeclaredOnceAndNeverAlteredElsewhere(t *testing.T) {
	files := readMigrations(t)
	for _, name := range []string{protocolMigration, visibilityMigration} {
		if _, ok := files[name]; !ok {
			t.Fatalf("migration %s is missing", name)
		}
	}
	if v := violations(files); len(v) > 0 {
		t.Fatalf("confirmation objects must be declared once, in the migration that defines them:\n  %s", strings.Join(v, "\n  "))
	}
}

func TestNoSeparateRegistryIdentityMigrationExists(t *testing.T) {
	for name := range readMigrations(t) {
		lower := strings.ToLower(name)
		if strings.Contains(lower, "registry_id") || strings.Contains(lower, "dialog_copy") {
			t.Errorf("%s: registry identity and dialog copy belong in %s, not in a separate migration", name, protocolMigration)
		}
	}
}

func TestRegistrySeedLetsTheSequenceAssignTheFirstIdentifier(t *testing.T) {
	sql := stripComments(readMigrations(t)[protocolMigration])
	insert := regexp.MustCompile(`(?is)INSERT\s+INTO\s+public\.app_confirmable_operations\s*\((.*?)\)\s*VALUES`).FindStringSubmatch(sql)
	if insert == nil {
		t.Fatal("the registry seed INSERT was not found")
	}
	if strings.Contains(insert[1], "registry_id") {
		t.Errorf("the seed names registry_id (%s); the sequence must assign it so the first value is 1000", insert[1])
	}
	for _, forbidden := range []string{"setval(", "restart", "registry_id = DEFAULT"} {
		if strings.Contains(strings.ToLower(sql), strings.ToLower(forbidden)) {
			t.Errorf("the protocol migration contains %q; gaps are normal and the first value comes from the sequence start", forbidden)
		}
	}
	for _, want := range []string{"START WITH 1000", "MINVALUE 1000", "NO CYCLE", "OWNED BY public.app_confirmable_operations.registry_id"} {
		if !strings.Contains(sql, want) {
			t.Errorf("the protocol migration lacks %q", want)
		}
	}
}

func TestConfirmationMigrationsCarryNoTransactionControl(t *testing.T) {
	// The other migrations are plain statements; a BEGIN/COMMIT wrapper was only needed
	// by the removed alteration-style file (LOCK TABLE).
	re := regexp.MustCompile(`(?mi)^\s*(BEGIN|COMMIT)\s*;`)
	for _, name := range []string{protocolMigration, visibilityMigration} {
		if re.MatchString(stripComments(readMigrations(t)[name])) {
			t.Errorf("%s has transaction control; keep it a plain migration", name)
		}
		if strings.Contains(strings.ToUpper(stripComments(readMigrations(t)[name])), "LOCK TABLE") {
			t.Errorf("%s locks a table; that belongs to an alteration, not a definition", name)
		}
	}
}

// The detector must fire, or the guard above would pass vacuously.
func TestViolationDetectorCatchesAlterations(t *testing.T) {
	good := map[string]string{
		protocolMigration: `
CREATE SEQUENCE public.app_confirmable_operations_registry_id_seq START WITH 1000;
CREATE TABLE public.app_confirmable_operations (operation_kind TEXT);
ALTER SEQUENCE public.app_confirmable_operations_registry_id_seq OWNED BY public.app_confirmable_operations.registry_id;
CREATE TABLE public.app_confirmation_challenges (challenge_id UUID);
CREATE FUNCTION public.app_confirmation_text_is_blank(p TEXT) RETURNS BOOLEAN AS $$ SELECT true $$;
CREATE FUNCTION public.app_confirmable_operations_registry_id_guard() RETURNS TRIGGER AS $$ $$;
CREATE FUNCTION public.app_confirmation_issue(a UUID) RETURNS INT AS $$ $$;
CREATE FUNCTION public.app_confirmation_resolve_dialog_copy(a TEXT) RETURNS JSONB AS $$ $$;
-- ALTER TABLE public.app_confirmable_operations ADD COLUMN ignored_in_a_comment TEXT;`,
		visibilityMigration: `CREATE FUNCTION public.begin_d_storage_make_public(a UUID) RETURNS JSONB AS $$ $$;`,
	}
	if v := violations(good); len(v) != 0 {
		t.Fatalf("a clean history was flagged: %v", v)
	}
	clone := func(extra map[string]string) map[string]string {
		out := map[string]string{}
		for k, v := range good {
			out[k] = v
		}
		for k, v := range extra {
			out[k] = v
		}
		return out
	}
	bad := map[string]map[string]string{
		"alter the table in a later file": {"20261102090100_x.sql": `ALTER TABLE public.app_confirmable_operations ADD COLUMN registry_id BIGINT;`},
		"drop and recreate the function":  {"20261102090100_x.sql": `DROP FUNCTION public.app_confirmation_issue(UUID); CREATE FUNCTION public.app_confirmation_issue(a UUID) RETURNS INT AS $$ $$;`},
		"replace the function":            {"20261102090100_x.sql": `CREATE OR REPLACE FUNCTION public.begin_d_storage_make_public(a UUID) RETURNS JSONB AS $$ $$;`},
		"alter the sequence elsewhere":    {"20261102090100_x.sql": `ALTER SEQUENCE public.app_confirmable_operations_registry_id_seq RESTART WITH 5;`},
		"declare the table twice":         {protocolMigration: good[protocolMigration] + "\nCREATE TABLE public.app_confirmable_operations (x INT);"},
		"replace in the declaring file":   {visibilityMigration: `CREATE FUNCTION public.begin_d_storage_make_public(a UUID) RETURNS JSONB AS $$ $$; CREATE OR REPLACE FUNCTION public.begin_d_storage_make_public(a UUID) RETURNS JSONB AS $$ $$;`},
		"alter the table in its own file": {protocolMigration: good[protocolMigration] + "\nALTER TABLE public.app_confirmable_operations ADD COLUMN x INT;"},
		"never declared":                  {visibilityMigration: `SELECT 1;`},
	}
	for name, extra := range bad {
		if v := violations(clone(extra)); len(v) == 0 {
			t.Errorf("%s: the violation was not detected", name)
		}
	}
}
