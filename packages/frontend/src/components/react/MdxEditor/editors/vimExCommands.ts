import { Vim, getCM } from "@replit/codemirror-vim";
import type { EditorView } from "@codemirror/view";
import type { CodeMirrorV } from "@replit/codemirror-vim";

/**
 * The Vim Ex commands this editor recognizes.
 *
 * `w` ("write") maps to the guarded submit; `wq` ("write-quit") submits and then
 * requests the editor be closed. Both are intentionally the Vim muscle-memory
 * for "save" / "save and exit".
 */
export type VimExCommand = "w" | "wq";

/**
 * Imperative affordances a Vim Ex command may trigger. Both are optional and
 * independent: a consumer may wire submit without a close affordance (for
 * example, the create form has no edit state to leave). Both absences are
 * legitimate states, so this is modeled as two optional callbacks rather than a
 * discriminated union — there is no nonsensical combination to forbid.
 */
export type VimExHandlers = Readonly<{
    submit?: () => void;
    close?: () => void;
}>;

/**
 * Pure dispatcher for a recognized Vim Ex command.
 *
 * `:w` and `:wq` both submit first; `:wq` additionally requests close strictly
 * after submit. Missing handlers are a safe no-op (never a throw), so a command
 * issued when nothing is wired does nothing. Pure: it only invokes the supplied
 * callbacks and has no CodeMirror dependency, which makes it directly testable.
 */
export function dispatchExCommand(
    command: VimExCommand,
    handlers: VimExHandlers,
): void {
    handlers.submit?.();
    if (command === "wq") {
        handlers.close?.();
    }
}

/**
 * Per-view handler registry.
 *
 * `Vim.defineEx` registers commands module-globally across every mounted
 * `EditorView`, so a command closure cannot safely capture any single mount's
 * callbacks. Instead, each live view records its current handlers here and the
 * one registered dispatcher resolves the triggering view at call time. A
 * `WeakMap` lets entries be collected when a view is destroyed and prevents a
 * destroyed mount's handlers from ever firing.
 */
const vimExRegistry = new WeakMap<EditorView, VimExHandlers>();

/** Guards the one-time, module-global `Vim.defineEx` registration. */
let registered = false;

/**
 * The triggering view for an Ex command is `cm.cm6` (the underlying CodeMirror 6
 * `EditorView`). Typed narrowly here because the vim adapter's `ExFn` receives a
 * `CodeMirrorV` whose `cm6` is declared `any`.
 */
function viewOf(cm: CodeMirrorV): EditorView | null {
    const view = (cm as unknown as { cm6?: EditorView }).cm6;
    return view ?? null;
}

/**
 * Registers the `:w` and `:wq` (and `:x`, an alias for `:wq`) Ex commands
 * exactly once for the whole module. The registered function is a thin,
 * stateless dispatcher: it resolves the triggering view, looks up that view's
 * handlers in {@link vimExRegistry}, and defers to the pure
 * {@link dispatchExCommand}. Safe to call on every mount; subsequent calls are
 * no-ops.
 */
export function registerVimExCommandsOnce(): void {
    if (registered) {
        return;
    }
    registered = true;
    const run = (command: VimExCommand) => (cm: CodeMirrorV) => {
        const view = viewOf(cm);
        if (!view) {
            return;
        }
        const handlers = vimExRegistry.get(view);
        if (handlers) {
            dispatchExCommand(command, handlers);
        }
    };
    // defineEx(name, prefix, func): `prefix` is the shortest accepted
    // abbreviation, so ("write", "w", …) makes ":w" dispatch.
    Vim.defineEx("write", "w", run("w"));
    Vim.defineEx("wq", "wq", run("wq"));
    // ":x" is the conventional "write if changed, then quit" command; treated
    // here as an alias of ":wq".
    Vim.defineEx("x", "x", run("wq"));
}

/** Records (or refreshes) the handlers for a live view. */
export function setVimExHandlers(
    view: EditorView,
    handlers: VimExHandlers,
): void {
    vimExRegistry.set(view, handlers);
}

/** Removes a view's handlers; call on unmount before destroying the view. */
export function clearVimExHandlers(view: EditorView): void {
    vimExRegistry.delete(view);
}

/** Resolves a CodeMirror 6 view from a vim adapter instance, if available. */
export { getCM };
