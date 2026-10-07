import { queryOptions } from "@tanstack/react-query";
import { JobFailedError, requestJob } from "@/server/requestJob";
import { storageBasePath } from "./paths.ts";

export function dStorageBucketExistsQueryKey(bucketName: string) {
    return ["get", "dStorage", "bucket", { bucketName }];
}

export default function createBucketExistsGetQueryOptions({
    bucketName,
}: {
    bucketName: string;
}) {
    return queryOptions<boolean>({
        queryKey: dStorageBucketExistsQueryKey(bucketName),
        queryFn: async function () {
            try {
                await requestJob({
                    method: "GET",
                    url: storageBasePath(bucketName),
                });
                return true;
            } catch (error) {
                if (error instanceof JobFailedError && error.status === 404) {
                    return false;
                }
                throw error;
            }
        },
        enabled: Boolean(bucketName),
    });
}
