// Package e2ereset implements the exact-staging-only destructive E2E reset:
// identity preflight, fixed audited SQL executed on the staging host over SSM,
// and emptying only the linked application bucket. It never accepts
// caller-supplied SQL, table names, hosts, or bucket identifiers, and it never
// mutates protected staging state (DBOS, queues, job status, JobResultBucket,
// Clerk, infrastructure).
package e2ereset

import (
	"crypto/sha256"
	_ "embed"
	"regexp"
	"sort"
	"strings"
)

// canonicalSQL is the single audited reset asset shared by local and staging
// cleanup. It is embedded so the Go binary cannot be pointed at a different
// statement at runtime.
//
//go:embed application_reset.sql
var canonicalSQL string

// CanonicalSQL returns the embedded audited reset SQL.
func CanonicalSQL() string { return canonicalSQL }

// CanonicalSQLDigest returns the SHA-256 of the embedded SQL for diagnostics
// without printing the SQL itself.
func CanonicalSQLDigest() [32]byte { return sha256.Sum256([]byte(canonicalSQL)) }

var truncateTablesRe = regexp.MustCompile(`(?is)TRUNCATE\s+TABLE\s+(.*?);`)
var lineCommentRe = regexp.MustCompile(`(?m)--.*$`)

// sqlWithoutComments returns the canonical SQL with -- line comments removed, so
// analysis sees only executable statements.
func sqlWithoutComments() string {
	return lineCommentRe.ReplaceAllString(canonicalSQL, "")
}

// ApplicationTables parses the embedded SQL and returns the explicit set of
// tables it truncates, in sorted order. Tests use this to prove local and
// staging share one table set and that no table outside it is ever a target.
func ApplicationTables() []string {
	m := truncateTablesRe.FindStringSubmatch(sqlWithoutComments())
	if m == nil {
		return nil
	}
	raw := m[1]
	parts := strings.Split(raw, ",")
	tables := make([]string, 0, len(parts))
	for _, p := range parts {
		t := strings.TrimSpace(p)
		if t != "" {
			tables = append(tables, t)
		}
	}
	sort.Strings(tables)
	return tables
}

// ContainsForbiddenClause reports whether the embedded SQL contains a clause
// that would broaden the reset beyond the audited boundary. Comments are
// ignored so documentation of the rules does not trip the check.
func ContainsForbiddenClause() bool {
	upper := strings.ToUpper(sqlWithoutComments())
	return strings.Contains(upper, "CASCADE") ||
		strings.Contains(upper, "RESTART IDENTITY") ||
		strings.Contains(upper, "DROP ") ||
		strings.Contains(upper, "DELETE FROM")
}
