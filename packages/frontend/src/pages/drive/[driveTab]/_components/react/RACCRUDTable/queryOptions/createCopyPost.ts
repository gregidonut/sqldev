import { mutationOptions, useQueryClient } from "@tanstack/react-query";
import { requestJob } from "@/server/requestJob";
import { storageBasePath } from "./paths.ts";
import { dStorageListKeyPrefix } from "./createListGet.ts";

export type CopyVariables = {
    key: string;
    destinationBucket: string;
    destinationFileName: string;
};

export default function createCopyPostMutationOptions({
    userId,
    bucketName,
}: {
    userId: string;
    bucketName: string;
}) {
    const queryClient = useQueryClient();

    return mutationOptions({
        mutationFn: function ({
            key,
            destinationBucket,
            destinationFileName,
        }: CopyVariables) {
            // The proxy resolves the destination ids itself, so the body only
            // carries the bucket and the requested file name.
            return requestJob({
                method: "POST",
                url: `${storageBasePath(bucketName)}/objects/copy`,
                params: { key },
                data: { destinationBucket, destinationFileName },
            });
        },
        onSuccess: () =>
            queryClient.invalidateQueries({
                queryKey: dStorageListKeyPrefix(userId),
            }),
    });
}
