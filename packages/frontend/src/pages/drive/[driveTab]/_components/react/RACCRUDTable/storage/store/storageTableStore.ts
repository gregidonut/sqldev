import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
    Key,
    Selection,
    SortDescriptor,
    SortDirection,
} from "react-aria-components/Table";
import {
    TOGGLEABLE_STORAGE_COLUMNS,
    type StorageColumnId,
} from "../StorageTable.tsx";
import type { StorageRow } from "../../queryOptions/types.ts";

type ToggleableStorageColumnId = Exclude<StorageColumnId, "actions">;

type StorageSort = {
    readonly column: ToggleableStorageColumnId;
    readonly direction: SortDirection;
};

type StorageDialog =
    | { readonly kind: "closed" }
    | { readonly kind: "copy"; readonly item: StorageRow }
    | { readonly kind: "delete"; readonly item: StorageRow }
    | { readonly kind: "batch-delete" };

type ActiveStorageDialog = Exclude<StorageDialog, { readonly kind: "closed" }>;

type StorageTablePreferences = {
    readonly visibleColumns: readonly ToggleableStorageColumnId[];
    readonly sort: StorageSort;
};

interface StorageTableStore {
    readonly search: string;
    readonly setSearch: (search: string) => void;
    readonly sort: StorageSort;
    readonly setSort: (sort: StorageSort) => void;
    readonly visibleColumns: readonly ToggleableStorageColumnId[];
    readonly setVisibleColumns: (selection: Selection) => void;
    readonly selectedKeys: Selection;
    readonly setSelectedKeys: (keys: Selection) => void;
    readonly clearSelection: () => void;
    readonly dialog: StorageDialog;
    readonly openDialog: (dialog: ActiveStorageDialog) => void;
    readonly closeDialog: () => void;
    readonly actionError: string | null;
    readonly setActionError: (actionError: string | null) => void;
}

const DEFAULT_VISIBLE_COLUMNS = [
    "file_name",
    "public",
    "clerk_user_id",
    "created_at",
    "updated_at",
] as const satisfies readonly ToggleableStorageColumnId[];

const DEFAULT_SORT = {
    column: "updated_at",
    direction: "descending",
} as const satisfies StorageSort;

const STORAGE_TABLE_STORAGE_KEY = "sqldev:drive:storage-table";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isToggleableColumnId(
    value: unknown,
): value is ToggleableStorageColumnId {
    return (
        typeof value === "string" &&
        TOGGLEABLE_STORAGE_COLUMNS.some(function (column) {
            return column.id === value;
        })
    );
}

function isSortDirection(value: unknown): value is SortDirection {
    return value === "ascending" || value === "descending";
}

function toggleableColumnIds(): readonly ToggleableStorageColumnId[] {
    return TOGGLEABLE_STORAGE_COLUMNS.flatMap(function (column) {
        return isToggleableColumnId(column.id) ? [column.id] : [];
    });
}

function selectionToColumnIds(
    selection: Selection,
): readonly ToggleableStorageColumnId[] {
    if (selection === "all") {
        return toggleableColumnIds();
    }
    const columns: ToggleableStorageColumnId[] = [];
    for (const key of selection) {
        if (isToggleableColumnId(key) && !columns.includes(key)) {
            columns.push(key);
        }
    }
    return columns.length > 0 ? columns : DEFAULT_VISIBLE_COLUMNS;
}

function parseVisibleColumns(
    value: unknown,
): readonly ToggleableStorageColumnId[] {
    if (!Array.isArray(value)) {
        return DEFAULT_VISIBLE_COLUMNS;
    }
    const columns: ToggleableStorageColumnId[] = [];
    for (const entry of value) {
        if (isToggleableColumnId(entry) && !columns.includes(entry)) {
            columns.push(entry);
        }
    }
    return columns.length > 0 ? columns : DEFAULT_VISIBLE_COLUMNS;
}

function parseSort(value: unknown): StorageSort {
    if (!isRecord(value)) {
        return DEFAULT_SORT;
    }
    return {
        column: isToggleableColumnId(value.column)
            ? value.column
            : DEFAULT_SORT.column,
        direction: isSortDirection(value.direction)
            ? value.direction
            : DEFAULT_SORT.direction,
    };
}

function partialize(state: StorageTableStore): StorageTablePreferences {
    return {
        visibleColumns: state.visibleColumns,
        sort: state.sort,
    };
}

function mergePreferences(
    persistedState: unknown,
    currentState: StorageTableStore,
): StorageTableStore {
    if (!isRecord(persistedState)) {
        return currentState;
    }
    return {
        ...currentState,
        visibleColumns: parseVisibleColumns(persistedState.visibleColumns),
        sort: parseSort(persistedState.sort),
    };
}

export function toStorageSort(
    descriptor: SortDescriptor,
): StorageSort | undefined {
    if (!isToggleableColumnId(descriptor.column)) {
        return undefined;
    }
    return {
        column: descriptor.column,
        direction:
            descriptor.direction === "ascending" ? "ascending" : "descending",
    };
}

export const useStorageTableStore = create<StorageTableStore>()(
    persist(
        function (set) {
            return {
                search: "",
                setSearch: function (search) {
                    set({ search });
                },
                sort: DEFAULT_SORT,
                setSort: function (sort) {
                    set({ sort });
                },
                visibleColumns: DEFAULT_VISIBLE_COLUMNS,
                setVisibleColumns: function (selection) {
                    set({ visibleColumns: selectionToColumnIds(selection) });
                },
                selectedKeys: new Set<Key>(),
                setSelectedKeys: function (selectedKeys) {
                    set({ selectedKeys });
                },
                clearSelection: function () {
                    set({ selectedKeys: new Set<Key>() });
                },
                dialog: { kind: "closed" },
                openDialog: function (dialog) {
                    set({ dialog, actionError: null });
                },
                closeDialog: function () {
                    set({ dialog: { kind: "closed" } });
                },
                actionError: null,
                setActionError: function (actionError) {
                    set({ actionError });
                },
            };
        },
        {
            name: STORAGE_TABLE_STORAGE_KEY,
            version: 1,
            partialize,
            merge: mergePreferences,
        },
    ),
);
