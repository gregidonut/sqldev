import axios from "axios";
import { mutationOptions, useQueryClient } from "@tanstack/react-query";
import { storageBasePath } from "./paths.ts";
import { dStorageListKeyPrefix } from "./createListGet.ts";

export type UploadVariables = {
    file: File;
    fileName?: string;
};

export default function createUploadPostMutationOptions({
    userId,
    bucketName,
}: {
    userId: string;
    bucketName: string;
}) {
    const queryClient = useQueryClient();

    return mutationOptions({
        mutationFn: function ({ file, fileName }: UploadVariables) {
            const body = new FormData();
            body.append("file", file);

            // Content-Type is left unset so the browser supplies the multipart
            // boundary the Go handler needs to find the "file" part.
            return axios({
                method: "POST",
                url: `${storageBasePath(bucketName)}/objects`,
                params: { fileName: fileName ?? file.name },
                data: body,
            });
        },
        onSuccess: () =>
            queryClient.invalidateQueries({
                queryKey: dStorageListKeyPrefix(userId),
            }),
    });
}
