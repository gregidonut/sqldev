import { createClient } from "@supabase/supabase-js";
import { getClerkClient, resolveClerkUserId } from "./clerk.js";

export interface CreateIgPostAsUserArgs {
  identifier: string;
  p_text_content: string;
  p_public?: boolean;
}

export interface CreateIgPostAsUserResult {
  post_id: string;
}

export async function createIgPostAsUser({
  identifier,
  p_text_content,
  p_public = true,
}: CreateIgPostAsUserArgs): Promise<CreateIgPostAsUserResult> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_KEY are required to create a post",
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

    const { data, error } = await supabase.rpc("create_ig_post", {
      p_text_content,
      p_public,
    });

    if (error) {
      throw new Error(`create_ig_post failed: ${error.message}`);
    }

    const rows = (data ?? []) as { post_id: string }[];
    const post_id = rows[0]?.post_id;
    if (!post_id) {
      throw new Error("create_ig_post returned no post_id");
    }

    await supabase.rpc("notify_ig_posts_view_for_post", {
      p_post_id: post_id,
    });

    return { post_id };
  } finally {
    await clerk.sessions.revokeSession(session.id);
  }
}
