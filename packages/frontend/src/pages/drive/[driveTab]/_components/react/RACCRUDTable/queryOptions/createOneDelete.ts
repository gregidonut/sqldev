import { mutationOptions, useQueryClient } from "@tanstack/react-query";
import { requestJob } from "@/server/requestJob";
import { storageBasePath } from "./paths.ts";
import { dStorageListKeyPrefix } from "./createListGet.ts";

export type OneDeleteVariables = {
    key: string;
};

export default function createOneDeleteMutationOptions({
    userId,
    bucketName,
}: {
    userId: string;
    bucketName: string;
}) {
    const queryClient = useQueryClient();

    return mutationOptions({
        mutationFn: function ({ key }: OneDeleteVariables) {
            return requestJob({
                method: "DELETE",
                url: `${storageBasePath(bucketName)}/objects/object`,
                params: { key },
            });
        },
        onSuccess: () =>
            queryClient.invalidateQueries({
                queryKey: dStorageListKeyPrefix(userId),
            }),
    });
}
