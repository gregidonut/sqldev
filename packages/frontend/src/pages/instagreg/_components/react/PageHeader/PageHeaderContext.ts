import { createContext, useContext } from "react";

export const PageHeaderContext = createContext<string>("");

export function usePageHeader() {
    return useContext(PageHeaderContext);
}
