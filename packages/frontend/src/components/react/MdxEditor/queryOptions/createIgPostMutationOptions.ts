import {
    mutationOptions,
    type QueryClient,
} from "@tanstack/react-query";
import { requestJob } from "@/server/requestJob";
import type { CreateIgPostArgs } from "@/utils/supabase/models/aliases.ts";

/** The Instagram view key the create contract targets. */
export type IgPostsView = "igPosts";

export type CreateIgPostDependencies = Readonly<{
    queryClient: QueryClient;
    view: IgPostsView;
}>;

/**
 * Pure mutation-option factory for Instagram post creation.
 *
 * The `QueryClient` and view are explicit dependencies; the factory performs no
 * React hook calls and no Zustand reads. It preserves the existing create
 * contract exactly: `POST /api/views/igPosts/new/item` through `requestJob`
 * with the `CreateIgPostArgs` payload and `multipart/form-data`, invalidating
 * the `['get', 'igPosts', 'list']` prefix on success only.
 */
export default function createIgPostMutationOptions({
    queryClient,
    view,
}: CreateIgPostDependencies) {
    return mutationOptions<void, Error, CreateIgPostArgs>({
        mutationFn: async function (data: CreateIgPostArgs) {
            await requestJob({
                method: "post",
                url: `/api/views/${view}/new/item`,
                data,
                headers: { "Content-Type": "multipart/form-data" },
            });
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({
                queryKey: ["get", view, "list"],
            });
        },
        onError: (error) => console.log(error),
    });
}
