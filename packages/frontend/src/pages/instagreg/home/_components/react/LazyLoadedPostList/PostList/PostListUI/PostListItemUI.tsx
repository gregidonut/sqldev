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

function formatPostDate(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();

    // Normalize both to midnight for day comparison
    const todayMidnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
    );
    const dateMidnight = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
    );
    const daysDiff = Math.round(
        (todayMidnight.getTime() - dateMidnight.getTime()) / 86_400_000,
    );

    const kitchenTime = date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
    });
    switch (true) {
        case daysDiff === 0:
            return kitchenTime;
        case daysDiff === 1:
            return `yesterday ${kitchenTime}`;
        case daysDiff <= 6:
            return `${date.toLocaleDateString(undefined, { weekday: "long" })} ${kitchenTime}`;
        default:
            return date.toLocaleDateString();
    }
}

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
                            <p className="text-[0.4rem] text-drac-comment lowercase tracking-wider flex-col-end-end">
                                <time
                                    className="font-extrabold"
                                    dateTime={new Date(
                                        post.created_at!,
                                    ).toISOString()}
                                >
                                    {formatPostDate(post.created_at!)}
                                </time>
                                {post.created_at !== post.updated_at && (
                                    <span>
                                        - last updated:{" "}
                                        <time
                                            dateTime={new Date(
                                                post.updated_at!,
                                            ).toISOString()}
                                        >
                                            {formatPostDate(post.updated_at!)}
                                        </time>
                                    </span>
                                )}
                            </p>
                        </main>
                        <footer className="absolute top-[2rem] right-0">
                            <MenuButton
                                postOwnerId={post.clerk_user_id!}
                                onEdit={() => setIsEditing(true)}
                            />
                        </footer>
                    </header>
                    <main className="px-[2rem]">
                        <p className="text-drac-foreground leading-relaxed whitespace-pre-wrap text-lg wrap-break-words">
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
