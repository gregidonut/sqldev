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
import { viewStores } from "@/components/react/DDrvList/store/viewStore.ts";
import { formatDate } from "@/utils/formatDate.ts";
import type { ViewMap } from "@/components/react/DDrvList/viewMap.ts";

export default function ListItemUI<K extends keyof ViewMap>({
    post,
    view,
}: {
    post: ViewMap[K];
    view: K;
}) {
    const usePostsViewStore = viewStores[view];
    const { isEditing, postId } = usePostsViewStore();
    // const { isEditing, postId } = usePostsViewStore();

    return (
        <GridListItem textValue={post.text_content as string}>
            {isEditing && post.post_id === postId ? (
                <div className="w-full">
                    <ItemEditForm postId={post.post_id!} view={view} />
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
                                postId={post.post_id!}
                                view={view}
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
