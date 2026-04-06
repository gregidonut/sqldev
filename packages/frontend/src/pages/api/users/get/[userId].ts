import { clerkClient } from "@clerk/astro/server";
import type { APIRoute } from "astro";

export const GET: APIRoute = async function (context) {
    const { userId } = context.params;

    if (!userId) {
        return new Response(
            JSON.stringify({ message: "User ID is required" }),
            {
                status: 400,
                headers: { "Content-Type": "application/json" },
            },
        );
    }

    try {
        const client = clerkClient(context);
        const user = await client.users.getUser(userId);

        return new Response(JSON.stringify(user), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        if (!(error instanceof Error)) {
            return new Response(
                JSON.stringify({ message: "Unknown error from clerk" }),
                {
                    status: 500,
                    headers: { "Content-Type": "application/json" },
                },
            );
        }
        console.error("Clerk API error:", error.message);
        return new Response(
            JSON.stringify({
                message: error.message || "Failed to fetch user from Clerk",
            }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            },
        );
    }
};
