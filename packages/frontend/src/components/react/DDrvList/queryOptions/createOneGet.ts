import { queryOptions } from "@tanstack/react-query";
import { requestJob } from "@/server/requestJob";
import { useListStore } from "@/components/react/DDrvList/store/store.ts";
import type { ViewMap } from "@/components/react/DDrvList/viewMap.ts";

export default function createOneGetQueryOptions<K extends keyof ViewMap>(
    itemId: string,
    userId: string,
) {
    const { currentView: view } = useListStore();
    return queryOptions<ViewMap[K]>({
        queryKey: [
            "get",
            view,
            "one",
            {
                userId,
            },
            itemId,
        ],
        queryFn: async function () {
            return requestJob<ViewMap[K]>({
                method: "GET",
                url: `/api/views/${view}/one/get/${itemId}`,
            });
        },
    });
}
