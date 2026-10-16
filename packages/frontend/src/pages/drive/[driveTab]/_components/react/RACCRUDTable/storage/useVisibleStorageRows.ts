import { useMemo } from "react";
import { useCollator, useFilter } from "react-aria";
import type { Key, SortDescriptor } from "react-aria-components/Table";
import type { StorageRow } from "../queryOptions/types.ts";

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

/** Rows matching the search text, ordered by the table's sort descriptor. */
export function useVisibleStorageRows(
    rows: StorageRow[] | undefined,
    search: string,
    sortDescriptor: SortDescriptor,
): StorageRow[] {
    const { contains } = useFilter({ sensitivity: "base" });
    const collator = useCollator();

    return useMemo(() => {
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
}
