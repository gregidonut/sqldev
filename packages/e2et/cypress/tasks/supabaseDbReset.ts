import { runSqldev } from "./sqldevCli.js";

export async function supabaseDbReset(): Promise<null> {
  // --local never follows a linked remote project. --no-seed avoids the
  // gitignored seed.sql that config.toml enables but the repo does not ship.
  // The sqldev CLI injects the linked Supabase environment and runs from the
  // backend/supabase directory.
  await runSqldev(["supabase", "db", "reset", "--local", "--no-seed"]);
  return null;
}
