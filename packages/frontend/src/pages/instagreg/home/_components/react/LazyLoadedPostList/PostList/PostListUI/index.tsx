import {
    Disclosure,
    DisclosureHeader,
    DisclosurePanel,
} from "@/components/ui/Disclosure.tsx";
import { GridList, GridListItem } from "@/components/ui/GridList.tsx";
import { Text } from "react-aria-components";
import type { Database } from "@/utils/supabase/models";

import UserBadge from "@/pages/instagreg/home/_components/react/UserBadge";
import MenuButton from "./MenuButton";
import React from "react";

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
            {function (post) {
                return (
                    <GridListItem textValue={post.text_content as string}>
                        <article className="flex-col-start-start">
                            <header className="flex-col-start-start mb-3 relative">
                                <main className="flex-row-between">
                                    <UserBadge
                                        clerk_user_id={post.clerk_user_id!}
                                    />
                                    <time
                                        className="text-xs text-drac-comment uppercase tracking-wider"
                                        dateTime={new Date(
                                            post.created_at!,
                                        ).toISOString()}
                                    >
                                        {new Date(
                                            post.created_at!,
                                        ).toLocaleDateString()}
                                    </time>
                                </main>
                                <footer className="absolute top-[2rem] right-0">
                                    <MenuButton
                                        postOwnerId={post.clerk_user_id!}
                                    />
                                </footer>
                            </header>
                            <main className="pl-[2rem]">
                                <p className="text-drac-foreground leading-relaxed whitespace-pre-wrap text-lg">
                                    <Text slot="description">
                                        {post.text_content as string}
                                    </Text>
                                </p>
                            </main>
                            <footer>
                                <Disclosure isDisabled={true}>
                                    <DisclosureHeader>
                                        no comments yet
                                    </DisclosureHeader>
                                    <DisclosurePanel>
                                        how'd you open this panel?
                                    </DisclosurePanel>
                                </Disclosure>
                            </footer>
                        </article>
                    </GridListItem>
                );
            }}
        </GridList>
    );
}
