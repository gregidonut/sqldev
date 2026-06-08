import { create } from "zustand";
import type { ViewMap } from "@/components/react/DDrvList/viewMap.ts";

interface ViewStore {
    isEditing: boolean;
    setIsEditing: (isEditing: boolean) => void;
    postId: string;
    setPostId: (postId: string) => void;
}

function createViewStore() {
    return create<ViewStore>(function (set) {
        return {
            isEditing: false,
            setIsEditing: (isEditing) =>
                set((state) => ({ ...state, isEditing })),
            postId: "",
            setPostId: (postId) => set((state) => ({ ...state, postId })),
        };
    });
}

export const viewStores: {
    [K in keyof ViewMap]: ReturnType<typeof createViewStore>;
} = {
    igPosts: createViewStore(),
};
