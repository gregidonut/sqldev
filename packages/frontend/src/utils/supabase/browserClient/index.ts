import type {APIContext} from "astro";
import {type Database} from "../models";
import {createBrowserClient} from "@supabase/ssr";

export function getSupabaseBrowserClient(Astro: APIContext) {
    return createBrowserClient<Database>(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_KEY!,
        {
            async accessToken() {
                const { getToken } = Astro.locals.auth();
                return await getToken();
            },
        },
    );
}
