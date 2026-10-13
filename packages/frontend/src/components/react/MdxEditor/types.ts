import type React from "react";

/** Which editing surface is mounted. */
export type EditorMode = "visual" | "vim";

/**
 * Editor sizing, modeled as a discriminated union so a single configuration
 * cannot contain both a fixed height and a content minimum row count. Fixed
 * sizing scrolls internally at a bounded height; content sizing grows with the
 * document and defers vertical scrolling to the page.
 */
export type EditorSizing =
    | Readonly<{ mode: "fixed"; height: React.CSSProperties["height"] }>
    | Readonly<{ mode: "content"; minRows: number }>;

/** A CSS-compatible width applied to the formatting toolbar. */
export type ToolbarWidth = React.CSSProperties["width"];

/** The accessible label both editor adapters expose by default. */
export const MARKDOWN_EDITOR_LABEL = "Markdown draft editor";

/**
 * Shared controlled contract for the two interchangeable Markdown editors.
 *
 * Neither implementation owns a durable copy of the draft: the caller (React
 * Hook Form, in form contexts) is the sole authority. An adapter initializes
 * from {@link MarkdownEditorProps.value}, reports user edits through
 * {@link MarkdownEditorProps.onChange}, optionally reports blur, exposes an
 * imperative focus handle, and invokes {@link MarkdownEditorProps.onSubmitShortcut}
 * when the user presses a modified Enter (Ctrl+Enter or Cmd+Enter).
 */
export type MarkdownEditorProps = Readonly<{
    value: string;
    onChange: (nextMarkdown: string) => void;
    onBlur?: () => void;
    ariaLabel: string;
    sizing: EditorSizing;
    onSubmitShortcut?: () => void;
    /**
     * Optional imperative affordance (never form state) invoked when the
     * surface requests the editor be closed — for example, the Vim adapter's
     * `:wq` Ex command. Adapters without a close gesture ignore it.
     */
    onCloseRequest?: () => void;
}>;

export interface MarkdownEditorHandle {
    focus(): void;
}

/**
 * Props for the reusable, controlled {@link MdxEditor}. The caller owns the
 * value, the active mode, sizing, toolbar width, accessible name, and the
 * optional submit-shortcut callback. The component owns only the stable shell
 * and the single mounted lazy adapter.
 */
export type MdxEditorProps = Readonly<{
    value: string;
    onChange: (nextMarkdown: string) => void;
    onBlur?: () => void;
    mode: EditorMode;
    sizing: EditorSizing;
    toolbarWidth: ToolbarWidth;
    ariaLabel: string;
    onSubmitShortcut?: () => void;
    onCloseRequest?: () => void;
    className?: string;
}>;

/** Line height (rem) assumed when reserving the content-mode minimum height. */
export const EDITOR_LINE_HEIGHT_REM = 1.5;
/** Vertical padding (rem) reserved around the editable area in content mode. */
export const EDITOR_BLOCK_PADDING_REM = 1;
/** Minimum toolbar height (rem) reserved so content mode never collapses. */
export const EDITOR_TOOLBAR_MIN_HEIGHT_REM = 2.5;

/** The CSS custom properties the shell derives from its sizing props. */
export type MdxEditorStyle = React.CSSProperties & {
    "--mdx-editor-height"?: React.CSSProperties["height"];
    "--mdx-editor-min-rows"?: number;
    "--mdx-editor-toolbar-width"?: React.CSSProperties["width"];
};

/**
 * Development-only guard. Content sizing must carry a safe, positive integer
 * row count; an invalid value is a programming error at the component boundary.
 * Throws only in development builds so production rendering stays resilient.
 */
export function assertValidSizing(sizing: EditorSizing): void {
    if (sizing.mode !== "content") {
        return;
    }
    const isDev =
        typeof import.meta !== "undefined" &&
        (import.meta.env?.DEV ?? import.meta.env?.MODE === "development");
    const { minRows } = sizing;
    const valid =
        Number.isSafeInteger(minRows) && minRows >= 1;
    if (!valid && isDev) {
        throw new Error(
            `MdxEditor content sizing requires an integer minRows >= 1, received: ${String(
                minRows,
            )}`,
        );
    }
}

/**
 * Derives the stable shell inline style from sizing and toolbar width. Pure:
 * the same inputs always produce the same CSS custom properties.
 */
export function toSizingStyle(
    sizing: EditorSizing,
    toolbarWidth: ToolbarWidth,
): MdxEditorStyle {
    const style: MdxEditorStyle = {
        "--mdx-editor-toolbar-width": toolbarWidth,
    };
    if (sizing.mode === "fixed") {
        style["--mdx-editor-height"] = sizing.height;
    } else {
        style["--mdx-editor-min-rows"] = sizing.minRows;
    }
    return style;
}
