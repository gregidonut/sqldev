import { mutationOptions } from "@tanstack/react-query";
import axios from "axios";
import type { Database } from "@/utils/supabase/models";
import useStore from "../store/postsViewStore.ts";

function submitForm(data: FormData) {
    return axios<Database["public"]["Functions"]["update_ig_post"]["Args"]>({
        method: "PATCH",
        url: "/api/igPosts/one/patch",
        data,
        headers: { "Content-Type": "multipart/form-data" },
    });
}

export default function createIgPostsOnePatchMutationOptions(
    reset: () => void,
) {
    return mutationOptions({
        mutationFn: submitForm,
        onSuccess: () => {
            reset();
            useStore.setState({ isEditing: false });
        },
        onError: (error) => console.log(error),
    });
}
