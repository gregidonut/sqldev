import type { APIRoute } from "astro";
import { Resource } from "sst";
import { requireApiAuth } from "@/utils/clerk/requireAuth";
import {
    abortPendingUpload,
    authorizeDStorage,
    commitPendingUpload,
    deleteOrphanedObject,
} from "@/utils/supabase/authorizeDStorage";

const GO_API_URL = Resource.GoApi.url.replace(/\/+$/, "");

function resolvePath(path: string | undefined): string | null {
    if (!path) return null;
    const normalized = path.replace(/^\/+/, "").replace(/\/+$/, "");
    if (normalized !== "buckets" && !normalized.startsWith("buckets/")) {
        return null;
    }
    return normalized;
}

function buildUpstreamUrl(
    path: string,
    incomingSearch: string,
    upstreamQueryParams?: URLSearchParams,
): string {
    const search = upstreamQueryParams
        ? `?${upstreamQueryParams.toString()}`
        : incomingSearch;
    return `${GO_API_URL}/${path}${search}`;
}

const proxy: APIRoute = async function (context) {
    const unauthorized = requireApiAuth(context);
    if (unauthorized) return unauthorized;

    const { params, request } = context;
    const path = resolvePath(
        Array.isArray(params.path) ? params.path.join("/") : params.path,
    );

    if (!path) {
        return new Response(
            JSON.stringify({
                message: "Only /buckets/* routes are exposed through this proxy",
            }),
            {
                status: 404,
                headers: { "Content-Type": "application/json" },
            },
        );
    }

    const auth = await authorizeDStorage(context, path);
    if (auth instanceof Response) {
        return auth;
    }

    const incomingUrl = new URL(request.url);
    const upstream = buildUpstreamUrl(
        path,
        incomingUrl.search,
        auth.upstreamQueryParams,
    );

    const headers = new Headers();
    const contentType = request.headers.get("Content-Type");
    if (contentType && auth.upstreamBody === undefined) {
        headers.set("Content-Type", contentType);
    }
    if (auth.upstreamBody !== undefined) {
        headers.set("Content-Type", "application/json");
    }
    const accept = request.headers.get("Accept");
    if (accept) {
        headers.set("Accept", accept);
    }

    const init: RequestInit & { duplex?: "half" } = {
        method: request.method,
        headers,
    };

    if (auth.upstreamBody !== undefined) {
        init.body = auth.upstreamBody;
    } else if (auth.bufferedBody !== undefined) {
        init.body = auth.bufferedBody;
    } else if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = request.body;
        init.duplex = "half";
    }

    const upstreamRes = await fetch(upstream, init);

    if (auth.pendingUpload) {
        if (upstreamRes.ok) {
            const commitError = await commitPendingUpload(
                context,
                auth.pendingUpload,
            );
            if (commitError) {
                await upstreamRes.body?.cancel();
                await deleteOrphanedObject(
                    GO_API_URL,
                    path,
                    auth.pendingUpload,
                );
                await abortPendingUpload(context, auth.pendingUpload);
                return commitError;
            }
        } else {
            await abortPendingUpload(context, auth.pendingUpload);
        }
    }

    const responseHeaders = new Headers();
    const upstreamContentType = upstreamRes.headers.get("Content-Type");
    if (upstreamContentType) {
        responseHeaders.set("Content-Type", upstreamContentType);
    }
    const contentDisposition = upstreamRes.headers.get("Content-Disposition");
    if (contentDisposition) {
        responseHeaders.set("Content-Disposition", contentDisposition);
    }

    return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        headers: responseHeaders,
    });
};

export const GET = proxy;
export const POST = proxy;
export const DELETE = proxy;
export const PUT = proxy;
export const PATCH = proxy;
