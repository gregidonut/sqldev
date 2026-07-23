import { getSupabaseBrowserClient } from "@/utils/supabase/browserClient";
import type { APIRoute } from "astro";
import {
    viewRPCMap,
    type ViewMap,
} from "@/components/react/DDrvList/viewMap.ts";
import type { Database } from "@/utils/supabase/models";

export const PATCH: APIRoute = async function (context) {
    const { view } = context.params;

    if (!view || !(view in viewRPCMap)) {
        return new Response(
            JSON.stringify({
                message: `Invalid view for update: ${view}. Expected one of: ${Object.keys(viewRPCMap).join(", ")}`,
            }),
            {
                status: 400,
                headers: { "Content-Type": "application/json" },
            },
        );
    }

    const client = getSupabaseBrowserClient(context);
    const rpcName = viewRPCMap[view as keyof ViewMap].update;

    const formData = await context.request.formData();
    const args = Object.fromEntries(
        formData.entries(),
    ) as Database["public"]["Functions"][typeof rpcName]["Args"];

    const { data, error } = await client.rpc(rpcName, args);

    if (error) {
        console.error(`Supabase RPC error in ${view}/one/patch:`, error);
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
