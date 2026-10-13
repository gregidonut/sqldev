import type { ComponentType } from "react";
import ListItemUI from "@/components/react/DDrvList/DDrvListUI/ListItemUI.tsx";
import {
    type ViewMap,
    viewIdKeys,
    viewTableMap,
    viewRPCMap,
} from "@/components/react/DDrvList/viewMap.types.ts";

// Re-export the pure types and data maps so existing value consumers keep their
// import path. The React component registry below is the only reason this
// module pulls in UI code.
export { type ViewMap, viewIdKeys, viewTableMap, viewRPCMap };

export const itemComponents: {
    [K in keyof ViewMap]: ComponentType<{ post: ViewMap[K]; view: K }>;
} = {
    igPosts: ListItemUI,
    tdsTodoSpaces: ListItemUI,
};
