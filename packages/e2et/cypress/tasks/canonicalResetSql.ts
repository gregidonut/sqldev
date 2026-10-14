import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

/**
 * The single audited reset SQL asset, shared with the Go CLI so the local and
 * staging table lists cannot drift. The Go CLI injects SQLDEV_ROOT; we resolve
 * the exact expected path beneath it and verify it before use.
 */
const RELATIVE_PATH = join(
  "packages",
  "cli",
  "internal",
  "e2ereset",
  "application_reset.sql",
);

export function canonicalResetSqlPath(): string {
  const root = process.env.SQLDEV_ROOT;
  if (!root || !isAbsolute(root)) {
    throw new Error(
      "SQLDEV_ROOT is not an absolute path. Run Cypress through `sqldev cypress ...`.",
    );
  }
  return resolve(root, RELATIVE_PATH);
}

export function readCanonicalResetSql(): string {
  const path = canonicalResetSqlPath();
  const sql = readFileSync(path, "utf8");
  if (!sql.includes("TRUNCATE TABLE") || !sql.includes("BEGIN;")) {
    throw new Error(`Canonical reset SQL at ${path} is missing required statements`);
  }
  if (/\bCASCADE\b/i.test(stripSqlComments(sql))) {
    throw new Error("Canonical reset SQL unexpectedly contains CASCADE");
  }
  return sql;
}

/** Removes -- line comments so clause checks ignore documentation. */
export function stripSqlComments(sql: string): string {
  return sql.replace(/--.*$/gm, "");
}
