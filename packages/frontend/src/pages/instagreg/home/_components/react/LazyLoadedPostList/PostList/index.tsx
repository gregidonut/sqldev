import React from "react";
import {
    useSuspenseQuery,
    QueryClient,
    QueryClientProvider,
} from "@tanstack/react-query";
import type { Database } from "@/utils/supabase/models";
import { $authStore } from "@clerk/astro/client";
import { useStore } from "@nanostores/react";
import PostListUI from "@/pages/instagreg/home/_components/react/LazyLoadedPostList/PostList/PostListUI";
import useMqtt from "@/components/react/hooks/useMqtt";
import createIgPostsListGetQueryOptions from "@/pages/instagreg/home/_components/react/queryOptions/createIgPostsListGet.ts";

type PostView = Database["public"]["Views"]["ig_posts_view"]["Row"];
const queryClient = new QueryClient();

function PostList() {
    const { userId, session } = useStore($authStore);

    const {
        data: posts,
        error,
        refetch,
    } = useSuspenseQuery<PostView[]>(
        createIgPostsListGetQueryOptions(userId ?? ""),
    );

    useMqtt({
        session,
        refetch,
        topic: "ig_posts_view",
        messagesToListenTo: ["new_post", "update_post", "new_post_content"],
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
                <PostListUI posts={posts} />
            ) : (
                <p className="text-center text-drac-comment py-10 italic">
                    No posts yet. Be the first to post!
                </p>
            )}
        </section>
    );
}

export default function PostListWrapper() {
    return (
        <QueryClientProvider client={queryClient}>
            <PostList />
        </QueryClientProvider>
    );
}
