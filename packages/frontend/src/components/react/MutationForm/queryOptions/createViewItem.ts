import {
    mutationOptions,
    type QueryClient,
} from "@tanstack/react-query";
import { requestJob } from "@/server/requestJob";
import type { ViewMap } from "@/components/react/DDrvList/viewMap.types.ts";
import type {
    CreateIgPostArgs,
    CreateTdsTodoSpaceArgs,
} from "@/utils/supabase/models/aliases.ts";

type ViewCreateArgs = {
    igPosts: CreateIgPostArgs;
    tdsTodoSpaces: CreateTdsTodoSpaceArgs;
};

/**
 * Pure create-item mutation options for a DDrvList view.
 *
 * The `QueryClient` is an explicit dependency so the factory performs no React
 * hook calls and can be evaluated and tested in isolation. It preserves the
 * existing contract: `POST /api/views/{view}/new/item` through `requestJob`
 * with `multipart/form-data`, invalidating the `['get', view, 'list']` prefix
 * on success.
 */
export default function createViewItemMutationOptions<K extends keyof ViewMap>({
    queryClient,
    view,
}: {
    queryClient: QueryClient;
    view: K;
}) {
    return mutationOptions({
        mutationFn: async function (data: ViewCreateArgs[K]) {
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
