import { mutationOptions, useQueryClient } from "@tanstack/react-query";
import { requestJob } from "@/server/requestJob";
import type { ViewMap } from "@/components/react/DDrvList/viewMap.ts";

export default function createOnePatchMutationOptions({
    view,
    userId,
}: {
    view: keyof ViewMap;
    userId: string;
}) {
    const queryClient = useQueryClient();

    return mutationOptions({
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
