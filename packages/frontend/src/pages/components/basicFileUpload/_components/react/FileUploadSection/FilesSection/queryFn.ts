// import {type Database} from "@/utils/supabase/models";
import axios from "axios";

export async function queryFn() {
    const { data } = await axios({
        method: "get",
        url: "/api/igAttachments/get",
    });
    return data;
}
