import { Tree, TreeItem } from "./Tree";
import { Collection, type DragAndDropHooks } from "react-aria-components";
import type { Database } from "@/utils/supabase/models";

type TodoRow = Database["public"]["Views"]["tds_todos_view"]["Row"];

export interface TodoItem extends TodoRow {
    id: string;
    children: TodoItem[] | null;
}

interface TodoItemTreeProps {
    items?: TodoItem[];
    dragAndDropHooks?: DragAndDropHooks<TodoItem>;
}

export function TodoTree(props: TodoItemTreeProps) {
    let { items, dragAndDropHooks } = props;

    return (
        <Tree
            aria-label="Pokemon tree"
            selectionMode="multiple"
            items={items}
            renderEmptyState={() => "Drop items here"}
            dragAndDropHooks={dragAndDropHooks}
        >
            {function renderItem(item: TodoItem) {
                return (
                    <TreeItem
                        title={`${item.title}`}
                        textValue={item.title as string}
                    >
                        <Collection items={item.children ?? undefined}>
                            {renderItem}
                        </Collection>
                    </TreeItem>
                );
            }}
        </Tree>
    );
}
