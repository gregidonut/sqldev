import { mutationOptions } from "@tanstack/react-query";
import axios, { type AxiosResponse } from "axios";
import type { Database } from "@/utils/supabase/models";
import { viewStores } from "@/components/react/DDrvList/store/viewStore.ts";
import type { ViewMap } from "@/components/react/DDrvList/viewMap.ts";

export default function createOnePatchMutationOptions<K extends keyof ViewMap>(
    reset: () => void,
    view: K,
) {
    const usePostsViewStore = viewStores[view];
    const { setIsEditing } = usePostsViewStore();
    return mutationOptions({
        mutationFn: (function (): (
            data: FormData,
        ) => Promise<
            AxiosResponse<
                Database["public"]["Functions"]["update_ig_post"]["Args"]
            >
        > {
            switch (view) {
                case "igPosts":
                    return submitIgPostForm;
                default:
                    throw new Error(
                        "Invalid view from createOnePatchMutationOptions:",
                    );
            }
        })(),
        onSuccess: () => {
            reset();
            setIsEditing(false);
        },
        onError: (error) => console.log(error),
    });
}

function submitIgPostForm(data: FormData) {
    return axios<Database["public"]["Functions"]["update_ig_post"]["Args"]>({
        method: "PATCH",
        url: "/api/igPosts/one/patch",
        data,
        headers: { "Content-Type": "multipart/form-data" },
    });
}
