import React from "react";
import type { MarkdownEditorHandle, MarkdownEditorProps } from "../types.ts";

type LazyEditorProps = MarkdownEditorProps &
    React.RefAttributes<MarkdownEditorHandle>;

const LazyVisual = React.lazy(() => import("./VisualMarkdownEditor.tsx"));
const LazyVim = React.lazy(() => import("./VimMarkdownEditor.tsx"));

/**
 * Stable, dimension-preserving fallback. It carries the shell surface class and
 * sizing data attribute so the reserved height (fixed) or minimum height
 * (content) is identical to the mounted adapter, preventing layout shift while
 * a chunk loads.
 */
function EditorFallback({
    sizingMode,
}: {
    sizingMode: "fixed" | "content";
}): React.JSX.Element {
    return (
        <div
            data-cy="mdx-editor-loading"
            data-sizing={sizingMode}
            className="sqldev-mdx-editor__surface sqldev-mdx-editor__fallback flex h-full w-full items-center justify-center bg-drac-background text-drac-comment"
        >
            Loading editor…
        </div>
    );
}

export const LazyVisualMarkdownEditor = React.forwardRef<
    MarkdownEditorHandle,
    MarkdownEditorProps
>(function LazyVisualMarkdownEditor(props, ref): React.JSX.Element {
    return (
        <React.Suspense fallback={<EditorFallback sizingMode={props.sizing.mode} />}>
            <LazyVisual {...(props as LazyEditorProps)} ref={ref} />
        </React.Suspense>
    );
});
LazyVisualMarkdownEditor.displayName = "LazyVisualMarkdownEditor";

export const LazyVimMarkdownEditor = React.forwardRef<
    MarkdownEditorHandle,
    MarkdownEditorProps
>(function LazyVimMarkdownEditor(props, ref): React.JSX.Element {
    return (
        <React.Suspense fallback={<EditorFallback sizingMode={props.sizing.mode} />}>
            <LazyVim {...(props as LazyEditorProps)} ref={ref} />
        </React.Suspense>
    );
});
LazyVimMarkdownEditor.displayName = "LazyVimMarkdownEditor";
