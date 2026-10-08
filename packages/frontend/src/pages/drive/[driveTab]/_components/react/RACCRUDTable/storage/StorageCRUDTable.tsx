import React, { useEffect, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCollator, useFilter } from "react-aria";
import type {
    Key,
    Selection,
    SortDescriptor,
} from "react-aria-components/Table";
import { useShallow } from "zustand/react/shallow";
import type { ObjectsTab } from "@/utils/storage/objectsTab.ts";
import { AlertDialog } from "../AlertDialog.tsx";
import { Modal } from "../Modal.tsx";
import { SearchField } from "../SearchField.tsx";
import { StorageList } from "./StorageList.tsx";
import { StorageTable } from "./StorageTable.tsx";
import { StorageTiles } from "./StorageTiles.tsx";
import { StorageToolbar } from "./StorageToolbar.tsx";
import {
    toStorageSort,
    useStorageTableStore,
    type StorageView,
} from "./store/storageTableStore.ts";
import { CopyForm } from "../forms/CopyForm.tsx";
import { toErrorMessage } from "./storageDisplay.tsx";
import createBatchDeleteMutationOptions from "../queryOptions/createBatchDelete.ts";
import createBucketExistsGetQueryOptions from "../queryOptions/createBucketExistsGet.ts";
import createListGetQueryOptions from "../queryOptions/createListGet.ts";
import createOneDeleteMutationOptions from "../queryOptions/createOneDelete.ts";
import type { StorageRow } from "../queryOptions/types.ts";

export type StorageCRUDTableProps = {
    tab: ObjectsTab;
    bucketName: string;
    userId: string;
};

const TAB_EMPTY_MESSAGE: Record<ObjectsTab, string> = {
    public: "No public objects yet.",
    mine: "You have not uploaded anything yet.",
    shared_with_me: "Nothing has been shared with you yet.",
};

function compareRows(
    a: StorageRow,
    b: StorageRow,
    column: Key | undefined,
    collator: Intl.Collator,
): number {
    if (!column) {
        return 0;
    }
    const first = a[column as keyof StorageRow];
    const second = b[column as keyof StorageRow];
    if (typeof first === "boolean" || typeof second === "boolean") {
        return Number(Boolean(first)) - Number(Boolean(second));
    }
    return collator.compare(String(first ?? ""), String(second ?? ""));
}

type StorageObjectsViewProps = {
    items: StorageRow[];
    visibleColumns: Selection;
    sortDescriptor: SortDescriptor;
    onSortChange: (sortDescriptor: SortDescriptor) => void;
    selectedKeys: Selection;
    onSelectionChange: (keys: Selection) => void;
    bucketName: string;
    userId: string;
    canDelete: boolean;
    emptyMessage: string;
    onCopy: (item: StorageRow) => void;
    onDelete: (item: StorageRow) => void;
    onError: (message: string) => void;
};

function renderStorageView(
    view: StorageView,
    props: StorageObjectsViewProps,
): React.ReactNode {
    switch (view) {
        case "detailed":
            return (
                <>
                    <StorageList
                        items={props.items}
                        selectedKeys={props.selectedKeys}
                        onSelectionChange={props.onSelectionChange}
                        bucketName={props.bucketName}
                        userId={props.userId}
                        canDelete={props.canDelete}
                        emptyMessage={props.emptyMessage}
                        onCopy={props.onCopy}
                        onDelete={props.onDelete}
                        onError={props.onError}
                    />
                    <StorageTable
                        items={props.items}
                        visibleColumns={props.visibleColumns}
                        sortDescriptor={props.sortDescriptor}
                        onSortChange={props.onSortChange}
                        selectedKeys={props.selectedKeys}
                        onSelectionChange={props.onSelectionChange}
                        bucketName={props.bucketName}
                        userId={props.userId}
                        canDelete={props.canDelete}
                        emptyMessage={props.emptyMessage}
                        onCopy={props.onCopy}
                        onDelete={props.onDelete}
                        onError={props.onError}
                    />
                </>
            );
        case "tiles":
            return <StorageTiles {...props} />;
        default:
            return assertUnreachable(view);
    }
}

