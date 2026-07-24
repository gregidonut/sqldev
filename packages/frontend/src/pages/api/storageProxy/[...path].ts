// src/pages/api/igAttachments/proxy/[...path].ts
import type { APIRoute } from "astro";
import { Resource } from "sst";

const IMAGEPROXY_URL = Resource.ImgproxyUrl.value;

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
    console.log("Incoming URL:", incomingUrl);

    const upstream = `${IMAGEPROXY_URL}/${params.path}${incomingUrl.search}`;
    console.log("Upstream URL:", upstream);

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
