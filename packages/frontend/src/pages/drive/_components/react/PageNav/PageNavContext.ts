import { createContext, useContext } from "react";
import type { ObjectsTab } from "@/utils/storage/objectsTab";

export const PageNavContext = createContext<ObjectsTab>("public");

export function usePageNav() {
    return useContext(PageNavContext);
}
