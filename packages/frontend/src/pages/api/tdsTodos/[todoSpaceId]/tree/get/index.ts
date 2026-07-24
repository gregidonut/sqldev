import { getSupabaseBrowserClient } from "@/utils/supabase/browserClient";
import type { APIRoute } from "astro";

export const GET: APIRoute = async function (context) {
    const client = getSupabaseBrowserClient(context);

    const { todoSpaceId } = context.params;
    const { data, error } = await client.rpc("get_tds_todos_tree", {
        p_todo_space_id: todoSpaceId!,
    });

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
