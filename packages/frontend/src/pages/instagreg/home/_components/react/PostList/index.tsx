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
import UserBadge from "@/pages/instagreg/home/_components/react/PostList/UserBadge";
import { $authStore } from "@clerk/astro/client";
import { useStore } from "@nanostores/react";

type PostView = Database["public"]["Views"]["ig_posts_view"]["Row"];

interface PostListProps {
    realtimeEndpoint: string;
    realtimeAuthorizer: string;
    appName: string;
    appStage: string;
}

function createConnection(endpoint: string, authorizer: string, token: string) {
    return mqtt.connect(
        `wss://${endpoint}/mqtt?x-amz-customauthorizer-name=${authorizer}`,
        {
            protocolVersion: 5,
            manualConnect: true,
            username: "", // Must be empty for the authorizer
            password: token, // Passed as the token to the authorizer
            clientId: `client_${window.crypto.randomUUID()}`,
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

        async function initMqtt() {
            const token = await session?.getToken();

            if (!token) return;

            mqttClient = createConnection(
                realtimeEndpoint,
                realtimeAuthorizer,
                token,
            );

            mqttClient.on("connect", () => {
                // console.log("Connected to SST Realtime");
                mqttClient?.subscribe(`${appName}/${appStage}/ig_posts_view`);
            });

            mqttClient.on("message", (topic, message) => {
                const payload = message.toString();
                // console.log("Received message:", topic, payload);
                refetch();
            });

            mqttClient.connect();
        }

        initMqtt();

        return () => {
            mqttClient?.end();
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
            <h2 className="text-xl font-bold mb-6 text-drac-purple border-b border-drac-comment pb-2">
                Recent Posts
            </h2>
            {posts?.length === 0 && (
                <p className="text-center text-drac-comment py-10 italic">
                    No posts yet. Be the first to post!
                </p>
            )}
            {posts?.map((post) => (
                <div
                    className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
                    key={post.post_id}
                >
                    <article className="p-5 border border-drac-comment rounded-lg bg-drac-background-lighter hover:border-drac-pink transition-colors duration-200">
                        <header className="flex justify-between items-start mb-3">
                            <UserBadge clerk_user_id={post.clerk_user_id!} />
                            <time className="text-[10px] text-drac-comment uppercase tracking-wider">
                                {new Date(
                                    post.created_at!,
                                ).toLocaleDateString()}
                            </time>
                        </header>
                        <p className="text-drac-foreground leading-relaxed whitespace-pre-wrap">
                            {post.text_content}
                        </p>
                    </article>
                </div>
            ))}
        </section>
    );
}

export default function PostListWrapper(props: PostListProps) {
    const queryClient = new QueryClient();
    return (
        <QueryClientProvider client={queryClient}>
            <PostList {...props} />
        </QueryClientProvider>
    );
}
