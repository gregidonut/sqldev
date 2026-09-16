import type { APIContext } from "astro";
import { type Database } from "../models";
import { createBrowserClient } from "@supabase/ssr";

const accessTokenByRequest = new WeakMap<Request, Promise<string | null>>();

export function getSupabaseBrowserClient(Astro: APIContext) {
    return createBrowserClient<Database>(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_KEY!,
        {
            async accessToken() {
                const request = Astro.request;
                const cached = accessTokenByRequest.get(request);
                if (cached) {
                    return cached;
                }

                const pending = (async () => {
                    const { getToken } = Astro.locals.auth();
                    try {
                        return await getToken({ template: "supabase" });
                    } catch (error) {
                        accessTokenByRequest.delete(request);
                        throw error;
                    }
                })();

                accessTokenByRequest.set(request, pending);
                return pending;
            },
        },
    );
}
