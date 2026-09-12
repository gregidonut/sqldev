import { createClient } from "@supabase/supabase-js";
import { getClerkClient, resolveClerkUserId } from "./clerk.js";

export interface CreateTdsTodoSpaceAsUserArgs {
  identifier: string;
  p_name: string;
  p_public?: boolean;
}

export interface CreateTdsTodoSpaceAsUserResult {
  todo_space_id: string;
}

export async function createTdsTodoSpaceAsUser({
  identifier,
  p_name,
  p_public = false,
}: CreateTdsTodoSpaceAsUserArgs): Promise<CreateTdsTodoSpaceAsUserResult> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_KEY are required to create a todo space",
    );
  }

  const clerk = getClerkClient();
  const userId = await resolveClerkUserId(clerk, identifier);
  const session = await clerk.sessions.createSession({ userId });

  try {
    const token = await clerk.sessions.getToken(session.id, "supabase");
    const jwt = typeof token === "string" ? token : token.jwt;
    if (!jwt) {
      throw new Error("Clerk supabase JWT was empty");
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      async accessToken() {
        return jwt;
      },
    });

    const { data, error } = await supabase.rpc("create_tds_todo_space", {
      p_name,
      p_public,
    });

    if (error) {
      throw new Error(`create_tds_todo_space failed: ${error.message}`);
    }

    const rows = (data ?? []) as { todo_space_id: string }[];
    const todo_space_id = rows[0]?.todo_space_id;
    if (!todo_space_id) {
      throw new Error("create_tds_todo_space returned no todo_space_id");
    }

    return { todo_space_id };
  } finally {
    await clerk.sessions.revokeSession(session.id);
  }
}
