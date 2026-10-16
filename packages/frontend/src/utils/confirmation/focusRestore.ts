export type FocusTargets = {
    /** The menu trigger that opened the dialog, if it was captured. */
    readonly origin: HTMLElement | null;
    /** React Aria row key (`data-key`) of the object the dialog was about. */
    readonly rowKey: string;
};

function isUsable(
    element: HTMLElement | null,
    doc: Document,
): element is HTMLElement {
    if (element === null || !doc.contains(element)) {
        return false;
    }
    if (
        (element as HTMLButtonElement).disabled === true ||
        element.getAttribute("aria-disabled") === "true" ||
        element.closest("[inert]") !== null
    ) {
        return false;
    }
    return true;
}

/** The detailed view renders a list and a table; CSS hides one, so skip the hidden copy. */
function isVisible(element: HTMLElement): boolean {
    if (element.hidden) {
        return false;
    }
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    return (
        style === undefined ||
        (style.display !== "none" && style.visibility !== "hidden")
    );
}

/**
 * Where focus should land after the dialog closes, in order: the menu trigger,
 * the object's row (or tile), then the page heading. Focus never falls to `body`
 * unless the page has no heading at all.
 */
export function resolveFocusTarget(
    { origin, rowKey }: FocusTargets,
    doc: Document = document,
): HTMLElement | null {
    if (isUsable(origin, doc) && isVisible(origin)) {
        return origin;
    }
    // Compare the attribute instead of building a selector: row keys are S3 object
    // keys and may contain quotes, brackets or backslashes.
    for (const row of doc.querySelectorAll<HTMLElement>("[data-key]")) {
        if (
            row.getAttribute("data-key") === rowKey &&
            isUsable(row, doc) &&
            isVisible(row)
        ) {
            return row;
        }
    }
    const heading = doc.querySelector<HTMLElement>("h1");
    if (heading !== null) {
        if (!heading.hasAttribute("tabindex")) {
            // A heading is not focusable by default; -1 makes it programmatically focusable.
            heading.setAttribute("tabindex", "-1");
        }
        return heading;
    }
    return null;
}
