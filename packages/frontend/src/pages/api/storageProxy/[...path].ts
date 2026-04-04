// src/pages/api/igAttachments/proxy/[...path].ts
import type { APIRoute } from "astro";

const SUPABASE_URL = process.env.SUPABASE_URL!;

export const GET: APIRoute = async function ({ params, locals, request }) {
    const { getToken } = locals.auth();
    const token = await getToken();

    if (!token) {
        return new Response(JSON.stringify({ message: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }

    const incomingUrl = new URL(request.url);
    const upstream = `${SUPABASE_URL}/${params.path}${incomingUrl.search}`;

    const upstreamRes = await fetch(upstream, {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });

    if (!upstreamRes.ok) {
        const body = await upstreamRes.text();
        return new Response(body, {
            status: upstreamRes.status,
            headers: { "Content-Type": "application/json" },
        });
    }

    return new Response(upstreamRes.body, {
        status: 200,
        headers: {
            "Content-Type":
                upstreamRes.headers.get("Content-Type") ??
                "application/octet-stream",
            // "Cache-Control": "public, max-age=60",
        },
    });
};
