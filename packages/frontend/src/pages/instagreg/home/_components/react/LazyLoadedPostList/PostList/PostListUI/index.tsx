import { GridList, GridListItem } from "@/components/ui/GridList.tsx";
import { Text } from "react-aria-components";
import type { Database } from "@/utils/supabase/models";

import UserBadge from "@/pages/instagreg/home/_components/react/UserBadge";
import React from "react";

type PostViewRow = Database["public"]["Views"]["ig_posts_view"]["Row"];

export default function PostListUI({ posts }: { posts: PostViewRow[] }) {
    return (
        <GridList
            className="w-full"
            aria-label="posts"
            selectionMode="multiple"
            layout="grid"
            items={posts.map(function (p) {
                return {
                    ...p,
                    id: p.post_id!,
                };
            })}
        >
            {function (post) {
                return (
                    <GridListItem textValue={post.text_content as string}>
                        <div className="flex-col-start-start">
                            <header>
                                <UserBadge
                                    clerk_user_id={post.clerk_user_id as string}
                                />
                            </header>
                            <Text slot="description">
                                {post.text_content as string}
                            </Text>
                        </div>
                    </GridListItem>
                );
            }}
        </GridList>
    );
}
