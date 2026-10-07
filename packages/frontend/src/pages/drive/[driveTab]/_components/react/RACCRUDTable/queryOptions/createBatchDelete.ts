import { mutationOptions, useQueryClient } from "@tanstack/react-query";
import { requestJob } from "@/server/requestJob";
import { storageBasePath } from "./paths.ts";
import { dStorageListKeyPrefix } from "./createListGet.ts";

export type BatchDeleteVariables = {
    keys: string[];
};

export default function createBatchDeleteMutationOptions({
    userId,
    bucketName,
}: {
    userId: string;
    bucketName: string;
}) {
    const queryClient = useQueryClient();

    return mutationOptions({
        mutationFn: function ({ keys }: BatchDeleteVariables) {
            // Raw key strings; the proxy expands them into ObjectKeyRef objects.
            return requestJob({
                method: "DELETE",
                url: `${storageBasePath(bucketName)}/objects`,
                data: { keys },
            });
        },
        onSuccess: () =>
            queryClient.invalidateQueries({
                queryKey: dStorageListKeyPrefix(userId),
            }),
    });
}
