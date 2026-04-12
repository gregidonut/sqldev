import { getSupabaseBrowserClient } from "@/utils/supabase/browserClient";
import type { APIRoute } from "astro";

export const GET: APIRoute = async function (context) {
    const { igPostId } = context.params;

    if (!igPostId) {
        return new Response(
            JSON.stringify({ message: "Post ID is required" }),
            {
                status: 400,
                headers: { "Content-Type": "application/json" },
            },
        );
    }

    const client = getSupabaseBrowserClient(context);

    const { data, error } = await client
        .from("ig_posts_view")
        .select("*")
        .eq("post_id", igPostId)
        .single();

    if (error) {
        return new Response(JSON.stringify({ message: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
};
