import { getSupabaseBrowserClient } from "@/utils/supabase/browserClient";
import type { APIRoute } from "astro";
import {
    viewRPCMap,
    type ViewMap,
} from "@/components/react/DDrvList/viewMap.ts";
import type { Database } from "@/utils/supabase/models";

export const POST: APIRoute = async function (context) {
    const { view } = context.params;

    if (!view || !(view in viewRPCMap)) {
        return new Response(
            JSON.stringify({
                message: `Invalid view for creation: ${view}. Expected one of: ${Object.keys(viewRPCMap).join(", ")}`,
            }),
            {
                status: 400,
                headers: { "Content-Type": "application/json" },
            },
        );
    }

    const client = getSupabaseBrowserClient(context);
    const rpcName = viewRPCMap[view as keyof ViewMap].create;
    const formData = await context.request.formData();
    const args = Object.fromEntries(
        formData.entries(),
    ) as Database["public"]["Functions"][typeof rpcName]["Args"];

    const { data, error } = await client.rpc(rpcName, args);

    if (error) {
        console.error(`Supabase RPC error in ${view}/new:`, error);
        return new Response(JSON.stringify({ message: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }

    if (rpcName === "create_ig_post") {
        const postId = Array.isArray(data)
            ? (data[0] as { post_id?: string } | undefined)?.post_id
            : undefined;
        if (postId) {
            await client.rpc("notify_ig_posts_view_for_post", {
                p_post_id: postId,
            });
        }
    }

    return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
};
