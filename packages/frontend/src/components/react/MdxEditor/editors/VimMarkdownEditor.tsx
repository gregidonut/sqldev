import React from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
    bracketMatching,
    syntaxHighlighting,
    defaultHighlightStyle,
} from "@codemirror/language";
import {
    Annotation,
    Compartment,
    EditorState,
    type Extension,
} from "@codemirror/state";
import {
    EditorView,
    keymap,
    lineNumbers,
    highlightActiveLine,
    highlightActiveLineGutter,
    drawSelection,
} from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import {
    MARKDOWN_EDITOR_LABEL,
    type EditorSizing,
    type MarkdownEditorHandle,
    type MarkdownEditorProps,
} from "../types.ts";
import { draculaCodeMirror } from "./codeMirrorTheme.ts";
import { isSubmitShortcut } from "./submitShortcut.ts";

/** Marks a transaction that originated from an external value sync. */
const externalSync = Annotation.define<boolean>();

/** Reconfigurable sizing extension so mode/size changes never rebuild the view. */
const sizingCompartment = new Compartment();

/**
 * Builds the sizing extension for the current {@link EditorSizing}. Fixed mode
 * gives the editor a bounded 100% height and an internally scrolling scroller;
 * content mode lets the editor grow with the document and defers vertical
 * scrolling to the page.
 */
export function sizingExtension(sizing: EditorSizing): Extension {
    if (sizing.mode === "fixed") {
        return EditorView.theme({
            "&": { height: "100%" },
            ".cm-scroller": { overflow: "auto" },
        });
    }
    return EditorView.theme({
        "&": { height: "auto" },
        ".cm-scroller": { overflowY: "visible" },
    });
}

/**
 * Builds the CodeMirror extensions in a fixed order. `vim()` MUST come before
 * every other keymap so Vim bindings take precedence in each mode. The submit
 * shortcut is registered after `vim()` as a plain keymap, so Vim keeps priority
 * while Ctrl/Cmd+Enter still submits when Vim does not consume it.
 */
export function buildVimExtensions(
    onDocChange: (next: string) => void,
    onBlur: (() => void) | undefined,
    onSubmitShortcut: (() => void) | undefined,
    sizing: EditorSizing,
): Extension[] {
    return [
        // 1. Vim first, before any other keymap.
        vim(),
        // 2. Submit shortcut (Ctrl/Cmd+Enter) after vim, before defaults.
        keymap.of([
            {
                key: "Mod-Enter",
                run: () => {
                    if (onSubmitShortcut) {
                        onSubmitShortcut();
                        return true;
                    }
                    return false;
                },
            },
        ]),
        // 3. History + default editing keymaps (insert mode etc.).
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        // 4. Markdown language support.
        markdown(),
        // 5. Editor behaviour.
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        bracketMatching(),
        drawSelection(),
        EditorView.lineWrapping,
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        // 6. Dracula theme + Markdown syntax colours.
        draculaCodeMirror,
        // 7. Reconfigurable sizing.
        sizingCompartment.of(sizingExtension(sizing)),
        // 8. Report user edits to the controlled owner.
        EditorView.updateListener.of((update) => {
            if (
                update.docChanged &&
                !update.transactions.some((tr) => tr.annotation(externalSync))
            ) {
                onDocChange(update.state.doc.toString());
            }
            if (onBlur && update.focusChanged && !update.view.hasFocus) {
                onBlur();
            }
        }),
    ];
}

/**
 * A CodeMirror 6 Markdown source editor with Vim bindings. It owns one
 * `EditorView` per mount, mirrors the controlled value, reports user edits
 * without feeding external syncs back, and reconfigures sizing in place.
 */
export const VimMarkdownEditor = React.forwardRef<
    MarkdownEditorHandle,
    MarkdownEditorProps
>(function VimMarkdownEditor(
    { value, onChange, onBlur, ariaLabel, sizing, onSubmitShortcut },
    ref,
): React.JSX.Element {
    const hostRef = React.useRef<HTMLDivElement | null>(null);
    const viewRef = React.useRef<EditorView | null>(null);
    // Keep the latest callbacks without re-creating the editor each render.
    const onChangeRef = React.useRef(onChange);
    const onBlurRef = React.useRef(onBlur);
    const onSubmitShortcutRef = React.useRef(onSubmitShortcut);
    onChangeRef.current = onChange;
    onBlurRef.current = onBlur;
    onSubmitShortcutRef.current = onSubmitShortcut;

    React.useImperativeHandle(ref, () => ({
        focus: () => viewRef.current?.focus(),
    }));

    React.useEffect(() => {
        if (!hostRef.current) {
            return;
        }
        const view = new EditorView({
            parent: hostRef.current,
            state: EditorState.create({
                doc: value,
                extensions: buildVimExtensions(
                    (next) => onChangeRef.current(next),
                    () => onBlurRef.current?.(),
                    () => onSubmitShortcutRef.current?.(),
                    sizing,
                ),
            }),
        });
        const content = view.contentDOM;
        content.setAttribute("role", "textbox");
        content.setAttribute("aria-multiline", "true");
        content.setAttribute("aria-label", ariaLabel);
        viewRef.current = view;
        return () => {
            view.destroy();
            viewRef.current = null;
        };
        // Mount once; value and sizing are synced by the effects below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Apply external value changes without creating a feedback loop.
    React.useEffect(() => {
        const view = viewRef.current;
        if (!view) {
            return;
        }
        const current = view.state.doc.toString();
        if (current !== value) {
            view.dispatch({
                changes: { from: 0, to: current.length, insert: value },
                annotations: externalSync.of(true),
            });
        }
    }, [value]);

    // Reconfigure sizing in place; never recreate the EditorView.
    React.useEffect(() => {
        const view = viewRef.current;
        if (!view) {
            return;
        }
        view.dispatch({
            effects: sizingCompartment.reconfigure(sizingExtension(sizing)),
        });
    }, [sizing]);

    return (
        <div
            ref={hostRef}
            data-cy="mdx-vim-editor"
            className="mdx-vim-editor sqldev-mdx-editor__surface h-full w-full"
            data-sizing={sizing.mode}
        />
    );
});

VimMarkdownEditor.displayName = "VimMarkdownEditor";

export { MARKDOWN_EDITOR_LABEL, isSubmitShortcut };
export default VimMarkdownEditor;
