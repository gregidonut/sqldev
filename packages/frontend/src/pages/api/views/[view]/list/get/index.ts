import { getSupabaseBrowserClient } from "@/utils/supabase/browserClient";
import type { APIRoute, APIContext } from "astro";
import {
    viewTableMap,
    type ViewMap,
} from "@/components/react/DDrvList/viewMap.ts";

export const GET: APIRoute = async function (context: APIContext) {
    const { view } = context.params;

    if (!view || !(view in viewTableMap)) {
        return new Response(
            JSON.stringify({
                message: `Invalid view: ${view}. Expected one of: ${Object.keys(viewTableMap).join(", ")}`,
            }),
            {
                status: 400,
                headers: { "Content-Type": "application/json" },
            },
        );
    }

    const tableName = viewTableMap[view as keyof ViewMap];

    const client = getSupabaseBrowserClient(context);
    const { data, error } = await client.from(tableName).select("*");

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
