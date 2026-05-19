import axios from "axios";
import { queryOptions } from "@tanstack/react-query";
import type { Database } from "@/utils/supabase/models";

type PostView = Database["public"]["Views"]["ig_posts_view"]["Row"];

export default function createIgPostsListGetQueryOptions(userId: string) {
    return queryOptions<PostView[]>({
        queryKey: [
            "get",
            "igPosts",
            "list",
            {
                userId,
            },
        ],
        queryFn: async function () {
            const response = await axios<PostView[]>({
                method: "GET",
                url: "/api/igPosts/list/get",
            });
            return response.data;
        },
    });
}
