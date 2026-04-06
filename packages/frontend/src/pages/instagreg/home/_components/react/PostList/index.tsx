import React from "react";
import {
    useQuery,
    useQueryClient,
    QueryClient,
    QueryClientProvider,
} from "@tanstack/react-query";
import axios from "axios";
import type { Database } from "@/utils/supabase/models";
import UserBadge from "@/pages/instagreg/home/_components/react/PostList/UserBadge";
import { $authStore } from "@clerk/astro/client";
import { useStore } from "@nanostores/react";

type PostView = Database["public"]["Views"]["ig_posts_view"]["Row"];

function PostList() {
    const { userId } = useStore($authStore);

    const {
        data: posts,
        isLoading,
        error,
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
                                {post.created_at
                                    ? new Date(
                                          post.created_at,
                                      ).toLocaleDateString()
                                    : ""}
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

export default function PostListWrapper() {
    const queryClient = new QueryClient();
    return (
        <QueryClientProvider client={queryClient}>
            <PostList />
        </QueryClientProvider>
    );
}
