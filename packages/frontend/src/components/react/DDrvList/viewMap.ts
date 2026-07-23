import type { ComponentType } from "react";
import type {
    PostsViewRow,
    TodoSpacesViewRow,
} from "@/utils/supabase/models/aliases.ts";
import type { Database } from "@/utils/supabase/models";
import ListItemUI from "@/components/react/DDrvList/DDrvListUI/ListItemUI.tsx";

export type ViewMap = {
    igPosts: PostsViewRow;
    tdsTodoSpaces: TodoSpacesViewRow;
};

export const viewIdKeys: { [K in keyof ViewMap]: keyof ViewMap[K] } = {
    igPosts: "post_id",
    tdsTodoSpaces: "todo_space_id",
};

export const viewTableMap: {
    [K in keyof ViewMap]: keyof Database["public"]["Views"];
} = {
    igPosts: "ig_posts_view",
    tdsTodoSpaces: "tds_todo_spaces_view",
};

export const viewRPCMap: {
    [K in keyof ViewMap]: {
        create: keyof Database["public"]["Functions"];
        update: keyof Database["public"]["Functions"];
    };
} = {
    igPosts: {
        create: "create_ig_post",
        update: "update_ig_post",
    },
    tdsTodoSpaces: {
        create: "create_tds_todo_space",
        update: "update_tds_todo_space",
    },
};

export const itemComponents: {
    [K in keyof ViewMap]: ComponentType<{ post: ViewMap[K]; view: K }>;
} = {
    igPosts: ListItemUI,
    tdsTodoSpaces: ListItemUI,
};
