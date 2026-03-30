import { getSupabaseBrowserClient } from "@/utils/supabase/browserClient";
import type { APIRoute } from "astro";

export const GET: APIRoute = async function (context) {
  const client = getSupabaseBrowserClient(context);

  const { data, error } = await client.storage
    .from("ig_post_attachments")
    .list('uploads/')

  if (error) {
    return new Response(JSON.stringify({ message: error.message }), {
      status: error.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const files = await Promise.all(
    data.map(async function (file) {
      const { data: signedUrlData, error: signedUrlError } = await client.storage
        .from("ig_post_attachments")
        .createSignedUrl(`uploads/${file.name}`, 60, {
          transform: {
            width: 640,
            height: 480,
            resize: 'contain', // 'cover' | 'fill'
          }
        });

      if (signedUrlError) {
        return new Response(JSON.stringify({ message: signedUrlError.message }), {
          status: signedUrlError.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      return {
        name: file.name,
        url: signedUrlData.signedUrl,
      };
    }));

  return new Response(JSON.stringify(files), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
