import { firstStringField, withUserSupabase } from "./actorSupabase.js";

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
  return withUserSupabase(identifier, async (supabase) => {
    const { data, error } = await supabase.rpc("create_ig_post", {
      p_text_content,
      p_public,
    });

    if (error) {
      throw new Error(`create_ig_post failed: ${error.message}`);
    }

    const post_id = firstStringField(data, "post_id");
    if (!post_id) {
      throw new Error("create_ig_post returned no post_id");
    }

    await supabase.rpc("notify_ig_posts_view_for_post", {
      p_post_id: post_id,
    });

    return { post_id };
  });
}
