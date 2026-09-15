import React from "react";
import { type TodoItem } from "./TodoTree.tsx";
import {
    QueryClient,
    QueryClientProvider,
    useSuspenseQuery,
} from "@tanstack/react-query";
import { useStore } from "@nanostores/react";
import { $authStore } from "@clerk/astro/client";
import axios from "axios";
import { RACMovableTree } from "./RACMovableTree.tsx";
import useMqtt from "@/components/react/hooks/useMqtt";
import { cy } from "@/utils/cy";

// useMqtt keys its effect on this array's identity, so it has to be stable
// across renders or the client reconnects on every render.
const MQTT_MESSAGES = ["new_todo_item_data"];

function RACMovableTreeWithData({
    tdsTodoSpaceId,
}: {
    tdsTodoSpaceId: string;
}) {
    const { userId, session } = useStore($authStore);

    const {
        data: todos,
        error,
        refetch,
    } = useSuspenseQuery<TodoItem[]>({
        queryKey: [
            "get",
            "tdsTodos",
            tdsTodoSpaceId,
            "tree",
            {
                userId,
            },
        ],
        queryFn: async () => {
            const { data } = await axios<TodoItem[]>({
                method: "get",
                url: `/api/views/tdsTodos/${tdsTodoSpaceId}/tree/get`,
            });
            return data;
        },
    });

    const { connected } = useMqtt({
        session,
        refetch,
        topic: "tds_todos_view",
        messagesToListenTo: MQTT_MESSAGES,
    });

    if (error)
        return (
            <p className="mt-8 text-drac-red italic text-center w-full">
                Error loading todos: {(error as Error).message}
            </p>
        );

    return (
        <>
            {connected && <span hidden {...cy("mqtt_connected")} />}
            <RACMovableTree
                todoItems={todos as TodoItem[]}
                tdsTodoSpaceId={tdsTodoSpaceId}
            />
        </>
    );
}

const queryClient = new QueryClient();
export default function RACMovableTreeWithDataWrapper({
    tdsTodoSpaceId,
}: {
    tdsTodoSpaceId: string;
}) {
    return (
        <QueryClientProvider client={queryClient}>
            <RACMovableTreeWithData tdsTodoSpaceId={tdsTodoSpaceId} />
        </QueryClientProvider>
    );
}
