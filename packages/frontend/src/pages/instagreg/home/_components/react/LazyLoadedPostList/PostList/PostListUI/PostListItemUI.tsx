import React, { useState } from "react";
import { GridListItem } from "@/components/ui/GridList.tsx";
import { Text } from "react-aria-components";
import type { Database } from "@/utils/supabase/models";
import UserBadge from "@/pages/instagreg/home/_components/react/UserBadge";
import MenuButton from "./MenuButton";
import PostEditForm from "./PostEditForm";
import {
    Disclosure,
    DisclosureHeader,
    DisclosurePanel,
} from "@/components/ui/Disclosure.tsx";

type PostViewRow = Database["public"]["Views"]["ig_posts_view"]["Row"];

export default function PostListItemUI({ post }: { post: PostViewRow }) {
    const [isEditing, setIsEditing] = useState(false);

    return (
        <GridListItem textValue={post.text_content as string}>
            {isEditing ? (
                <div className="w-full">
                    <PostEditForm
                        postId={post.post_id!}
                        onCancel={() => setIsEditing(false)}
                        onSuccess={() => setIsEditing(false)}
                    />
                </div>
            ) : (
                <article className="flex-col-start-start w-full">
                    <header className="flex-col-start-start mb-3 relative w-full">
                        <main className="flex-row-between w-full">
                            <UserBadge clerk_user_id={post.clerk_user_id!} />
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
                                onEdit={() => setIsEditing(true)}
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
                            <DisclosureHeader>no comments yet</DisclosureHeader>
                            <DisclosurePanel>
                                how'd you open this panel?
                            </DisclosurePanel>
                        </Disclosure>
                    </footer>
                </article>
            )}
        </GridListItem>
    );
}
