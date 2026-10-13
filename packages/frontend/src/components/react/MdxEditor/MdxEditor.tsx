import React from "react";
import {
    assertValidSizing,
    toSizingStyle,
    type MarkdownEditorHandle,
    type MdxEditorProps,
} from "./types.ts";
import {
    LazyVisualMarkdownEditor,
    LazyVimMarkdownEditor,
} from "./editors/LazyEditors.tsx";

/**
 * Reusable, controlled Markdown editor.
 *
 * The caller owns the value, the active mode, sizing, toolbar width, accessible
 * name, and the optional submit-shortcut callback. This component owns only a
 * persistent shell and a single mounted lazy adapter. It performs no React Hook
 * Form or TanStack Query access, so it is safe to use in any form or page.
 *
 * Draft continuity across mode changes is the caller's responsibility: because
 * `value` is controlled, switching `mode` unmounts one adapter and mounts the
 * other initialized from the same `value`. Focus moves into the newly mounted
 * adapter after it becomes editable.
 */
export const MdxEditor = React.forwardRef<MarkdownEditorHandle, MdxEditorProps>(
    function MdxEditor(
        {
            value,
            onChange,
            onBlur,
            mode,
            sizing,
            toolbarWidth,
            ariaLabel,
            onSubmitShortcut,
            onCloseRequest,
            className,
        },
        ref,
    ): React.JSX.Element {
        assertValidSizing(sizing);

        const adapterRef = React.useRef<MarkdownEditorHandle | null>(null);
        React.useImperativeHandle(ref, () => ({
            focus: () => adapterRef.current?.focus(),
        }));

        // Move focus into the newly mounted adapter after a mode switch.
        const prevModeRef = React.useRef(mode);
        React.useEffect(() => {
            if (prevModeRef.current !== mode) {
                prevModeRef.current = mode;
                const id = window.requestAnimationFrame(() =>
                    adapterRef.current?.focus(),
                );
                return () => window.cancelAnimationFrame(id);
            }
        }, [mode]);

        const style = toSizingStyle(sizing, toolbarWidth);
        const shellClassName = ["sqldev-mdx-editor", className]
            .filter(Boolean)
            .join(" ");

        const adapterProps = {
            value,
            onChange,
            onBlur,
            ariaLabel,
            sizing,
            onSubmitShortcut,
            onCloseRequest,
        } as const;

        return (
            <div
                data-cy="mdx-editor"
                className={shellClassName}
                data-sizing={sizing.mode}
                style={style}
            >
                {mode === "vim" ? (
                    <LazyVimMarkdownEditor ref={adapterRef} {...adapterProps} />
                ) : (
                    <LazyVisualMarkdownEditor
                        ref={adapterRef}
                        {...adapterProps}
                    />
                )}
            </div>
        );
    },
);

MdxEditor.displayName = "MdxEditor";

export default MdxEditor;
