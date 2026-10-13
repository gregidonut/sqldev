import React from "react";
import type {
    MarkdownEditorHandle,
    MarkdownEditorProps,
} from "./MarkdownEditor.ts";

type LazyEditorProps = MarkdownEditorProps &
    React.RefAttributes<MarkdownEditorHandle>;

const LazyVisual = React.lazy(() => import("./VisualMarkdownEditor.tsx"));
const LazyVim = React.lazy(() => import("./VimMarkdownEditor.tsx"));

/** Stable, height-preserving fallback so chunk loading never collapses the row. */
function EditorFallback(): React.JSX.Element {
    return (
        <div
            data-cy="mdx-editor-loading"
            className="flex h-full min-h-80 w-full items-center justify-center bg-drac-background text-drac-comment"
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
        <React.Suspense fallback={<EditorFallback />}>
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
        <React.Suspense fallback={<EditorFallback />}>
            <LazyVim {...(props as LazyEditorProps)} ref={ref} />
        </React.Suspense>
    );
});
LazyVimMarkdownEditor.displayName = "LazyVimMarkdownEditor";