function assertUnreachable(value: never): never {
    throw new Error(`Unexpected storage view: ${String(value)}`);
}

function StatusPanel({
    children,
    tone = "neutral",
}: {
    children: React.ReactNode;
    tone?: "neutral" | "error";
}) {
    return (
        <p
            role={tone === "error" ? "alert" : undefined}
            className={`w-full rounded-lg border border-drac-selection bg-drac-background p-4 font-sans text-sm ${
                tone === "error" ? "text-drac-red" : "text-drac-comment"
            }`}
        >
            {children}
        </p>
    );
}

export default function StorageCRUDTable({
    tab,
    bucketName,
    userId,
}: StorageCRUDTableProps): React.ReactNode {
    // Only the owner role holds create/delete permission, so mutating actions
    // are limited to the tab that lists objects the viewer owns.
    const canModify = tab === "mine";

    const bucketQuery = useQuery(
        createBucketExistsGetQueryOptions({ bucketName }),
    );
    const listQuery = useQuery(
        createListGetQueryOptions({ userId, bucketName, tab }),
    );

    const {
        search,
        sort,
        visibleColumnIds,
        selectedKeys,
        dialog,
        actionError,
        view,
        setSearch,
        setSort,
        setVisibleColumns,
        setSelectedKeys,
        clearSelection,
        openDialog,
        closeDialog,
        setActionError,
        setView,
    } = useStorageTableStore(
        useShallow(function (state) {
            return {
                search: state.search,
                sort: state.sort,
                visibleColumnIds: state.visibleColumns,
                selectedKeys: state.selectedKeys,
                dialog: state.dialog,
                actionError: state.actionError,
                view: state.view,
                setSearch: state.setSearch,
                setSort: state.setSort,
                setVisibleColumns: state.setVisibleColumns,
                setSelectedKeys: state.setSelectedKeys,
                clearSelection: state.clearSelection,
                openDialog: state.openDialog,
                closeDialog: state.closeDialog,
                setActionError: state.setActionError,
                setView: state.setView,
            };
        }),
    );

    useEffect(
        function () {
            clearSelection();
        },
        [tab, clearSelection],
    );

    const visibleColumns = useMemo(
        function () {
            return new Set<Key>(visibleColumnIds);
        },
        [visibleColumnIds],
    );
    const sortDescriptor = useMemo(
        function () {
            return {
                column: sort.column,
                direction: sort.direction,
            };
        },
        [sort],
    );

    const { contains } = useFilter({ sensitivity: "base" });
    const collator = useCollator();

    const oneDelete = useMutation(
        createOneDeleteMutationOptions({ userId, bucketName }),
    );
    const batchDelete = useMutation(
        createBatchDeleteMutationOptions({ userId, bucketName }),
    );

    const rows = listQuery.data;
    const items = useMemo(() => {
        const direction = sortDescriptor.direction === "descending" ? -1 : 1;
        return (rows ?? [])
            .filter(
                (row) =>
                    contains(row.file_name, search) ||
                    contains(row.clerk_user_id, search) ||
                    contains(row.s3_object_key, search),
            )
            .sort(
                (a, b) =>
                    compareRows(a, b, sortDescriptor.column, collator) *
                    direction,
            );
    }, [rows, search, sortDescriptor, contains, collator]);

    const selectedObjectKeys = useMemo(() => {
        if (selectedKeys === "all") {
            return items.map((item) => item.s3_object_key);
        }
        return Array.from(selectedKeys, (key) => String(key));
    }, [selectedKeys, items]);

    const isDeleting = oneDelete.isPending || batchDelete.isPending;

    function handleDialogOpenChange(isOpen: boolean) {
        if (!isOpen) {
            closeDialog();
        }
    }

    function handleSortChange(descriptor: SortDescriptor) {
        const next = toStorageSort(descriptor);
        if (!next) {
            return;
        }
        setSort(next);
    }

    function confirmSingleDelete() {
        if (dialog.kind !== "delete") {
            return;
        }
        const item = dialog.item;
        setActionError(null);
        oneDelete.mutate(
            { key: item.s3_object_key },
            {
                onSuccess: () => clearSelection(),
                onError: (error) =>
                    setActionError(
                        toErrorMessage(
                            error,
                            `Could not delete "${item.file_name}".`,
                        ),
                    ),
            },
        );
    }

    function confirmBatchDelete() {
        if (selectedObjectKeys.length === 0) {
            return;
        }
        setActionError(null);
        batchDelete.mutate(
            { keys: selectedObjectKeys },
            {
                onSuccess: () => clearSelection(),
                onError: (error) =>
                    setActionError(
                        toErrorMessage(
                            error,
                            "Could not delete the selected objects.",
                        ),
                    ),
            },
        );
    }

    if (bucketQuery.isPending) {
        return <StatusPanel>Checking the storage bucket…</StatusPanel>;
    }

    if (bucketQuery.isError) {
        return (
            <StatusPanel tone="error">
                {toErrorMessage(
                    bucketQuery.error,
                    "The storage bucket could not be reached.",
                )}
            </StatusPanel>
        );
    }

    if (!bucketQuery.data) {
        return (
            <StatusPanel tone="error">
                Bucket “{bucketName}” was not found.
            </StatusPanel>
        );
    }

    return (
        <div className="flex w-full min-w-0 flex-col gap-4 p-4">
            <SearchField
                aria-label="Search storage objects"
                placeholder="Search by file, owner, or key"
                value={search}
                onChange={setSearch}
                className="w-full"
            />
            <StorageToolbar
                canModify={canModify}
                selectedCount={selectedObjectKeys.length}
                isDeleting={isDeleting}
                view={view}
                visibleColumns={visibleColumns}
                bucketName={bucketName}
                userId={userId}
                onDeleteSelected={() => openDialog({ kind: "batch-delete" })}
                onViewChange={setView}
                onVisibleColumnsChange={setVisibleColumns}
            />

            {listQuery.isPending && (
                <StatusPanel>Loading storage objects…</StatusPanel>
            )}
            {listQuery.isError && (
                <StatusPanel tone="error">
                    {toErrorMessage(
                        listQuery.error,
                        "The storage objects could not be loaded.",
                    )}
                </StatusPanel>
            )}
            {actionError && (
                <StatusPanel tone="error">{actionError}</StatusPanel>
            )}

            {renderStorageView(view, {
                items,
                visibleColumns,
                sortDescriptor,
                onSortChange: handleSortChange,
                selectedKeys,
                onSelectionChange: setSelectedKeys,
                bucketName,
                userId,
                canDelete: canModify,
                emptyMessage: TAB_EMPTY_MESSAGE[tab],
                onCopy: (item) => openDialog({ kind: "copy", item }),
                onDelete: (item) => openDialog({ kind: "delete", item }),
                onError: setActionError,
            })}

            <Modal
                isOpen={dialog.kind === "copy"}
                onOpenChange={handleDialogOpenChange}
            >
                {dialog.kind === "copy" && (
                    <CopyForm
                        item={dialog.item}
                        bucketName={bucketName}
                        userId={userId}
                    />
                )}
            </Modal>

            <Modal
                isOpen={dialog.kind === "delete"}
                onOpenChange={handleDialogOpenChange}
            >
                {dialog.kind === "delete" && (
                    <AlertDialog
                        title="Delete object"
                        variant="destructive"
                        actionLabel="Delete"
                        onAction={confirmSingleDelete}
                    >
                        Are you sure you want to delete “{dialog.item.file_name}
                        ”? This cannot be undone.
                    </AlertDialog>
                )}
            </Modal>

            <Modal
                isOpen={dialog.kind === "batch-delete"}
                onOpenChange={handleDialogOpenChange}
            >
                <AlertDialog
                    title="Delete selected objects"
                    variant="destructive"
                    actionLabel="Delete"
                    onAction={confirmBatchDelete}
                >
                    Are you sure you want to delete {selectedObjectKeys.length}{" "}
                    selected object
                    {selectedObjectKeys.length === 1 ? "" : "s"}? This cannot be
                    undone.
                </AlertDialog>
            </Modal>
        </div>
    );
}
