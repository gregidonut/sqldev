import { type TodoItem, TodoTree } from "./TodoTree.tsx";
import React from "react";
import { useDragAndDrop, useTreeData } from "react-aria-components";
import axios from "axios";
import { useMutation } from "@tanstack/react-query";

interface MoveTodoItemsArgs {
    todoItemIds: string[];
    newParentId: string | null;
}

async function moveTodoItems({ todoItemIds, newParentId }: MoveTodoItemsArgs) {
    const formData = new FormData();
    for (const id of todoItemIds) {
        formData.append("p_todo_item_ids", id);
    }
    if (newParentId != null) {
        formData.append("p_new_parent_id", newParentId);
    }

    const { data } = await axios({
        url: "/api/tdsTodos/tree/move/patch",
        method: "PATCH",
        data: formData,
        headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
}

export function RACMovableTree({ todoItems }: { todoItems: TodoItem[] }) {
    const { mutate: persistMove } = useMutation({
        mutationFn: moveTodoItems,
        onError: (error) => {
            console.error("Failed to persist todo move:", error);
        },
    });

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
            const draggedKeys = Array.from(e.keys) as string[];

            if (e.target.dropPosition === "before") {
                tree.moveBefore(e.target.key, e.keys);
                // "before" means same parent as the target node
                const targetNode = tree.getItem(e.target.key);
                const newParentId =
                    (targetNode?.value.todo_item_parent_id as string) ?? null;
                persistMove({ todoItemIds: draggedKeys, newParentId });
            } else if (e.target.dropPosition === "after") {
                tree.moveAfter(e.target.key, e.keys);
                // "after" means same parent as the target node
                const targetNode = tree.getItem(e.target.key);
                const newParentId =
                    (targetNode?.value.todo_item_parent_id as string) ?? null;
                persistMove({ todoItemIds: draggedKeys, newParentId });
            } else if (e.target.dropPosition === "on") {
                // "on" means the target itself becomes the new parent
                const targetNode = tree.getItem(e.target.key);
                if (targetNode) {
                    const targetIndex = targetNode.children
                        ? targetNode.children.length
                        : 0;
                    for (let i = 0; i < draggedKeys.length; i++) {
                        tree.move(
                            draggedKeys[i],
                            e.target.key,
                            targetIndex + i,
                        );
                    }
                }
                persistMove({
                    todoItemIds: draggedKeys,
                    newParentId: e.target.key as string,
                });
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
