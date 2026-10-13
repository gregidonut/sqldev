import { queryOptions } from "@tanstack/react-query";
import { requestJob } from "@/server/requestJob";
import type { PostsViewRow } from "@/utils/supabase/models/aliases.ts";
import type { IgPostsView } from "./createIgPostMutationOptions.ts";

export type GetIgPostDependencies = Readonly<{
    view: IgPostsView;
    userId: string;
    itemId: string;
}>;

/**
 * Pure query-option factory for fetching one Instagram post for editing.
 *
 * View, user id, and item id are explicit dependencies; the factory performs no
 * React hook calls and no Zustand reads. It preserves the existing fetch-one
 * contract exactly: query key `['get', view, 'one', { userId }, itemId]` and a
 * `GET /api/views/igPosts/one/get/{itemId}` request through `requestJob`, so the
 * synchronous / 202-poll / cancel / failure semantics are unchanged.
 */
export default function getIgPostQueryOptions({
    view,
    userId,
    itemId,
}: GetIgPostDependencies) {
    return queryOptions<PostsViewRow>({
        queryKey: ["get", view, "one", { userId }, itemId],
        queryFn: async function () {
            return requestJob<PostsViewRow>({
                method: "GET",
                url: `/api/views/${view}/one/get/${itemId}`,
            });
        },
    });
}
