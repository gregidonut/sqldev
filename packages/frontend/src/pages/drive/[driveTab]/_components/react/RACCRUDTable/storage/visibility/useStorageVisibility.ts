import { useCallback, useEffect, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useConfirmationStore } from "@/utils/confirmation/confirmationStore";
import {
    asIdempotencyKey,
    toConfigRevision,
    toStorageObjectId,
} from "@/utils/confirmation/protocol";
import type { ObjectsTab } from "@/utils/storage/objectsTab";
import { dStorageListKeyPrefix } from "../../queryOptions/createListGet.ts";
import { createMakePrivateMutationOptions } from "../../queryOptions/createVisibilityPost.ts";
import type { StorageRow } from "../../queryOptions/types.ts";
import { createStorageMakePublicAdapter } from "./storageMakePublicAdapter.ts";
import {
    directChangeFailureMessage,
    visibilityActionFor,
    type StorageVisibilityMenu,
} from "./visibilityAction.ts";

/**
 * The visibility actions for one drive table.
 *
 * "Make public…" opens the shared confirmation dialog, because the server decides
 * it needs a confirmation. "Make private" only reduces exposure, so it is one
 * ordinary request with no dialog.
 */
export function useStorageVisibility({
    tab,
    bucketName,
    userId,
    onError,
}: {
    tab: ObjectsTab;
    bucketName: string;
    userId: string;
    /** Receives a page-level message, or null to clear the previous one. */
    onError: (message: string | null) => void;
}): StorageVisibilityMenu {
    const queryClient = useQueryClient();
    const makePrivate = useMutation(
        createMakePrivateMutationOptions({ bucketName }),
    );
    const { mutate, isPending, variables } = makePrivate;

    // The dialog host is generic; this registers the one operation it can confirm.
    useEffect(
        function () {
            const store = useConfirmationStore.getState();
            const unregister = store.registerAdapter(
                createStorageMakePublicAdapter({
                    bucketName,
                    userId,
                    queryClient,
                }),
            );
            return function () {
                // A dialog left open would reappear if the island mounted again.
                store.close();
                unregister();
            };
        },
        [bucketName, userId, queryClient],
    );

    const actionFor = useCallback(
        (row: StorageRow) => visibilityActionFor(tab, row),
        [tab],
    );

    const isRowPending = useCallback(
        (row: StorageRow) =>
            isPending && variables?.target.id === row.storage_object_id,
        [isPending, variables],
    );

    const invoke = useCallback(
        function (row: StorageRow, trigger: HTMLElement | null) {
            const action = visibilityActionFor(tab, row);
            const id = toStorageObjectId(row.storage_object_id);
            const revision = toConfigRevision(row.config_version);
            if (action === null || id === null || revision === null) {
                onError(directChangeFailureMessage(row.file_name, "other"));
                return;
            }
            const target = { type: "storage_object", id } as const;

            if (action === "make-public") {
                useConfirmationStore.getState().open({
                    operationKind: "storage.visibility.make_public",
                    target,
                    expectedRevision: revision,
                    label: row.file_name,
                    focus: { origin: trigger, rowKey: row.s3_object_key },
                });
                return;
            }

            onError(null);
            // One key per user invocation: a retry of this request would reuse it.
            const key = asIdempotencyKey(crypto.randomUUID());
            mutate(
                { target, expectedRevision: revision, key },
                {
                    onSuccess: function (result) {
                        if (result.kind === "visibility_changed") {
                            // However many times this result is delivered, the lists
                            // refresh once for the one committed change.
                            useConfirmationStore
                                .getState()
                                .recordFinalSuccess(key, function () {
                                    void queryClient.invalidateQueries({
                                        queryKey: dStorageListKeyPrefix(userId),
                                    });
                                });
                            return;
                        }
                        const reason =
                            result.kind === "rejected" &&
                            (result.reason === "forbidden" ||
                                result.reason === "stale_revision")
                                ? result.reason
                                : "other";
                        onError(
                            directChangeFailureMessage(row.file_name, reason),
                        );
                    },
                    onError: function () {
                        onError(
                            directChangeFailureMessage(row.file_name, "other"),
                        );
                    },
                },
            );
        },
        [tab, mutate, onError, queryClient, userId],
    );

    return useMemo(
        () => ({ actionFor, isPending: isRowPending, invoke }),
        [actionFor, isRowPending, invoke],
    );
}
