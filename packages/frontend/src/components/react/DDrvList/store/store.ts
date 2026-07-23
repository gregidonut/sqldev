import { create } from "zustand";
import type { ViewMap } from "@/components/react/DDrvList/viewMap.ts";

interface ListStore {
    currentView: keyof ViewMap | null;
    setCurrentView: (view: keyof ViewMap) => void;
    isEditing: boolean;
    setIsEditing: (isEditing: boolean) => void;
    postId: string;
    setPostId: (postId: string) => void;
}

export const useListStore = create<ListStore>(function (set) {
    return {
        currentView: null,
        setCurrentView: function (currentView) {
            set(function (state) {
                return { ...state, currentView };
            });
        },
        isEditing: false,
        setIsEditing: function (isEditing) {
            set(function (state) {
                return { ...state, isEditing };
            });
        },
        postId: "",
        setPostId: function (postId) {
            set(function (state) {
                return { ...state, postId };
            });
        },
    };
});
