import axios from "axios";
import { queryOptions } from "@tanstack/react-query";
import type { ViewMap } from "@/components/react/DDrvList/viewMap";
import { useListStore } from "@/components/react/DDrvList/store/store.ts";

export default function createListGetQueryOptions<K extends keyof ViewMap>(
    userId: string,
) {
    const { currentView: view } = useListStore();
    return queryOptions<ViewMap[K][]>({
        queryKey: ["get", view, "list", { userId }],
        queryFn: async function () {
            const response = await axios<ViewMap[K][]>({
                method: "GET",
                url: `/api/${view}/list/get`,
            });
            return response.data;
        },
    });
}
