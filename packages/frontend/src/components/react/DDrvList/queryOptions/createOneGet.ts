import { queryOptions } from "@tanstack/react-query";
import axios from "axios";
import type { PostsViewRow } from "@/utils/supabase/models/aliases.ts";
import type { ViewMap } from "@/components/react/DDrvList/viewMap.ts";

export default function createOneGetQueryOptions<K extends keyof ViewMap>(
    postId: string,
    userId: string,
    view: K,
) {
    return queryOptions<PostsViewRow>({
        queryKey: [
            "get",
            view,
            "one",
            {
                userId,
            },
            postId,
        ],
        queryFn: async function () {
            const { data } = await axios<PostsViewRow>({
                method: "GET",
                url: `/api/${view}/one/get/${postId}`,
            });
            return data;
        },
    });
}
