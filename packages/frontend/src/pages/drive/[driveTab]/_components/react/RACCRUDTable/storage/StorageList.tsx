import React from "react";
import type { Selection } from "react-aria-components/Table";
import { GridList, GridListItem } from "../GridList.tsx";
import { StorageActionMenu } from "./StorageActionMenu.tsx";
import { formatTimestamp, VisibilityBadge } from "./storageDisplay.tsx";
import type { StorageRow } from "../queryOptions/types.ts";

interface StorageListProps {
    items: StorageRow[];
    selectedKeys: Selection;
    onSelectionChange: (keys: Selection) => void;
    bucketName: string;
    userId: string;
    canDelete: boolean;
    emptyMessage: string;
    onCopy: (item: StorageRow) => void;
    onDelete: (item: StorageRow) => void;
    onError: (message: string) => void;
}

/* Rendered on mobile in place of the StorageTable. */
export function StorageList(props: StorageListProps): React.ReactNode {
    const {
        items,
        selectedKeys,
        onSelectionChange,
        bucketName,
        userId,
        canDelete,
        emptyMessage,
        onCopy,
        onDelete,
        onError,
    } = props;

    return (
        <GridList
            aria-label="Storage objects"
            selectionMode="multiple"
            selectedKeys={selectedKeys}
            onSelectionChange={onSelectionChange}
            items={items}
            renderEmptyState={() => emptyMessage}
            className="h-[420px] w-full md:!hidden"
        >
            {(item) => (
                <GridListItem
                    id={item.s3_object_key}
                    textValue={item.file_name}
                >
                    <div className="grid w-full grid-cols-[1fr_auto] gap-x-2">
                        <span className="truncate">{item.file_name}</span>
                        <div className="row-span-3 flex items-center">
                            <StorageActionMenu
                                item={item}
                                bucketName={bucketName}
                                userId={userId}
                                canDelete={canDelete}
                                onCopy={onCopy}
                                onDelete={onDelete}
                                onError={onError}
                            />
                        </div>
                        <span className="col-start-1 truncate text-xs text-drac-comment">
                            {item.clerk_user_id}
                        </span>
                        <div className="col-start-1 flex items-center gap-2 pt-1">
                            <VisibilityBadge isPublic={item.public} />
                            <span className="truncate text-xs text-drac-comment">
                                Updated {formatTimestamp(item.updated_at)}
                            </span>
                        </div>
                    </div>
                </GridListItem>
            )}
        </GridList>
    );
}
