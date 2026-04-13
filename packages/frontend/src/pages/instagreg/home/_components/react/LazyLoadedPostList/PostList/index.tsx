import React, { useEffect } from "react";
import mqtt from "mqtt";
import type { MqttClient } from "mqtt";
import {
    useQuery,
    QueryClient,
    QueryClientProvider,
} from "@tanstack/react-query";
import axios from "axios";
import type { Database } from "@/utils/supabase/models";
import { $authStore } from "@clerk/astro/client";
import { useStore } from "@nanostores/react";
import { type PostListProps } from "../../PostListProps.ts";
import PostListUI from "@/pages/instagreg/home/_components/react/LazyLoadedPostList/PostList/PostListUI";

type PostView = Database["public"]["Views"]["ig_posts_view"]["Row"];
const queryClient = new QueryClient();

function createConnection(endpoint: string, authorizer: string, token: string) {
    return mqtt.connect(
        `wss://${endpoint}/mqtt?x-amz-customauthorizer-name=${authorizer}`,
        {
            protocolVersion: 5,
            manualConnect: true,
            username: "", // Must be empty for the authorizer
            password: token, // Passed as the token to the authorizer
            clientId: `client_${window.crypto.randomUUID()}`,
            reconnectPeriod: 0, // Disable internal reconnection, we handle it manually to refresh the token
            connectTimeout: 5000,
        },
    );
}

function PostList({
    realtimeEndpoint,
    realtimeAuthorizer,
    appName,
    appStage,
}: PostListProps) {
    const { userId, session } = useStore($authStore);

    const {
        data: posts,
        isLoading,
        error,
        refetch,
    } = useQuery<PostView[]>({
        queryKey: [
            "get",
            "igPosts",
            "list",
            {
                userId,
            },
        ],
        queryFn: async () => {
            const response = await axios.get<PostView[]>(
                "/api/igPosts/list/get",
            );
            return response.data;
        },
    });

    useEffect(() => {
        if (!session) return;

        let mqttClient: MqttClient | null = null;
        let isConnecting = false;
        let isDisposed = false;
        let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

        async function initMqtt() {
            // Guard against multiple concurrent connection attempts
            if (isConnecting || isDisposed) return;
            isConnecting = true;

            try {
                if (mqttClient) {
                    mqttClient.end();
                    mqttClient = null;
                }

                const token = await session?.getToken();
                if (!token || isDisposed) return;

                const client = createConnection(
                    realtimeEndpoint,
                    realtimeAuthorizer,
                    token,
                );
                mqttClient = client;

                const scheduleReconnect = () => {
                    if (isDisposed || reconnectTimeout) return;
                    reconnectTimeout = setTimeout(() => {
                        reconnectTimeout = null;
                        initMqtt();
                    }, 1000);
                };

                client.on("connect", () => {
                    if (isDisposed) {
                        client.end(true);
                        return;
                    }
                    client.subscribe(`${appName}/${appStage}/ig_posts_view`);
                });

                client.on("message", (topic, message) => {
                    if (isDisposed) return;
                    const m = (
                        JSON.parse(message.toString()) as { message: string }
                    ).message;
                    if (["new_post", "update_post"].includes(m)) refetch();
                });

                client.on("error", (err) => {
                    if (isDisposed) return;
                    console.error("MQTT error:", err);
                    client.end(true);
                    if (mqttClient === client) mqttClient = null;
                    scheduleReconnect();
                });

                client.on("close", () => {
                    if (isDisposed) return;
                    if (mqttClient === client) mqttClient = null;
                    scheduleReconnect();
                });

                client.connect();
            } catch (err) {
                console.error("Failed to initialize MQTT:", err);
            } finally {
                isConnecting = false;
            }
        }

        initMqtt();

        return () => {
            isDisposed = true;
            if (reconnectTimeout) {
                clearTimeout(reconnectTimeout);
            }
            if (mqttClient) {
                mqttClient.end(true);
            }
        };
    }, [
        session,
        realtimeEndpoint,
        realtimeAuthorizer,
        appName,
        appStage,
        refetch,
    ]);

    if (isLoading)
        return (
            <p className="mt-8 text-drac-comment italic text-center w-full">
                Loading posts...
            </p>
        );
    if (error)
        return (
            <p className="mt-8 text-drac-red italic text-center w-full">
                Error loading posts: {(error as Error).message}
            </p>
        );

    return (
        <section className="mt-12 w-full">
            <header>
                <h2 className="text-xl font-bold mb-6 text-drac-purple border-b border-drac-comment pb-2">
                    Recent Posts
                </h2>
            </header>
            {posts && posts.length !== 0 ? (
                <PostListUI posts={posts} />
            ) : (
                <p className="text-center text-drac-comment py-10 italic">
                    No posts yet. Be the first to post!
                </p>
            )}
        </section>
    );
}

export default function PostListWrapper(props: PostListProps) {
    return (
        <QueryClientProvider client={queryClient}>
            <PostList {...props} />
        </QueryClientProvider>
    );
}
