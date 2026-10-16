import type { ObjectsTab } from "@/utils/storage/objectsTab";
import type { StorageRow } from "../../queryOptions/types.ts";

export type VisibilityAction = "make-public" | "make-private";

/**
 * Which visibility action a row's menu offers. Only the owner's own tab does: the
 * other tabs list objects the viewer does not own, and the database would refuse
 * the change anyway. A private object offers "make public", a public one the
 * reverse. It never offers both and never offers neither on `mine`.
 */
export function visibilityActionFor(
    tab: ObjectsTab,
    row: Pick<StorageRow, "public">,
): VisibilityAction | null {
    if (tab !== "mine") {
        return null;
    }
    return row.public ? "make-private" : "make-public";
}

/** What the table hands to every row menu, so the three views stay in step. */
export type StorageVisibilityMenu = {
    readonly actionFor: (row: StorageRow) => VisibilityAction | null;
    /** True while a change for this row is in flight, so it can't be repeated. */
    readonly isPending: (row: StorageRow) => boolean;
    /** `trigger` is the menu button, so focus can return to it afterwards. */
    readonly invoke: (row: StorageRow, trigger: HTMLElement | null) => void;
};

export function visibilityMenuLabel(action: VisibilityAction): string {
    return action === "make-public" ? "Make public…" : "Make private";
}

/**
 * The page-level error for a direct change (making an object private) that did
 * not commit. A rejection is a normal answer, not a crash, so it reads as advice.
 */
export function directChangeFailureMessage(
    label: string,
    outcome: "forbidden" | "stale_revision" | "other",
): string {
    switch (outcome) {
        case "forbidden":
            return `You can't change who can see “${label}”.`;
        case "stale_revision":
            return `“${label}” changed since this list loaded. Reload the page and try again.`;
        case "other":
            return `Could not make “${label}” private.`;
    }
}
