import { mutationOptions, useQueryClient } from "@tanstack/react-query";
import axios, { type AxiosResponse } from "axios";
import type { Database } from "@/utils/supabase/models";
import { useListStore } from "@/components/react/DDrvList/store/store.ts";
import {
    type ViewMap,
    viewRPCMap,
} from "@/components/react/DDrvList/viewMap.ts";

export default function createOnePatchMutationOptions(
    reset: () => void,
    userId: string,
) {
    const { currentView: view, setIsEditing } = useListStore();
    const queryClient = useQueryClient();

    return mutationOptions({
        mutationFn: submitIgPostForm,
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: ["get", view, "list", { userId }],
            });
            reset();
            setIsEditing(false);
        },
        onError: (error) => console.log(error),
    });
}

function submitIgPostForm(data: FormData) {
    const view = useListStore.getState().currentView;
    const rpcName = viewRPCMap[view as keyof ViewMap].update;

    return axios<Database["public"]["Functions"][typeof rpcName]["Args"]>({
        method: "PATCH",
        url: `/api/${view}/one/patch`,
        data,
        headers: { "Content-Type": "multipart/form-data" },
    });
}
