import type { Database } from "@/utils/supabase/models";

export type ObjectsTab = Database["public"]["Enums"]["d_storage_objects_tab"];

export const OBJECTS_TABS = [
    "public",
    "mine",
    "shared_with_me",
] as const satisfies readonly ObjectsTab[];

export function parseObjectsTab(value: string | null): ObjectsTab {
    const trimmed = value?.trim();
    if (!trimmed) {
        throw new Error("tab is required");
    }

    const tab = OBJECTS_TABS.find((candidate) => candidate === trimmed);
    if (!tab) {
        throw new Error(`tab must be one of ${OBJECTS_TABS.join(", ")}`);
    }

    return tab;
}
