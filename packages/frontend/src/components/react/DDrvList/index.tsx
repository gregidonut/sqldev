import React from "react";
import {
    QueryClient,
    QueryClientProvider,
    useSuspenseQuery,
} from "@tanstack/react-query";
import { $authStore } from "@clerk/astro/client";
import { useStore } from "@nanostores/react";
import ListUI from "@/components/react/DDrvList/DDrvListUI";
import useMqtt from "@/components/react/hooks/useMqtt";
import createListGetQueryOptions from "@/components/react/DDrvList/queryOptions/createListGet.ts";
import type { ViewMap } from "@/components/react/DDrvList/viewMap.ts";

const queryClient = new QueryClient();

function List<K extends keyof ViewMap>({ view }: { view: K }) {
    const { userId, session } = useStore($authStore);

    const {
        data: posts,
        error,
        refetch,
    } = useSuspenseQuery<ViewMap[K][]>(
        createListGetQueryOptions(userId ?? "", view),
    );

    useMqtt({
        session,
        refetch,
        topic: (function (): string {
            switch (view) {
                case "igPosts":
                    return "ig_posts_view";
                default:
                    return "";
            }
        })(),
        messagesToListenTo: (function (): string[] {
            switch (view) {
                case "igPosts":
                    return ["new_post", "update_post", "new_post_content"];
                default:
                    return [];
            }
        })(),
    });

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
                <ListUI<K> posts={posts} view={view} />
            ) : (
                <p className="text-center text-drac-comment py-10 italic">
                    No posts yet. Be the first to post!
                </p>
            )}
        </section>
    );
}

export default function PostListWrapper<K extends keyof ViewMap>({
    view,
}: {
    view: K;
}) {
    return (
        <QueryClientProvider client={queryClient}>
            <List view={view} />
        </QueryClientProvider>
    );
}
