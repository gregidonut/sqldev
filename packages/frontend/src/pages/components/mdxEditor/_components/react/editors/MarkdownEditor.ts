/**
 * Shared controlled contract for the two interchangeable Markdown editors.
 *
 * Neither implementation owns a durable copy of the draft: React Hook Form is
 * the sole authority. An adapter initializes from {@link MarkdownEditorProps.value},
 * reports user edits through {@link MarkdownEditorProps.onChange}, and exposes an
 * imperative focus handle so the orchestrator can move focus into the mounted
 * editor once it is ready.
 */
export type MarkdownEditorProps = Readonly<{
    value: string;
    onChange: (nextMarkdown: string) => void;
    onBlur?: () => void;
    ariaLabel: string;
}>;

export interface MarkdownEditorHandle {
    focus(): void;
}

/** The accessible label both editor adapters expose. */
export const MARKDOWN_EDITOR_LABEL = "Markdown draft editor";
