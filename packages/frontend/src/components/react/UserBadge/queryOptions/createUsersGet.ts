import axios from "axios";
import { queryOptions } from "@tanstack/react-query";

export default function createIgPostsUsersGetQueryOptions(
    userId: string,
    clerk_user_id: string,
) {
    return queryOptions({
        queryKey: [
            "get",
            "igPosts",
            {
                userId,
            },
            { user: clerk_user_id },
        ],
        queryFn: async function () {
            const response = await axios({
                url: `/api/users/get/${clerk_user_id}`,
                method: "GET",
            });
            return response.data;
        },
        enabled: Boolean(clerk_user_id),
        staleTime: 1000 * 60 * 60 * 24 * 6, // 6 days
    });
}
