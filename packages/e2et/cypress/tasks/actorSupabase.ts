import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getActorSupabaseJwt } from "./clerk.js";
import { isRecord } from "./narrow.js";

function requireSupabaseEnv(): { supabaseUrl: string; supabaseKey: string } {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL and SUPABASE_KEY are required");
  }
  return { supabaseUrl, supabaseKey };
}

export async function withUserSupabase<T>(
  identifier: string,
  run: (supabase: SupabaseClient) => Promise<T>,
): Promise<T> {
  const { supabaseUrl, supabaseKey } = requireSupabaseEnv();
  const supabase = createClient(supabaseUrl, supabaseKey, {
    accessToken: () => getActorSupabaseJwt(identifier),
  });
  return run(supabase);
}

export function firstStringField(data: unknown, field: string): string | undefined {
  if (!Array.isArray(data)) {
    return undefined;
  }
  const row: unknown = data[0];
  if (!isRecord(row)) {
    return undefined;
  }
  const value = row[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
