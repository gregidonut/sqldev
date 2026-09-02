import axios from "axios";
import { queryOptions } from "@tanstack/react-query";
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
            const { status } = await axios({
                method: "GET",
                url: storageBasePath(bucketName),
                // A missing bucket is an answer, not a failure.
                validateStatus: (candidate) =>
                    candidate === 200 || candidate === 404,
            });
            return status === 200;
        },
        enabled: Boolean(bucketName),
    });
}
