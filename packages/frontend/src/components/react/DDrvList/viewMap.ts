import type { ComponentType } from "react";
import type { PostsViewRow } from "@/utils/supabase/models/aliases.ts";
import ListItemUI from "@/components/react/DDrvList/DDrvListUI/ListItemUI.tsx";

export type ViewMap = {
    igPosts: PostsViewRow;
};

export const itemComponents: {
    [K in keyof ViewMap]: ComponentType<{ post: ViewMap[K]; view: K }>;
} = {
    igPosts: ListItemUI,
};
