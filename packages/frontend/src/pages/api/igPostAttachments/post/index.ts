import type {APIRoute} from "astro";
import {getSupabaseBrowserClient} from "@/utils/supabase/browserClient";

export const POST: APIRoute = async (context) => {
    try {
        const client = getSupabaseBrowserClient(context);

        const {data: _, error} = await client.rpc("get_owner");
        if (error) {
            return new Response(JSON.stringify({message: error.message}), {
                status: 500,
                headers: {"Content-Type": "application/json"},
            });
        }

        const formData = await context.request.formData();

        const files = formData
            .getAll("files")
            .filter((value): value is File => value instanceof File);

        if (files.length === 0) {
            return new Response(JSON.stringify({message: "No files uploaded"}), {
                status: 400,
                headers: {"Content-Type": "application/json"},
            });
        }


        const uploadedFiles = await Promise.all(
            files.map(async (file) => {
                const filePath = `uploads/${crypto.randomUUID()}-${file.name}`;

                const {data, error} = await client.storage
                    .from("ig_post_attachments")
                    .upload(filePath, file);

                if (error) {
                    console.error("Error uploading file:", error);
                    throw error;
                }

                return data;
            }),
        );


        return new Response(JSON.stringify(uploadedFiles), {
            status: 200,
            headers: {"Content-Type": "application/json"},
        });
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Unexpected upload error";

        return new Response(JSON.stringify({message}), {
            status: 500,
            headers: {"Content-Type": "application/json"},
        });
    }
};
