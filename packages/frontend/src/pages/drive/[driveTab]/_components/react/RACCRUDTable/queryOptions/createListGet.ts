import { queryOptions } from "@tanstack/react-query";
import { requestJob } from "@/server/requestJob";
import type { ObjectsTab } from "@/utils/storage/objectsTab";
import { storageBasePath } from "./paths.ts";
import type { StorageRow } from "./types.ts";

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
            return requestJob<StorageRow[]>({
                method: "GET",
                url: `${storageBasePath(bucketName)}/objects`,
                params: { tab },
            });
        },
        enabled: Boolean(bucketName),
    });
}
