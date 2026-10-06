import type { APIRoute } from "astro";
import { requireApiAuth } from "@/utils/clerk/requireAuth";
import { getSupabaseBrowserClient } from "@/utils/supabase/browserClient";
import type { Database } from "@/utils/supabase/models";

export const PATCH: APIRoute = async (context) => {
    const unauthorized = requireApiAuth(context);
    if (unauthorized) return unauthorized;

    const client = getSupabaseBrowserClient(context);

    const formData = await context.request.formData();
    const p_todo_item_ids = formData.getAll("p_todo_item_ids") as string[];
    const p_new_parent_id = formData.get("p_new_parent_id") as string;

    const { data, error } = await client.rpc("move_tds_todo_items", {
        p_todo_item_ids,
        p_new_parent_id,
    } as Database["public"]["Functions"]["move_tds_todo_items"]["Args"]);

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
