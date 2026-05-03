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

function RACMovableTreeWithData() {
    const { userId } = useStore($authStore);

    const {
        data: todos,
        error,
        // refetch,
    } = useSuspenseQuery<TodoItem[]>({
        queryKey: [
            "get",
            "tdsTodos",
            "tree",
            {
                userId,
            },
        ],
        queryFn: async () => {
            const { data } = await axios<TodoItem[]>({
                method: "get",
                url: "/api/tdsTodos/tree/get",
            });
            return data;
        },
    });

    if (error)
        return (
            <p className="mt-8 text-drac-red italic text-center w-full">
                Error loading todos: {(error as Error).message}
            </p>
        );

    return <RACMovableTree todoItems={todos as TodoItem[]} />;
}

const queryClient = new QueryClient();
export default function RACMovableTreeWithDataWrapper() {
    return (
        <QueryClientProvider client={queryClient}>
            <RACMovableTreeWithData />
        </QueryClientProvider>
    );
}
