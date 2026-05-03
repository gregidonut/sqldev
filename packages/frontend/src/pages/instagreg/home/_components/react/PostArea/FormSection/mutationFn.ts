import { type Database } from "@/utils/supabase/models";
import axios from "axios";

export function mutationFn(
    data: Database["public"]["Functions"]["create_ig_post"]["Args"],
) {
    return axios({
        method: "post",
        url: "/api/igPosts/new/post",
        data,
        headers: { "Content-Type": "multipart/form-data" },
    });
}
