import React, { useMemo } from "react";
import type {
    ColumnProps,
    Selection,
    SortDescriptor,
} from "react-aria-components/Table";
import { VisuallyHidden } from "react-aria-components/VisuallyHidden";
import { Cell, Column, Row, Table, TableBody, TableHeader } from "../Table.tsx";
import { StorageActionMenu } from "./StorageActionMenu.tsx";
import { formatTimestamp, VisibilityBadge } from "./storageDisplay.tsx";
import type { StorageRow } from "../queryOptions/types.ts";

export type StorageColumnId =
    | "file_name"
    | "public"
    | "clerk_user_id"
    | "created_at"
    | "updated_at"
    | "s3_object_key"
    | "storage_object_id"
    | "user_id"
    | "actions";

export type StorageColumnDef = ColumnProps & {
    id: StorageColumnId;
    label: string;
};

/** Mirrors the columns of every `d_storage_objects_*_view`, plus row actions. */
export const STORAGE_COLUMNS: StorageColumnDef[] = [
    {
        id: "file_name",
        label: "File name",
        children: "File name",
        minWidth: 160,
        defaultWidth: 220,
        allowsSorting: true,
    },
    {
        id: "public",
        label: "Visibility",
        children: "Visibility",
        defaultWidth: 120,
        allowsSorting: true,
    },
    {
        id: "clerk_user_id",
        label: "Owner",
        children: "Owner",
        defaultWidth: 200,
        allowsSorting: true,
    },
    {
        id: "created_at",
        label: "Created",
        children: "Created",
        defaultWidth: 190,
        allowsSorting: true,
    },
    {
        id: "updated_at",
        label: "Updated",
        children: "Updated",
        defaultWidth: 190,
        allowsSorting: true,
    },
    {
        id: "s3_object_key",
        label: "S3 object key",
        children: "S3 object key",
        defaultWidth: 320,
        allowsSorting: true,
    },
    {
        id: "storage_object_id",
        label: "Object ID",
        children: "Object ID",
        defaultWidth: 300,
        allowsSorting: true,
    },
    {
        id: "user_id",
        label: "Owner ID",
        children: "Owner ID",
        defaultWidth: 300,
        allowsSorting: true,
    },
    {
        id: "actions",
        label: "Actions",
        children: <VisuallyHidden>Actions</VisuallyHidden>,
        width: 64,
        minWidth: 64,
    },
];

export const TOGGLEABLE_STORAGE_COLUMNS = STORAGE_COLUMNS.filter(
    (column) => column.id !== "actions",
);

function toColumnProps({ label: _label, ...column }: StorageColumnDef) {
    return column;
}

interface StorageTableProps {
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
}

export function StorageTable(props: StorageTableProps): React.ReactNode {
    const {
        items,
        visibleColumns,
        sortDescriptor,
        onSortChange,
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

    const columns = useMemo(() => {
        const visible = STORAGE_COLUMNS.filter(
            (column) =>
                column.id === "actions" ||
                visibleColumns === "all" ||
                visibleColumns.has(column.id),
        );

        // A table with selection needs exactly one row header column.
        const headerIndex = visible.findIndex(
            (column) => column.id !== "actions",
        );
        return visible.map((column, index) =>
            index === headerIndex ? { ...column, isRowHeader: true } : column,
        );
    }, [visibleColumns]);

    return (
        <Table
            aria-label="Storage objects"
            selectionMode="multiple"
            selectedKeys={selectedKeys}
            onSelectionChange={onSelectionChange}
            sortDescriptor={sortDescriptor}
            onSortChange={onSortChange}
            className="hidden h-[420px] max-h-[420px] w-full min-w-0 md:block"
        >
            <TableHeader columns={columns}>
                {(column) => <Column {...toColumnProps(column)} />}
            </TableHeader>
            <TableBody
                items={items}
                dependencies={[columns, canDelete]}
                renderEmptyState={() => emptyMessage}
            >
                {(item) => (
                    <Row id={item.s3_object_key} columns={columns}>
                        {(column) => {
                            switch (column.id) {
                                case "file_name":
                                    return (
                                        <Cell textValue={item.file_name}>
                                            <span className="truncate">
                                                {item.file_name}
                                            </span>
                                        </Cell>
                                    );
                                case "public":
                                    return (
                                        <Cell
                                            textValue={
                                                item.public
                                                    ? "Public"
                                                    : "Private"
                                            }
                                        >
                                            <VisibilityBadge
                                                isPublic={item.public}
                                            />
                                        </Cell>
                                    );
                                case "clerk_user_id":
                                    return <Cell>{item.clerk_user_id}</Cell>;
                                case "created_at":
                                    return (
                                        <Cell>
                                            {formatTimestamp(item.created_at)}
                                        </Cell>
                                    );
                                case "updated_at":
                                    return (
                                        <Cell>
                                            {formatTimestamp(item.updated_at)}
                                        </Cell>
                                    );
                                case "s3_object_key":
                                    return <Cell>{item.s3_object_key}</Cell>;
                                case "storage_object_id":
                                    return (
                                        <Cell>{item.storage_object_id}</Cell>
                                    );
                                case "user_id":
                                    return <Cell>{item.user_id}</Cell>;
                                case "actions":
                                    return (
                                        <Cell textValue="Actions">
                                            <StorageActionMenu
                                                item={item}
                                                bucketName={bucketName}
                                                userId={userId}
                                                canDelete={canDelete}
                                                onCopy={onCopy}
                                                onDelete={onDelete}
                                                onError={onError}
                                            />
                                        </Cell>
                                    );
                                default:
                                    return <Cell />;
                            }
                        }}
                    </Row>
                )}
            </TableBody>
        </Table>
    );
}
