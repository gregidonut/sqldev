import type { APIRoute } from "astro";
import { getSupabaseBrowserClient } from "@/utils/supabase/browserClient";
import type { Database } from "@/utils/supabase/models";

export const POST: APIRoute = async (context) => {
    const client = getSupabaseBrowserClient(context);

    const formData = await context.request.formData();

    const { data, error } = await client.rpc(
        "post_text",
        Object.fromEntries(
            formData,
        ) as Database["public"]["Functions"]["post_text"]["Args"],
    );
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
