import { mutationOptions, useQueryClient } from "@tanstack/react-query";
import { requestJob } from "@/server/requestJob";
import type { ViewMap } from "@/components/react/DDrvList/viewMap.ts";
import type {
    CreateIgPostArgs,
    CreateTdsTodoSpaceArgs,
} from "@/utils/supabase/models/aliases.ts";

type ViewCreateArgs = {
    igPosts: CreateIgPostArgs;
    tdsTodoSpaces: CreateTdsTodoSpaceArgs;
};

export default function createViewItemMutationOptions<K extends keyof ViewMap>({
    view,
}: {
    view: K;
}) {
    const queryClient = useQueryClient();

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
