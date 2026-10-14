import { runSqldev } from "./sqldevCli.js";

/**
 * Runs the coordinated, exact-staging-only destructive reset through the Go
 * CLI. `--preflight` validates identities and reachability without mutating.
 * The CLI itself enforces exact-staging authorization and never exposes
 * database credentials to this process.
 */
export async function stagingResetPreflight(): Promise<void> {
  await runSqldev(["--stage", "staging", "e2e", "reset", "--preflight"]);
}

export async function stagingReset(): Promise<void> {
  await runSqldev(["--stage", "staging", "e2e", "reset", "--yes"]);
}
