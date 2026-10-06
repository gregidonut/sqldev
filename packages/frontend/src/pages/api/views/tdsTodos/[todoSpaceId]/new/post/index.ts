import type { APIRoute } from "astro";
import { requireApiAuth } from "@/utils/clerk/requireAuth";
import { getSupabaseBrowserClient } from "@/utils/supabase/browserClient";
import type { Database } from "@/utils/supabase/models";

export const POST: APIRoute = async (context) => {
    const unauthorized = requireApiAuth(context);
    if (unauthorized) return unauthorized;

    const client = getSupabaseBrowserClient(context);

    const formData = await context.request.formData();

    const { data, error } = await client.rpc(
        "create_tds_todo",
        Object.fromEntries(
            formData,
        ) as Database["public"]["Functions"]["create_tds_todo"]["Args"],
    );

    if (error) {
        console.error("Supabase RPC error in tdsTodos/new/post:", error);
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
