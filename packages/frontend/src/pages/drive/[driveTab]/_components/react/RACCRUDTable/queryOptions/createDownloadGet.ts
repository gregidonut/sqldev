import axios from "axios";
import { queryOptions } from "@tanstack/react-query";
import { storageBasePath } from "./paths.ts";

export function dStorageDownloadQueryKey(
    userId: string,
    bucketName: string,
    key: string,
) {
    return ["get", "dStorage", "download", { userId }, { bucketName, key }];
}

export default function createDownloadGetQueryOptions({
    userId,
    bucketName,
    key,
}: {
    userId: string;
    bucketName: string;
    key: string;
}) {
    return queryOptions<Blob>({
        queryKey: dStorageDownloadQueryKey(userId, bucketName, key),
        queryFn: async function () {
            const { data } = await axios<Blob>({
                method: "GET",
                url: `${storageBasePath(bucketName)}/objects/download`,
                params: { key },
                responseType: "blob",
            });
            return data;
        },
        enabled: Boolean(bucketName) && Boolean(key),
        staleTime: 1000 * 60 * 60 * 24 * 6, // 6 days
    });
}
