import { Resource } from "sst";

const goApiURL = Resource.GoApi.url.replace(/\/+$/, "");

type SessionAuth = {
    userId: string | null;
    getToken: () => Promise<string | null>;
};

function jsonMessage(message: string, status: number): Response {
    return new Response(JSON.stringify({ message }), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

export async function proxyAuthenticatedApi(
    request: Request,
    auth: SessionAuth,
): Promise<Response> {
    if (!auth.userId) {
        return jsonMessage("Unauthorized", 401);
    }
    const token = await auth.getToken();
    if (!token) {
        return jsonMessage("Unauthorized", 401);
    }

    const incoming = new URL(request.url);
    const headers = new Headers();
    const contentType = request.headers.get("Content-Type");
    if (contentType) {
        headers.set("Content-Type", contentType);
    }
    const accept = request.headers.get("Accept");
    if (accept) {
        headers.set("Accept", accept);
    }
    const idempotencyKey = request.headers.get("Idempotency-Key");
    if (idempotencyKey) {
        headers.set("Idempotency-Key", idempotencyKey);
    }
    headers.set("Authorization", `Bearer ${token}`);

    const init: RequestInit & { duplex?: "half" } = {
        method: request.method,
        headers,
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = request.body;
        init.duplex = "half";
    }

    let upstream: Response;
    try {
        upstream = await fetch(
            `${goApiURL}${incoming.pathname}${incoming.search}`,
            init,
        );
    } catch {
        return jsonMessage("upstream unavailable", 502);
    }

    const responseHeaders = new Headers();
    for (const name of [
        "content-type",
        "content-disposition",
        "content-length",
    ]) {
        const value = upstream.headers.get(name);
        if (value) {
            responseHeaders.set(name, value);
        }
    }
    return new Response(upstream.body, {
        status: upstream.status,
        headers: responseHeaders,
    });
}
