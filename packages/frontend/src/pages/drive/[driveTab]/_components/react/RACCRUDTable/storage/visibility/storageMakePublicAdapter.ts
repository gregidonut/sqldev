import type { QueryClient } from "@tanstack/react-query";
import type { ConfirmableOperationAdapter } from "@/utils/confirmation/protocol";
import { requestConfirmation } from "../../queryOptions/createConfirmPost.ts";
import { dStorageListKeyPrefix } from "../../queryOptions/createListGet.ts";
import { requestVisibilityChange } from "../../queryOptions/createVisibilityPost.ts";

/**
 * Making a drive object public: transport and final-success invalidation only.
 * The server decides this needs a confirmation and returns the dialog text with
 * it, so this adapter holds no title, description or button label. The dialog
 * host calls these functions and never learns that the operation is about storage.
 */
export function createStorageMakePublicAdapter({
    bucketName,
    userId,
    queryClient,
}: {
    bucketName: string;
    userId: string;
    queryClient: QueryClient;
}): ConfirmableOperationAdapter<"storage.visibility.make_public"> {
    return {
        kind: "storage.visibility.make_public",
        initiate(subject, key, signal) {
            return requestVisibilityChange(
                {
                    bucketName,
                    target: subject.target,
                    expectedRevision: subject.expectedRevision,
                    visibility: "public",
                },
                key,
                signal,
            );
        },
        confirm(challenge, key) {
            return requestConfirmation(challenge, key);
        },
        onFinalSuccess() {
            // Refresh every tab's list for this user, once the change has committed.
            void queryClient.invalidateQueries({
                queryKey: dStorageListKeyPrefix(userId),
            });
        },
    };
}
