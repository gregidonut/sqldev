import React from "react";
import {
    QueryClientProvider,
    useSuspenseQuery,
} from "@tanstack/react-query";
import { $authStore } from "@clerk/astro/client";
import { useStore } from "@nanostores/react";
import ListUI from "@/components/react/DDrvList/DDrvListUI";
import useMqtt from "@/components/react/hooks/useMqtt";
import createListGetQueryOptions from "@/components/react/DDrvList/queryOptions/createListGet.ts";
import {
    type ViewMap,
    viewTableMap,
} from "@/components/react/DDrvList/viewMap.ts";
import { useListStore } from "@/components/react/DDrvList/store/store.ts";
import { listQueryClient } from "@/components/react/DDrvList/queryClient.ts";
import { cy } from "@/utils/cy";

const MQTT_MESSAGES: { [K in keyof ViewMap]: string[] } = {
    igPosts: ["new_post_content"],
    tdsTodoSpaces: ["new_todo_space_data"],
};

function List<K extends keyof ViewMap>() {
    const { userId, session } = useStore($authStore);
    const { currentView: view } = useListStore();
    if (!view) return null;

    const {
        data: posts,
        error,
        refetch,
    } = useSuspenseQuery<ViewMap[K][]>(createListGetQueryOptions(userId ?? ""));

    const { connected } = useMqtt({
        session,
        refetch,
        topic: viewTableMap[view as keyof ViewMap],
        messagesToListenTo: MQTT_MESSAGES[view],
    });

    if (error)
        return (
            <p className="mt-8 text-drac-red italic text-center w-full">
                Error loading posts: {(error as Error).message}
            </p>
        );

    return (
        <section className="mt-12 w-full" {...cy(`${view}_list`)}>
            {connected && <span hidden {...cy("mqtt_connected")} />}
            <header>
                <h2 className="text-xl font-bold mb-6 text-drac-purple border-b border-drac-comment pb-2">
                    Recent Posts
                </h2>
            </header>
            {posts && posts.length !== 0 ? (
                <ListUI<K> posts={posts} />
            ) : (
                <p className="text-center text-drac-comment py-10 italic">
                    No posts yet. Be the first to post!
                </p>
            )}
        </section>
    );
}

export default function ListWrapper() {
    return (
        <QueryClientProvider client={listQueryClient}>
            <List />
        </QueryClientProvider>
    );
}
