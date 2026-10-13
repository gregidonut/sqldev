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
} from "./MarkdownEditor.ts";

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
 * MDXEditor adapted to the shared controlled contract. React Hook Form owns the
 * draft; MDXEditor is initialized from `value` and reports edits via `onChange`.
 * External value changes are pushed through `setMarkdown` only when they differ
 * from the current serialized Markdown, preventing feedback loops.
 */
export const VisualMarkdownEditor = React.forwardRef<
    MarkdownEditorHandle,
    MarkdownEditorProps
>(function VisualMarkdownEditor(
    { value, onChange, onBlur, ariaLabel },
    ref,
): React.JSX.Element {
    const editorRef = React.useRef<MDXEditorMethods | null>(null);

    React.useImperativeHandle(ref, () => ({
        focus: () => editorRef.current?.focus(),
    }));

    // Sync external RHF changes into MDXEditor only when they differ.
    React.useEffect(() => {
        const current = editorRef.current?.getMarkdown();
        if (current !== undefined && current !== value) {
            editorRef.current?.setMarkdown(value);
        }
    }, [value]);

    return (
        <div
            data-cy="mdx-visual-editor"
            className="mdx-visual-editor h-full w-full overflow-auto"
            onBlur={onBlur}
        >
            <MDXEditor
                ref={editorRef}
                markdown={value}
                onChange={onChange}
                plugins={goldmarkPlugins()}
                contentEditableClassName="mdx-visual-editor__content"
                aria-label={ariaLabel}
            />
        </div>
    );
});

VisualMarkdownEditor.displayName = "VisualMarkdownEditor";

export { MARKDOWN_EDITOR_LABEL };
export default VisualMarkdownEditor;
