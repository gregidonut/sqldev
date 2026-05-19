import { queryOptions } from "@tanstack/react-query";
import axios from "axios";
import type { Database } from "@/utils/supabase/models";

type PostViewRow = Database["public"]["Views"]["ig_posts_view"]["Row"];

export default function createIgPostsOneGetQueryOptions(
    postId: string,
    userId: string,
) {
    return queryOptions<PostViewRow>({
        queryKey: [
            "get",
            "igPost",
            "one",
            {
                userId,
            },
            postId,
        ],
        queryFn: async function () {
            const { data } = await axios<PostViewRow>(
                `/api/igPosts/one/get/${postId}`,
                { method: "GET" },
            );
            return data;
        },
    });
}
