import React from "react";
import type { Selection } from "react-aria-components/Table";
import { GridList, GridListItem } from "../GridList.tsx";
import { StorageActionMenu } from "./StorageActionMenu.tsx";
import { StorageThumbnail } from "./StorageThumbnail.tsx";
import { formatTimestamp, VisibilityBadge } from "./storageDisplay.tsx";
import type { StorageRow } from "../queryOptions/types.ts";
import type { StorageVisibilityMenu } from "./visibility/visibilityAction.ts";
import { useLatestActivePreview } from "@/components/react/StorageTile/useLatestActivePreview.ts";
import { cy } from "@/utils/cy";

interface StorageTilesProps {
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
    visibility?: StorageVisibilityMenu;
}


export function StorageTiles(props: StorageTilesProps): React.ReactNode {
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
        visibility,
    } = props;

    const { activeInstanceKey, onActiveChange, registerAnimation } =
        useLatestActivePreview();

    return (
        <GridList
            {...cy("dStorage_objects")}
            aria-label="Storage objects"
            selectionMode="multiple"
            selectedKeys={selectedKeys}
            onSelectionChange={onSelectionChange}
            items={items}
            // React Aria caches rendered items for a dynamic collection and
            // only re-runs the item render function when `items` or an explicit
            // dependency changes. `isActive` is derived from `activeInstanceKey`,
            // which is not part of `items`, so it must be declared here or a
            // newly active tile would never receive isActive=true.
            dependencies={[activeInstanceKey]}
            renderEmptyState={() => emptyMessage}
            className="grid h-auto max-h-[70vh] w-full grid-cols-[repeat(auto-fill,minmax(min(100%,12rem),1fr))] content-start gap-3 overflow-auto border-0 bg-transparent p-1"
        >
            {(item) => (
                <GridListItem
                    {...cy("dStorage_item")}
                    data-preview-root=""
                    id={item.s3_object_key}
                    textValue={item.file_name}
                    className="h-auto w-full min-w-0 flex-col items-stretch gap-2 rounded-lg border border-drac-selection bg-drac-background p-2"
                >
                    <StorageThumbnail
                        fileName={item.file_name}
                        sourceKey={item.s3_object_key}
                        userId={userId}
                        isActive={activeInstanceKey === item.s3_object_key}
                        onActiveChange={onActiveChange}
                        registerAnimation={registerAnimation}
                    />
                    <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2">
                        <span className="truncate font-medium">
                            {item.file_name}
                        </span>
                        <StorageActionMenu
                            item={item}
                            bucketName={bucketName}
                            userId={userId}
                            canDelete={canDelete}
                            onCopy={onCopy}
                            onDelete={onDelete}
                            onError={onError}
                            visibility={visibility}
                        />
                        <div className="col-start-1 flex min-w-0 items-center gap-2">
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
