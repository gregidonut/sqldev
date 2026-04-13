import type { APIRoute } from "astro";
import { getSupabaseBrowserClient } from "@/utils/supabase/browserClient";
import type { Database } from "@/utils/supabase/models";
import {
    IoTDataPlaneClient,
    PublishCommand,
} from "@aws-sdk/client-iot-data-plane";
import { Resource } from "sst";

const iotClient = new IoTDataPlaneClient({
    endpoint: `https://${Resource.SQLDevRealtimeSST.endpoint}`,
});

export const PATCH: APIRoute = async (context) => {
    const client = getSupabaseBrowserClient(context);

    const formData = await context.request.formData();

    const { data, error } = await client.rpc(
        "update_ig_post",
        Object.fromEntries(
            formData,
        ) as Database["public"]["Functions"]["update_ig_post"]["Args"],
    );
    if (error) {
        console.error("Supabase RPC error in igPosts/one/patch:", error);
        return new Response(JSON.stringify({ message: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }

    const topic = `${Resource.App.name}/${Resource.App.stage}/ig_posts_view`;
    try {
        await iotClient.send(
            new PublishCommand({
                topic,
                payload: JSON.stringify({ message: "update_post" }),
                qos: 1,
            }),
        );
    } catch (error) {
        console.error("Failed to publish to SST Realtime:", error);
        if (!(error instanceof Error)) {
            return new Response(
                JSON.stringify({
                    message: "Unknown error from iotclient.send",
                }),
                {
                    status: 500,
                    headers: { "Content-Type": "application/json" },
                },
            );
        }

        return new Response(JSON.stringify({ message: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
};
