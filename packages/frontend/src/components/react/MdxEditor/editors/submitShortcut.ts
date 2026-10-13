/**
 * Shared, pure classification of the submit-shortcut keyboard gesture.
 *
 * The gesture is a modified Enter: Enter pressed with either the Control or the
 * Meta (Cmd) modifier. Plain Enter is never a submit gesture, so it remains a
 * newline for the active editor. Shift or Alt with Enter is also not the submit
 * gesture.
 */
export type KeyEventLike = Readonly<{
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
}>;

/** True only for Ctrl+Enter or Cmd+Enter. */
export function isSubmitShortcut(event: KeyEventLike): boolean {
    return event.key === "Enter" && (event.ctrlKey || event.metaKey);
}

/**
 * Classifies a keyboard event and, when it is the submit gesture and a callback
 * is configured, prevents the default newline and invokes the callback exactly
 * once. Returns true when the gesture was handled.
 *
 * `preventDefault` is injected so the same logic serves both React synthetic
 * events (DOM adapters) and CodeMirror key handlers.
 */
export function handleSubmitShortcut(
    event: KeyEventLike,
    preventDefault: () => void,
    onSubmitShortcut: (() => void) | undefined,
): boolean {
    if (!onSubmitShortcut) {
        return false;
    }
    if (!isSubmitShortcut(event)) {
        return false;
    }
    preventDefault();
    onSubmitShortcut();
    return true;
}
