import axios from "axios";
import { mutationOptions, useQueryClient } from "@tanstack/react-query";
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
            return axios({
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
