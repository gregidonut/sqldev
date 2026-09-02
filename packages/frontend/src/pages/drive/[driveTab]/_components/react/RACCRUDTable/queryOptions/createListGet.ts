import axios from "axios";
import { queryOptions } from "@tanstack/react-query";
import { parseObjectKey } from "@/utils/storage/objectKey";
import type { ObjectsTab } from "@/utils/storage/objectsTab";
import { storageBasePath } from "./paths.ts";
import type { StorageListItem, StorageRow } from "./types.ts";

export function dStorageListKeyPrefix(userId: string) {
    return ["get", "dStorage", "list", { userId }] as const;
}

export function dStorageListQueryKey(
    userId: string,
    bucketName: string,
    tab: ObjectsTab,
) {
    return [...dStorageListKeyPrefix(userId), { bucketName, tab }] as const;
}

// The proxy returns S3 keys only, so the display columns are recovered from the
// key itself rather than a second round trip.
function toStorageRow(item: StorageListItem): StorageRow | null {
    try {
        return { ...parseObjectKey(item.key), key: item.key };
    } catch {
        return null;
    }
}

export default function createListGetQueryOptions({
    userId,
    bucketName,
    tab,
}: {
    userId: string;
    bucketName: string;
    tab: ObjectsTab;
}) {
    return queryOptions<StorageRow[]>({
        queryKey: dStorageListQueryKey(userId, bucketName, tab),
        queryFn: async function () {
            const { data } = await axios<StorageListItem[]>({
                method: "GET",
                url: `${storageBasePath(bucketName)}/objects`,
                params: { tab },
            });
            return data
                .map(toStorageRow)
                .filter((row): row is StorageRow => row !== null);
        },
        enabled: Boolean(bucketName),
    });
}
