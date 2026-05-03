import { createContext, useContext } from "react";
import { type Control } from "react-hook-form";
import { type Database } from "@/utils/supabase/models";

export const FormSectionContext = createContext<Control<
    Database["public"]["Functions"]["create_tds_todo"]["Args"]
> | null>(null);

export function useFormSection() {
    return useContext(FormSectionContext);
}
