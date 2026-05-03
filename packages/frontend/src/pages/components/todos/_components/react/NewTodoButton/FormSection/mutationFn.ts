import { type Database } from "@/utils/supabase/models";
import axios from "axios";

export function mutationFn(
    data: Database["public"]["Functions"]["create_tds_todo"]["Args"],
) {
    return axios({
        method: "post",
        url: "/api/tdsTodos/new/post",
        data,
        headers: { "Content-Type": "multipart/form-data" },
    });
}
