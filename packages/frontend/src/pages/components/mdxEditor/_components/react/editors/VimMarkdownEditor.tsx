import React from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
    bracketMatching,
    syntaxHighlighting,
    defaultHighlightStyle,
} from "@codemirror/language";
import { Annotation, EditorState, type Extension } from "@codemirror/state";
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
    type MarkdownEditorHandle,
    type MarkdownEditorProps,
} from "./MarkdownEditor.ts";
import { draculaCodeMirror } from "./codeMirrorTheme.ts";

/** Marks a transaction that originated from an external RHF value sync. */
const externalSync = Annotation.define<boolean>();

/**
 * Builds the CodeMirror extensions in a fixed order. `vim()` MUST come before
 * every other keymap so Vim bindings take precedence in each mode.
 */
export function buildVimExtensions(
    onDocChange: (next: string) => void,
    onBlur: (() => void) | undefined,
): Extension[] {
    return [
        // 1. Vim first, before any other keymap.
        vim(),
        // 2. History + default editing keymaps (insert mode etc.).
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        // 3. Markdown language support.
        markdown(),
        // 4. Editor behaviour.
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        bracketMatching(),
        drawSelection(),
        EditorView.lineWrapping,
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        // 5. Dracula theme + Markdown syntax colours.
        draculaCodeMirror,
        // 6. Report user edits to React Hook Form.
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
 * `EditorView` per mount, mirrors the React Hook Form value, and reports user
 * edits without feeding external syncs back into the form.
 */
export const VimMarkdownEditor = React.forwardRef<
    MarkdownEditorHandle,
    MarkdownEditorProps
>(function VimMarkdownEditor(
    { value, onChange, onBlur, ariaLabel },
    ref,
): React.JSX.Element {
    const hostRef = React.useRef<HTMLDivElement | null>(null);
    const viewRef = React.useRef<EditorView | null>(null);
    // Keep the latest onChange without re-creating the editor each render.
    const onChangeRef = React.useRef(onChange);
    const onBlurRef = React.useRef(onBlur);
    onChangeRef.current = onChange;
    onBlurRef.current = onBlur;

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
        // Mount once; value syncing is handled by the effect below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Apply external RHF value changes without creating a feedback loop.
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

    return (
        <div
            ref={hostRef}
            data-cy="mdx-vim-editor"
            className="h-full w-full overflow-hidden"
        />
    );
});

VimMarkdownEditor.displayName = "VimMarkdownEditor";

export { MARKDOWN_EDITOR_LABEL };
export default VimMarkdownEditor;
