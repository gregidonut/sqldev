import { mutationOptions } from "@tanstack/react-query";
import axios from "axios";
import type { CreateTdsTodoArgs } from "@/utils/supabase/models/aliases.ts";

export default function createTdsTodoMutationOptions() {
    return mutationOptions({
        mutationFn: async function (data: CreateTdsTodoArgs) {
            await axios({
                method: "post",
                url: `/api/views/tdsTodos/${data.p_todo_space_id}/new/post`,
                data,
                headers: { "Content-Type": "multipart/form-data" },
            });
        },
        onError: (error) => console.log(error),
    });
}
