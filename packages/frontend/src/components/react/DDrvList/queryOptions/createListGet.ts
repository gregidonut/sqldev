import { queryOptions } from "@tanstack/react-query";
import { requestJob } from "@/server/requestJob";
import type { ViewMap } from "@/components/react/DDrvList/viewMap";
import { useListStore } from "@/components/react/DDrvList/store/store.ts";

export default function createListGetQueryOptions<K extends keyof ViewMap>(
    userId: string,
) {
    const { currentView: view } = useListStore();
    return queryOptions<ViewMap[K][]>({
        queryKey: ["get", view, "list", { userId }],
        queryFn: async function () {
            const data = await requestJob<ViewMap[K][]>({
                method: "GET",
                url: `/api/views/${view}/list/get`,
            });
            return Array.isArray(data) ? data : [];
        },
    });
}
