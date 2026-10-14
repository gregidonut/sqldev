import { runSqldev } from "./sqldevCli.js";
import { assertLocalDevStage } from "./localDbReset.js";

export async function supabaseDbReset(): Promise<null> {
  // Defense in depth: this is a local-only Supabase operation. Even if a future
  // caller bypasses suite initialization, refuse any non-local stage here.
  assertLocalDevStage();
  // --local never follows a linked remote project. --no-seed avoids the
  // gitignored seed.sql that config.toml enables but the repo does not ship.
  // The sqldev CLI injects the linked Supabase environment and runs from the
  // backend/supabase directory.
  await runSqldev(["supabase", "db", "reset", "--local", "--no-seed"]);
  return null;
}
