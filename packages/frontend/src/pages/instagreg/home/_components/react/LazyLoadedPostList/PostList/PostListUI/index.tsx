import { GridList } from "@/components/ui/GridList.tsx";
import type { Database } from "@/utils/supabase/models";
import React from "react";
import PostListItemUI from "./PostListItemUI";

type PostViewRow = Database["public"]["Views"]["ig_posts_view"]["Row"];

export default function PostListUI({ posts }: { posts: PostViewRow[] }) {
    return (
        <GridList
            className="w-full"
            aria-label="posts"
            // selectionMode="single"
            layout="grid"
            items={posts.map(function (p) {
                return {
                    ...p,
                    id: p.post_id!,
                };
            })}
        >
            {(post) => <PostListItemUI post={post} />}
        </GridList>
    );
}
