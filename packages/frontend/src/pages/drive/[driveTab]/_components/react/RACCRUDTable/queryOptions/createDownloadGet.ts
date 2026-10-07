import axios from "axios";
import { queryOptions } from "@tanstack/react-query";
import { requestJob } from "@/server/requestJob";
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
            const result = await requestJob<{ url: string }>({
                method: "GET",
                url: `${storageBasePath(bucketName)}/objects/download`,
                params: { key },
            });
            const { data } = await axios.get<Blob>(result.url, {
                responseType: "blob",
            });
            return data;
        },
        enabled: Boolean(bucketName) && Boolean(key),
        staleTime: 1000 * 60 * 60 * 24 * 6, // 6 days
    });
}
