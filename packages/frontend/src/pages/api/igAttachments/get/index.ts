import { getSupabaseBrowserClient } from "@/utils/supabase/browserClient";
import type { APIRoute } from "astro";

export const GET: APIRoute = async function (context) {
    const client = getSupabaseBrowserClient(context);

    const { data, error } = await client.storage
        .from("ig_attachments")
        .list("ig_post_attachments/");

    if (error) {
        return new Response(JSON.stringify({ message: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }

    const files = await Promise.all(
        data.map(async function (file) {
            const { data: signedUrlData, error: signedUrlError } =
                await client.storage
                    .from("ig_attachments")
                    .createSignedUrl(`ig_post_attachments/${file.name}`, 60, {
                        transform: {
                            width: 256,
                            height: 144,
                            resize: "contain", // 'cover' | 'fill'
                        },
                    });

            if (signedUrlError) {
                return new Response(
                    JSON.stringify({ message: signedUrlError.message }),
                    {
                        status: 500,
                        headers: { "Content-Type": "application/json" },
                    },
                );
            }

            const parsedUrl = new URL(signedUrlData.signedUrl);

            return {
                name: file.name,
                url: `/api/storageProxy${parsedUrl.pathname}${parsedUrl.search}`,
            };
        }),
    );

    return new Response(JSON.stringify(files), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
};
