import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

describe("legacy test-user secret file", () => {
  test("cypress.env.json is not tracked (and no backup is tracked)", () => {
    const tracked = execFileSync(
      "git",
      ["-C", repoRoot, "ls-files", "packages/e2et/"],
      { encoding: "utf8" },
    );
    const offenders = tracked
      .split("\n")
      .filter((p) => /cypress\.env\.json/i.test(p));
    expect(offenders).toEqual([]);
  });

  test(".gitignore ignores the file and its backups", () => {
    const gitignore = readFileSync(join(repoRoot, ".gitignore"), "utf8");
    expect(gitignore).toContain("packages/e2et/cypress.env.json");
    expect(gitignore).toContain("packages/e2et/cypress.env.json.*");
  });
});
