import axios from "axios";
import { mutationOptions, useQueryClient } from "@tanstack/react-query";
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
            return axios({
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
