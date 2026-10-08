import React, { useEffect, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCollator, useFilter } from "react-aria";
import { DialogTrigger } from "react-aria-components/Dialog";
import { TooltipTrigger } from "react-aria-components/Tooltip";
import type { Key, SortDescriptor } from "react-aria-components/Table";
import { PlusIcon, SlidersIcon, TrashIcon } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import type { ObjectsTab } from "@/utils/storage/objectsTab.ts";
import { AlertDialog } from "../AlertDialog.tsx";
import { Button } from "../Button.tsx";
import { Menu, MenuItem, MenuTrigger } from "../Menu.tsx";
import { Modal } from "../Modal.tsx";
import { SearchField } from "../SearchField.tsx";
import { Tooltip } from "../Tooltip.tsx";
import { StorageList } from "./StorageList.tsx";
import { StorageTable, TOGGLEABLE_STORAGE_COLUMNS } from "./StorageTable.tsx";
import {
    toStorageSort,
    useStorageTableStore,
} from "./store/storageTableStore.ts";
import { CopyForm } from "../forms/CopyForm.tsx";
import { UploadForm } from "../forms/UploadForm.tsx";
import { toErrorMessage } from "./storageDisplay.tsx";
import createBatchDeleteMutationOptions from "../queryOptions/createBatchDelete.ts";
import createBucketExistsGetQueryOptions from "../queryOptions/createBucketExistsGet.ts";
import createListGetQueryOptions from "../queryOptions/createListGet.ts";
import createOneDeleteMutationOptions from "../queryOptions/createOneDelete.ts";
import type { StorageRow } from "../queryOptions/types.ts";
import { cy } from "@/utils/cy";

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
        setSearch,
        setSort,
        setVisibleColumns,
        setSelectedKeys,
        clearSelection,
        openDialog,
        closeDialog,
        setActionError,
    } = useStorageTableStore(
        useShallow(function (state) {
            return {
                search: state.search,
                sort: state.sort,
                visibleColumnIds: state.visibleColumns,
                selectedKeys: state.selectedKeys,
                dialog: state.dialog,
                actionError: state.actionError,
                setSearch: state.setSearch,
                setSort: state.setSort,
                setVisibleColumns: state.setVisibleColumns,
                setSelectedKeys: state.setSelectedKeys,
                clearSelection: state.clearSelection,
                openDialog: state.openDialog,
                closeDialog: state.closeDialog,
                setActionError: state.setActionError,
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
            <div className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
                <SearchField
                    aria-label="Search storage objects"
                    placeholder="Search by file, owner, or key"
                    value={search}
                    onChange={setSearch}
                    className="col-span-3 sm:col-span-1"
                />

                <MenuTrigger>
                    <TooltipTrigger>
                        <Button
                            aria-label="Columns"
                            variant="secondary"
                            className="!h-9 !w-9 shrink-0 sm:col-start-2"
                        >
                            <SlidersIcon
                                aria-hidden
                                className="block h-5 w-5"
                            />
                        </Button>
                        <Tooltip>Columns</Tooltip>
                    </TooltipTrigger>
                    <Menu
                        selectionMode="multiple"
                        selectedKeys={visibleColumns}
                        onSelectionChange={setVisibleColumns}
                        disallowEmptySelection
                        items={TOGGLEABLE_STORAGE_COLUMNS}
                    >
                        {(column) => (
                            <MenuItem id={column.id}>{column.label}</MenuItem>
                        )}
                    </Menu>
                </MenuTrigger>

                {canModify && (
                    <DialogTrigger>
                        <TooltipTrigger>
                            <Button
                                {...cy("dStorage_upload")}
                                aria-label="Upload a file"
                                variant="secondary"
                                className="!h-9 !w-9 shrink-0"
                            >
                                <PlusIcon
                                    aria-hidden
                                    className="block h-5 w-5"
                                />
                            </Button>
                            <Tooltip>Upload a file</Tooltip>
                        </TooltipTrigger>
                        <Modal>
                            <UploadForm
                                bucketName={bucketName}
                                userId={userId}
                            />
                        </Modal>
                    </DialogTrigger>
                )}
            </div>

            {canModify && (
                <div className="flex flex-wrap items-center gap-3">
                    <Button
                        variant="destructive"
                        isDisabled={
                            selectedObjectKeys.length === 0 || isDeleting
                        }
                        onPress={() => openDialog({ kind: "batch-delete" })}
                    >
                        <TrashIcon aria-hidden className="h-4 w-4" />
                        Delete selected
                    </Button>
                    <span className="font-sans text-xs text-drac-comment">
                        {selectedObjectKeys.length} selected
                    </span>
                </div>
            )}

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

            {/* List view for mobile */}
            <StorageList
                items={items}
                selectedKeys={selectedKeys}
                onSelectionChange={setSelectedKeys}
                bucketName={bucketName}
                userId={userId}
                canDelete={canModify}
                emptyMessage={TAB_EMPTY_MESSAGE[tab]}
                onCopy={(item) => openDialog({ kind: "copy", item })}
                onDelete={(item) => openDialog({ kind: "delete", item })}
                onError={setActionError}
            />
            {/* Table view for desktop */}
            <StorageTable
                items={items}
                visibleColumns={visibleColumns}
                sortDescriptor={sortDescriptor}
                onSortChange={handleSortChange}
                selectedKeys={selectedKeys}
                onSelectionChange={setSelectedKeys}
                bucketName={bucketName}
                userId={userId}
                canDelete={canModify}
                emptyMessage={TAB_EMPTY_MESSAGE[tab]}
                onCopy={(item) => openDialog({ kind: "copy", item })}
                onDelete={(item) => openDialog({ kind: "delete", item })}
                onError={setActionError}
            />

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
