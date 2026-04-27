import React from "react";
import { useDragAndDrop } from "react-aria-components/useDragAndDrop";
import { useTreeData } from "react-aria-components/useTreeData";
import { TodoTree, type TodoItem } from "./TodoTree.tsx";
import {
    useQuery,
    QueryClient,
    QueryClientProvider,
} from "@tanstack/react-query";
import { useStore } from "@nanostores/react";
import { $authStore } from "@clerk/astro/client";
import axios from "axios";

function RACMovableTree({ todoItems }: { todoItems: TodoItem[] }) {
    let tree = useTreeData({
        initialItems: todoItems,
        getKey: (item) => item.todo_item_id as string,
        getChildren: (item) => item.children ?? [],
    });

    let { dragAndDropHooks } = useDragAndDrop({
        getItems(keys, items: TodoItem[]) {
            return items.map((item) => {
                return {
                    "text/plain": `${item.title}`,
                    "text/html": `<strong>${item.title}</strong>`,
                    todoItem: JSON.stringify(item),
                };
            });
        },
        onMove(e) {
            if (e.target.dropPosition === "before") {
                tree.moveBefore(e.target.key, e.keys);
            } else if (e.target.dropPosition === "after") {
                tree.moveAfter(e.target.key, e.keys);
            } else if (e.target.dropPosition === "on") {
                // Move items to become children of the target
                let targetNode = tree.getItem(e.target.key);
                if (targetNode) {
                    let targetIndex = targetNode.children
                        ? targetNode.children.length
                        : 0;
                    let keyArray = Array.from(e.keys);
                    for (let i = 0; i < keyArray.length; i++) {
                        tree.move(keyArray[i], e.target.key, targetIndex + i);
                    }
                }
            }
        },
    });

    function processItem(item: any): TodoItem {
        return {
            ...item.value,
            id: item.value.todo_item_id,
            children: item.children.map(processItem),
        };
    }

    let items = tree.items.map(processItem);
    return <TodoTree items={items} dragAndDropHooks={dragAndDropHooks} />;
}

function RACMovableTreeWithData() {
    const { userId } = useStore($authStore);

    const {
        data: todos,
        isLoading,
        error,
        // refetch,
    } = useQuery<TodoItem[]>({
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

    if (isLoading)
        return (
            <p className="mt-8 text-drac-comment italic text-center w-full">
                Loading todos...
            </p>
        );

    if (error)
        return (
            <p className="mt-8 text-drac-red italic text-center w-full">
                Error loading todos: {(error as Error).message}
            </p>
        );

    return <RACMovableTree todoItems={todos as TodoItem[]} />;
}

const queryClient = new QueryClient();
export default function RACMovableTreeWrapper() {
    return (
        <QueryClientProvider client={queryClient}>
            <RACMovableTreeWithData />
        </QueryClientProvider>
    );
}
