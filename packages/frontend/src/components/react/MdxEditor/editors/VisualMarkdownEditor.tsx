import React from "react";
import {
    MDXEditor,
    type MDXEditorMethods,
    headingsPlugin,
    listsPlugin,
    quotePlugin,
    thematicBreakPlugin,
    linkPlugin,
    linkDialogPlugin,
    imagePlugin,
    codeBlockPlugin,
    codeMirrorPlugin,
    markdownShortcutPlugin,
    toolbarPlugin,
    UndoRedo,
    BoldItalicUnderlineToggles,
    BlockTypeSelect,
    ListsToggle,
    CreateLink,
    InsertImage,
    InsertThematicBreak,
    InsertCodeBlock,
    Separator,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import {
    MARKDOWN_EDITOR_LABEL,
    type MarkdownEditorHandle,
    type MarkdownEditorProps,
} from "../types.ts";
import { handleSubmitShortcut } from "./submitShortcut.ts";

/**
 * Plugin set limited to constructs that round-trip to default (unextended)
 * Goldmark / CommonMark. No tables, task lists, strikethrough, directives,
 * frontmatter, JSX, imports/exports, or Sandpack are enabled.
 */
function goldmarkPlugins() {
    return [
        headingsPlugin(),
        listsPlugin(),
        quotePlugin(),
        thematicBreakPlugin(),
        linkPlugin(),
        linkDialogPlugin(),
        imagePlugin(),
        codeBlockPlugin({ defaultCodeBlockLanguage: "" }),
        codeMirrorPlugin({
            codeBlockLanguages: { "": "Plain text", js: "JavaScript" },
        }),
        markdownShortcutPlugin(),
        toolbarPlugin({
            // Wraps controls so a full-width toolbar never scrolls horizontally.
            toolbarClassName: "sqldev-mdx-editor__toolbar",
            toolbarContents: () => (
                <>
                    <UndoRedo />
                    <Separator />
                    <BoldItalicUnderlineToggles
                        options={["Bold", "Italic"]}
                    />
                    <Separator />
                    <BlockTypeSelect />
                    <ListsToggle options={["bullet", "number"]} />
                    <Separator />
                    <CreateLink />
                    <InsertImage />
                    <InsertThematicBreak />
                    <InsertCodeBlock />
                </>
            ),
        }),
    ];
}

/**
 * MDXEditor adapted to the shared controlled contract. The caller owns the
 * draft; MDXEditor is initialized from `value` and reports edits via `onChange`.
 * External value changes are pushed through `setMarkdown` only when they differ
 * from the current serialized Markdown, preventing feedback loops.
 */
export const VisualMarkdownEditor = React.forwardRef<
    MarkdownEditorHandle,
    MarkdownEditorProps
>(function VisualMarkdownEditor(
    { value, onChange, onBlur, ariaLabel, sizing, onSubmitShortcut },
    ref,
): React.JSX.Element {
    const editorRef = React.useRef<MDXEditorMethods | null>(null);

    React.useImperativeHandle(ref, () => ({
        focus: () => editorRef.current?.focus(),
    }));

    // Sync external value changes into MDXEditor only when they differ.
    React.useEffect(() => {
        const current = editorRef.current?.getMarkdown();
        if (current !== undefined && current !== value) {
            editorRef.current?.setMarkdown(value);
        }
    }, [value]);

    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        handleSubmitShortcut(
            event,
            () => event.preventDefault(),
            onSubmitShortcut,
        );
    };

    return (
        <div
            data-cy="mdx-visual-editor"
            className="mdx-visual-editor sqldev-mdx-editor__surface h-full w-full"
            data-sizing={sizing.mode}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
        >
            <MDXEditor
                ref={editorRef}
                markdown={value}
                onChange={onChange}
                plugins={goldmarkPlugins()}
                // Use the EXACT prose classes the posted article uses as its
                // render sink (ListItemUI.tsx:
                // `prose prose-invert text-drac-foreground prose-stone`) so the
                // editable surface is true WYSIWYG — a heading looks the same
                // (white) while authoring as it will once posted. `max-w-none`
                // lets it fill the editor width. No per-element colour overrides
                // live in mdxEditor.css anymore; prose owns the typography.
                contentEditableClassName="mdx-visual-editor__content prose prose-invert text-drac-foreground prose-stone max-w-none"
                aria-label={ariaLabel}
            />
        </div>
    );
});

VisualMarkdownEditor.displayName = "VisualMarkdownEditor";

export { MARKDOWN_EDITOR_LABEL };
export default VisualMarkdownEditor;
