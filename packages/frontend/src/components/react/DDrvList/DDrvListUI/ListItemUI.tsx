import React from "react";
import { GridListItem } from "@/components/ui/GridList.tsx";
import { Text } from "react-aria-components";
import UserBadge from "@/components/react/UserBadge";
import MenuButton from "./MenuButton";
import ItemEditForm from "./ItemEditForm.tsx";
import {
    Disclosure,
    DisclosureHeader,
    DisclosurePanel,
} from "@/components/ui/Disclosure.tsx";
import { useListStore } from "@/components/react/DDrvList/store/store.ts";
import { formatDate } from "@/utils/formatDate.ts";
import {
    type ViewMap,
    viewIdKeys,
} from "@/components/react/DDrvList/viewMap.ts";
import type {
    PostsViewRow,
    TodoSpacesViewRow,
} from "@/utils/supabase/models/aliases.ts";

export default function ListItemUI<K extends keyof ViewMap>({
    post,
    view,
}: {
    post: ViewMap[K];
    view: K;
}) {
    const { isEditing, postId } = useListStore();
    const idKey = viewIdKeys[view];
    const currentId = post[idKey] as string;

    // Helper to get content regardless of view type
    const textContent =
        (post as PostsViewRow).text_content ??
        (post as TodoSpacesViewRow).name ??
        "";
    const htmlContent = (post as PostsViewRow).text_content_html;
    const href =
        view === "tdsTodoSpaces" ? `/todos/space/${currentId}` : undefined;

    return (
        <GridListItem textValue={textContent} href={href}>
            {isEditing && currentId === postId ? (
                <div className="w-full">
                    <ItemEditForm postId={currentId} />
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
                                    {formatDate(post.created_at!)}
                                </time>
                                {post.created_at !== post.updated_at && (
                                    <span>
                                        - last updated:{" "}
                                        <time
                                            dateTime={new Date(
                                                post.updated_at!,
                                            ).toISOString()}
                                        >
                                            {formatDate(post.updated_at!)}
                                        </time>
                                    </span>
                                )}
                            </p>
                        </main>
                        <footer className="absolute top-[2rem] right-0">
                            <MenuButton
                                postOwnerId={post.clerk_user_id!}
                                postId={currentId}
                            />
                        </footer>
                    </header>
                    <main className="px-[2rem]">
                        {htmlContent ? (
                            <div
                                className={
                                    "prose prose-invert text-drac-foreground prose-stone"
                                }
                                dangerouslySetInnerHTML={{
                                    __html: htmlContent,
                                }}
                            />
                        ) : (
                            <p className="text-drac-foreground leading-relaxed whitespace-pre-wrap text-lg wrap-break-words">
                                <Text slot="description">{textContent}</Text>
                            </p>
                        )}
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
