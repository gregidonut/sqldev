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
                url: `/api/tdsTodos/${tdsTodoSpaceId}/tree/get`,
            });
            return data;
        },
    });

    useMqtt({
        session,
        refetch,
        topic: "tds_todos_view",
        messagesToListenTo: ["new_todo_item_data"],
    });

    if (error)
        return (
            <p className="mt-8 text-drac-red italic text-center w-full">
                Error loading todos: {(error as Error).message}
            </p>
        );

    return (
        <RACMovableTree
            todoItems={todos as TodoItem[]}
            tdsTodoSpaceId={tdsTodoSpaceId}
        />
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
