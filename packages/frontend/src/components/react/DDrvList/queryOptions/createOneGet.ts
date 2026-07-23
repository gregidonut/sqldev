import { queryOptions } from "@tanstack/react-query";
import axios from "axios";
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
            const { data } = await axios<ViewMap[K]>({
                method: "GET",
                url: `/api/${view}/one/get/${itemId}`,
            });
            return data;
        },
    });
}
