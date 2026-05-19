import { create } from "zustand";

interface PostsViewStore {
    isEditing: boolean;
    setIsEditing: (isEditing: boolean) => void;
    postId: string;
    setPostId: (postId: string) => void;
}

const usePostsViewStore = create<PostsViewStore>(function (set) {
    return {
        isEditing: false,
        setIsEditing: function (isEditing: boolean) {
            set(function (state) {
                return { ...state, isEditing };
            });
        },
        postId: "",
        setPostId: function (postId: string) {
            set(function (state) {
                return { ...state, postId };
            });
        },
    };
});

export default usePostsViewStore;
