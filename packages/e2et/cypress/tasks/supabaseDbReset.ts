import { fileURLToPath } from "node:url";
import { runSupabase } from "@sqldev/core/envBuilder";

const supabaseDir = fileURLToPath(
  new URL("../../../backend/supabase", import.meta.url),
);

export async function supabaseDbReset(): Promise<null> {
  await runSupabase(["db", "reset"], supabaseDir);
  return null;
}
