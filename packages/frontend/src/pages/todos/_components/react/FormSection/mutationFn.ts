import { type Database } from "@/utils/supabase/models";
import axios from "axios";

export function mutationFn(
    data: Database["public"]["Functions"]["create_tds_todo_space"]["Args"],
) {
    console.log({ data });
    return axios({
        method: "post",
        url: `/api/views/tdsTodoSpaces/new/item`,
        data,
        headers: { "Content-Type": "multipart/form-data" },
    });
}
