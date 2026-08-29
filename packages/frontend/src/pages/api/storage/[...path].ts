import type { APIRoute } from "astro";
import { Resource } from "sst";

const GO_API_URL = Resource.GoApi.url;

function resolvePath(path: string | undefined): string | null {
    if (!path) return null;
    // Astro catch-all may be "a/b" or leave segments joined already.
    const normalized = path.replace(/^\/+/, "").replace(/\/+$/, "");
    if (normalized !== "buckets" && !normalized.startsWith("buckets/")) {
        return null;
    }
    return normalized;
}

const proxy: APIRoute = async function ({ params, request }) {
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

    const incomingUrl = new URL(request.url);
    const upstream = `${GO_API_URL}${path}${incomingUrl.search}`;

    const headers = new Headers();
    const contentType = request.headers.get("Content-Type");
    if (contentType) {
        headers.set("Content-Type", contentType);
    }
    const accept = request.headers.get("Accept");
    if (accept) {
        headers.set("Accept", accept);
    }

    const init: RequestInit & { duplex?: "half" } = {
        method: request.method,
        headers,
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = request.body;
        // Required when streaming a Request body through fetch in Node.
        init.duplex = "half";
    }

    const upstreamRes = await fetch(upstream, init);

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
