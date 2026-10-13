import {
    mutationOptions,
    type QueryClient,
} from "@tanstack/react-query";
import { requestJob } from "@/server/requestJob";
import type { IgPostsView } from "./createIgPostMutationOptions.ts";

export type UpdateIgPostDependencies = Readonly<{
    queryClient: QueryClient;
    view: IgPostsView;
    userId: string;
}>;

/**
 * Pure mutation-option factory for Instagram post updates.
 *
 * The `QueryClient`, view, and user id are explicit dependencies; the factory
 * performs no React hook calls and no Zustand reads. It preserves the existing
 * update contract exactly: `PATCH /api/views/igPosts/one/patch` through
 * `requestJob` with `FormData` (`p_post_id`, `p_text_content`) and
 * `multipart/form-data`, invalidating `['get', view, 'list', { userId }]` on
 * success only.
 */
export default function updateIgPostMutationOptions({
    queryClient,
    view,
    userId,
}: UpdateIgPostDependencies) {
    return mutationOptions<void, Error, FormData>({
        mutationFn: async function (data: FormData) {
            await requestJob({
                method: "PATCH",
                url: `/api/views/${view}/one/patch`,
                data,
                headers: { "Content-Type": "multipart/form-data" },
            });
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({
                queryKey: ["get", view, "list", { userId }],
            });
        },
        onError: (error) => console.log(error),
    });
}
