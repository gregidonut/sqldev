import { getSupabaseBrowserClient } from "@/utils/supabase/browserClient";
import type { APIRoute } from "astro";
import {
    viewTableMap,
    viewIdKeys,
    type ViewMap,
} from "@/components/react/DDrvList/viewMap.ts";
import type { Database } from "@/utils/supabase/models";

export const GET: APIRoute = async function (context) {
    const { view, itemId } = context.params;

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

    const idColumn = viewIdKeys[view as keyof ViewMap];
    if (!itemId) {
        return new Response(
            JSON.stringify({ message: `${idColumn} is required` }),
            {
                status: 400,
                headers: { "Content-Type": "application/json" },
            },
        );
    }

    const tableName = viewTableMap[view as keyof ViewMap];

    const client = getSupabaseBrowserClient(context);
    const { data, error } = await client
        .from(tableName)
        .select("*")
        .eq(
            idColumn as keyof Database["public"]["Views"][typeof tableName]["Row"],
            itemId,
        )
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
