import type { Fetchable } from "astro";
import { astro, FetchState, middleware } from "astro/fetch";
import { proxyAuthenticatedApi } from "@/server/goApiProxy";

function isApiPath(pathname: string): boolean {
    return pathname === "/api" || pathname.startsWith("/api/");
}

export default {
    async fetch(request: Request): Promise<Response> {
        const state = new FetchState(request);
        const pathname = new URL(request.url).pathname;
        if (!isApiPath(pathname)) {
            return astro(state);
        }

        return middleware(state, async (current) => {
            const auth = current.locals.auth();
            return proxyAuthenticatedApi(current.request, auth);
        });
    },
} satisfies Fetchable;
