import { fileURLToPath } from "node:url";
import { runSupabase } from "@sqldev/core/envBuilder";

const supabaseDir = fileURLToPath(
  new URL("../../../backend/supabase", import.meta.url),
);

export async function supabaseDbReset(): Promise<null> {
  // --local never follows a linked remote project. --no-seed avoids the
  // gitignored seed.sql that config.toml enables but the repo does not ship.
  // Supabase CLI 2.117 supports both flags (`supabase db reset --help`).
  await runSupabase(["db", "reset", "--local", "--no-seed"], supabaseDir);
  return null;
}
