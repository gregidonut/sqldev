import { getSupabaseBrowserClient } from "@/utils/supabase/browserClient";
import type { APIRoute } from "astro";

export const GET: APIRoute = async function (context) {
    const client = getSupabaseBrowserClient(context);

    const { data, error } = await client
        .from("tds_todos_tree_view")
        .select("*");

    if (error) {
        return new Response(JSON.stringify({ message: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify(data[0].jsonb_agg), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
};
