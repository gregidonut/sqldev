import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Selection } from "react-aria-components/Table";
import { GridList, GridListItem } from "../GridList.tsx";
import { StorageActionMenu } from "./StorageActionMenu.tsx";
import { StorageThumbnail } from "./StorageThumbnail.tsx";
import { formatTimestamp, VisibilityBadge } from "./storageDisplay.tsx";
import type { StorageRow } from "../queryOptions/types.ts";
import type { StorageVisibilityMenu } from "./visibility/visibilityAction.ts";
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
    visibility?: StorageVisibilityMenu;
}

// Private ownership lifecycle for the single latest-active preview tile.
// `pending` is a candidate that has been chosen but is still inside its
// one-animation-frame coalescing window; `active` is a candidate that survived
// that window and now owns the enabled animation query. Modelling this as a
// discriminated union keeps the frame handle and the monotonic epoch out of
// React state so a stale rAF callback can never promote an obsolete source.
type PreviewOwner =
    | { readonly state: "idle" }
    | { readonly state: "pending"; readonly sourceKey: string; readonly epoch: number }
    | { readonly state: "active"; readonly sourceKey: string; readonly epoch: number };

// Grid-level coordinator for the single latest-active preview tile.
//
// Each tile reports whether a pointer or keyboard focus is within it. Rapid
// candidates are coalesced over one animation frame: a pointer entry schedules
// promotion for the next frame, and a newer entry before that frame replaces
// the pending candidate so only the one still latest at the frame boundary
// becomes active. Only the active tile may own an enabled animation query and
// show progress.
//
// When the active source changes we explicitly cancel the previous source's
// exact animation query — outside any React state updater, before the
// replacement is published — so a pending transform POST, job poll, or
// inter-poll wait is aborted. Cancellation defaults to `revert`, so a prior
// successful animation stays cached and reusable on a later hover.
function useLatestActivePreview(): {
    activeSourceKey: string | null;
    onActiveChange: (sourceKey: string, active: boolean) => void;
} {
    // Monotonic activation order lets us restore the newest still-active
    // candidate when the current one leaves (e.g. focus A, hover B, leave B).
    const orderRef = useRef(0);
    const candidatesRef = useRef<Map<string, number>>(new Map());
    // Authoritative private ownership. React state mirrors only the published
    // active source so inactive tiles render poster-only.
    const ownerRef = useRef<PreviewOwner>({ state: "idle" });
    const epochRef = useRef(0);
    const rafRef = useRef<number | null>(null);
    const [activeSourceKey, setActiveSourceKey] = useState<string | null>(null);
    const queryClient = useQueryClient();

    const cancelAnimation = useCallback(
        function (sourceKey: string) {
            // Abort obsolete client work for the superseded source. revert
            // (default) keeps any prior successful cached data.
            void queryClient.cancelQueries({
                queryKey: dStorageThumbnailQueryKey(sourceKey, "animation"),
                exact: true,
            });
        },
        [queryClient],
    );

    const cancelScheduledFrame = useCallback(function () {
        if (rafRef.current !== null && typeof cancelAnimationFrame !== "undefined") {
            cancelAnimationFrame(rafRef.current);
        }
        rafRef.current = null;
    }, []);

    // Explicit ownership transition. Cancels the previous active source's
    // animation query BEFORE publishing the replacement so obsolete polls stop
    // before the new owner starts, then mirrors the active source into state.
    const publishActive = useCallback(
        function (next: string | null, epoch: number) {
            const previous = ownerRef.current;
            const previousActive =
                previous.state === "active" ? previous.sourceKey : null;
            if (previousActive !== null && previousActive !== next) {
                cancelAnimation(previousActive);
            }
            if (next === null) {
                ownerRef.current = { state: "idle" };
                setActiveSourceKey(null);
                return;
            }
            ownerRef.current = { state: "active", sourceKey: next, epoch };
            setActiveSourceKey(next);
        },
        [cancelAnimation],
    );

    // Choose the newest still-active candidate (or none) and drive it through
    // the one-frame gate before it may become the active owner.
    const reconcile = useCallback(
        function () {
            let bestKey: string | null = null;
            let bestOrder = -1;
            candidatesRef.current.forEach(function (order, key) {
                if (order > bestOrder) {
                    bestOrder = order;
                    bestKey = key;
                }
            });

            const current = ownerRef.current;
            const currentTarget =
                current.state === "idle" ? null : current.sourceKey;
            if (currentTarget === bestKey) {
                return;
            }

            cancelScheduledFrame();

            if (bestKey === null) {
                // Nothing is hovered/focused: retire immediately, cancelling
                // the previous active source's work.
                epochRef.current += 1;
                publishActive(null, epochRef.current);
                return;
            }

            // Schedule promotion for the next animation frame. A newer entry
            // before that frame replaces this pending candidate.
            epochRef.current += 1;
            const epoch = epochRef.current;
            ownerRef.current = { state: "pending", sourceKey: bestKey, epoch };
            const candidate = bestKey;
            const promote = function () {
                rafRef.current = null;
                const owner = ownerRef.current;
                // Only promote if this candidate is still the pending one.
                if (owner.state !== "pending" || owner.epoch !== epoch) {
                    return;
                }
                publishActive(candidate, epoch);
            };
            if (typeof requestAnimationFrame === "undefined") {
                promote();
                return;
            }
            rafRef.current = requestAnimationFrame(promote);
        },
        [cancelScheduledFrame, publishActive],
    );

    const onActiveChange = useCallback(
        function (sourceKey: string, active: boolean) {
            const candidates = candidatesRef.current;
            if (active) {
                orderRef.current += 1;
                candidates.set(sourceKey, orderRef.current);
            } else {
                candidates.delete(sourceKey);
            }
            reconcile();
        },
        [reconcile],
    );

    // Clean up the scheduled frame and cancel the active source's work when the
    // grid unmounts or switches view.
    useEffect(
        function () {
            return function () {
                cancelScheduledFrame();
                const owner = ownerRef.current;
                if (owner.state === "active") {
                    cancelAnimation(owner.sourceKey);
                }
                ownerRef.current = { state: "idle" };
                candidatesRef.current.clear();
            };
        },
        [cancelScheduledFrame, cancelAnimation],
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
        visibility,
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
            // React Aria caches rendered items for a dynamic collection and
            // only re-runs the item render function when `items` or an explicit
            // dependency changes. `isActive` is derived from `activeSourceKey`,
            // which is not part of `items`, so it must be declared here or a
            // newly active tile would never receive isActive=true.
            dependencies={[activeSourceKey]}
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
