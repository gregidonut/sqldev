import type {
    PostsViewRow,
    TodoSpacesViewRow,
} from "@/utils/supabase/models/aliases.ts";
import type { Database } from "@/utils/supabase/models";

/**
 * View types and plain data maps for DDrvList.
 *
 * This module is deliberately free of React component imports so type-only and
 * data-only consumers (query option factories, stores) do not transitively pull
 * in list-item UI (and, through the editor, the reusable MDX editor). The React
 * component registry lives in `viewMap.ts`.
 */
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
