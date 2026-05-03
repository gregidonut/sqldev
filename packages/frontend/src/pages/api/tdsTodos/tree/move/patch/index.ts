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
    const p_todo_item_ids = formData.getAll("p_todo_item_ids") as string[];
    const p_new_parent_id = formData.get("p_new_parent_id") as string;

    const { data, error } = await client.rpc("move_tds_todo_items", {
        p_todo_item_ids,
        p_new_parent_id,
    } as Database["public"]["Functions"]["move_tds_todo_items"]["Args"]);

    if (error) {
        return new Response(JSON.stringify({ message: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }

    const topic = `${Resource.App.name}/${Resource.App.stage}/move_tds_todo_items`;
    try {
        await iotClient.send(
            new PublishCommand({
                topic,
                payload: JSON.stringify({ message: "move_tds_todo_items" }),
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
