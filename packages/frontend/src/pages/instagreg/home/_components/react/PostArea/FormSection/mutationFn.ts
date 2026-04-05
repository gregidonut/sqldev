import { type Database } from "@/utils/supabase/models";
import axios from "axios";

export function mutationFn(
    data: Database["public"]["Functions"]["post_text"]["Args"],
) {
    return axios({
        method: "post",
        url: "/api/igPosts/new/post",
        data,
        headers: { "Content-Type": "multipart/form-data" },
    });
}
