import { type Database } from "@/utils/supabase/models";
import axios from "axios";

export function mutationFn(
    data: Database["public"]["Functions"]["create_tds_todo"]["Args"],
) {
    console.log({ data });
    return axios({
        method: "post",
        url: `/api/views/tdsTodos/${data.p_todo_space_id}/new/post`,
        data,
        headers: { "Content-Type": "multipart/form-data" },
    });
}
