import React, { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Selection } from "react-aria-components/Table";
import { GridList, GridListItem } from "../GridList.tsx";
import { StorageActionMenu } from "./StorageActionMenu.tsx";
import { StorageThumbnail } from "./StorageThumbnail.tsx";
import { formatTimestamp, VisibilityBadge } from "./storageDisplay.tsx";
import type { StorageRow } from "../queryOptions/types.ts";
import { dStorageThumbnailQueryKey } from "../queryOptions/createThumbnailGet.ts";
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
}

// Grid-level coordinator for the single latest-active preview tile.
//
// Each tile reports whether a pointer or keyboard focus is within it. Only one
// tile at a time may own an enabled animation query and show progress: the one
// activated most recently that is still active. When that selection changes we
// explicitly cancel the previous source's exact animation query so a pending
// transform POST, job poll, or inter-poll wait is aborted. Cancellation is
// client-side only — an accepted backend render may still finish and remains
// reusable from cache on a later hover.
function useLatestActivePreview(): {
    activeSourceKey: string | null;
    onActiveChange: (sourceKey: string, active: boolean) => void;
} {
    // Monotonic activation order lets us restore the newest still-active
    // candidate when the current one leaves (e.g. focus A, hover B, leave B).
    const orderRef = useRef(0);
    const candidatesRef = useRef<Map<string, number>>(new Map());
    const [activeSourceKey, setActiveSourceKey] = useState<string | null>(null);
    const queryClient = useQueryClient();

    const select = useCallback(
        function (next: string | null) {
            setActiveSourceKey(function (previous) {
                if (previous === next) {
                    return previous;
                }
                if (previous !== null) {
                    // Abort obsolete client work for the superseded source.
                    // revert (default) keeps any prior successful cached data.
                    void queryClient.cancelQueries({
                        queryKey: dStorageThumbnailQueryKey(
                            previous,
                            "animation",
                        ),
                        exact: true,
                    });
                }
                return next;
            });
        },
        [queryClient],
    );

    const onActiveChange = useCallback(
        function (sourceKey: string, active: boolean) {
            const candidates = candidatesRef.current;
            if (active) {
                orderRef.current += 1;
                candidates.set(sourceKey, orderRef.current);
                select(sourceKey);
                return;
            }
            candidates.delete(sourceKey);
            // Restore the newest candidate that is still active, if any.
            let bestKey: string | null = null;
            let bestOrder = -1;
            candidates.forEach(function (order, key) {
                if (order > bestOrder) {
                    bestOrder = order;
                    bestKey = key;
                }
            });
            select(bestKey);
        },
        [select],
    );

    return { activeSourceKey, onActiveChange };
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
    } = props;

    const { activeSourceKey, onActiveChange } = useLatestActivePreview();

    return (
        <GridList
            {...cy("dStorage_objects")}
            aria-label="Storage objects"
            selectionMode="multiple"
            selectedKeys={selectedKeys}
            onSelectionChange={onSelectionChange}
            items={items}
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
                        isActive={activeSourceKey === item.s3_object_key}
                        onActiveChange={onActiveChange}
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
