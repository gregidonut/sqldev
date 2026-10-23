import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getActorSupabaseJwt } from "./clerk.js";
import { LOCAL_SUPABASE_URL } from "./localSupabase.js";
import { isRecord } from "./narrow.js";

function requireSupabaseKey(): string {
  const supabaseKey = process.env.SUPABASE_KEY;
  if (!supabaseKey) {
    throw new Error("SUPABASE_KEY is required");
  }
  return supabaseKey;
}

export async function withUserSupabase<T>(
  identifier: string,
  run: (supabase: SupabaseClient) => Promise<T>,
): Promise<T> {
  const supabase = createClient(LOCAL_SUPABASE_URL, requireSupabaseKey(), {
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
