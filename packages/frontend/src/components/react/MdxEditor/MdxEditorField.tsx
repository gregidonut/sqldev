import React from "react";
import {
    useController,
    useFormContext,
    type FieldValues,
    type Path,
    type RegisterOptions,
} from "react-hook-form";
import { ToggleButton } from "react-aria-components";
import { cy } from "@/utils/cy";
import { useMutationFormState } from "@/components/react/MutationForm/MutationFormContext.ts";
import { MdxEditor } from "./MdxEditor.tsx";
import {
    MARKDOWN_EDITOR_LABEL,
    type EditorMode,
    type EditorSizing,
    type MarkdownEditorHandle,
    type ToolbarWidth,
} from "./types.ts";
import "./mdxEditor.css";

export type MdxEditorFieldProps<TFieldValues extends FieldValues> = Readonly<{
    name: Path<TFieldValues>;
    rules?: RegisterOptions<TFieldValues, Path<TFieldValues>>;
    sizing: EditorSizing;
    toolbarWidth: ToolbarWidth;
    ariaLabel?: string;
    label?: string;
    defaultMode?: EditorMode;
    isRequired?: boolean;
    autoFocus?: boolean;
    stopArrowKeyPropagation?: boolean;
    className?: string;
    dataCy?: string;
}>;

/**
 * React Hook Form field adapter for the reusable {@link MdxEditor}.
 *
 * React Hook Form remains the sole draft owner; this adapter binds a
 * string-valued field through `useController` and keeps the active editor mode
 * as ephemeral local state. Ctrl/Cmd+Enter routes through the MutationForm
 * guarded submit so the shortcut shares the form's validation and
 * duplicate-submit protection. The accessible label, error text, invalid state,
 * and required state are associated with the editor for assistive technology.
 */
export function MdxEditorField<TFieldValues extends FieldValues>({
    name,
    rules,
    sizing,
    toolbarWidth,
    ariaLabel = MARKDOWN_EDITOR_LABEL,
    label,
    defaultMode = "visual",
    isRequired,
    autoFocus,
    stopArrowKeyPropagation,
    className,
    dataCy,
}: MdxEditorFieldProps<TFieldValues>) {
    const { control } = useFormContext<TFieldValues>();
    const { isPending, submit } = useMutationFormState();
    const {
        field,
        fieldState: { invalid, error },
    } = useController<TFieldValues>({ name, control, rules });

    const [mode, setMode] = React.useState<EditorMode>(defaultMode);
    const editorRef = React.useRef<MarkdownEditorHandle | null>(null);
    const errorId = React.useId();
    const instructionsId = React.useId();

    // Move focus into the editor once, after it is editable, when requested.
    const didAutoFocusRef = React.useRef(false);
    React.useEffect(() => {
        if (autoFocus && !didAutoFocusRef.current) {
            didAutoFocusRef.current = true;
            const id = window.requestAnimationFrame(() =>
                editorRef.current?.focus(),
            );
            return () => window.cancelAnimationFrame(id);
        }
    }, [autoFocus]);

    const value = typeof field.value === "string" ? field.value : "";

    const describedBy =
        [error ? errorId : null, instructionsId].filter(Boolean).join(" ") ||
        undefined;

    return (
        <div
            className={className}
            {...(dataCy ? cy(dataCy) : {})}
            // Isolate arrow keys so editing inside a React Aria GridList row does
            // not trigger list navigation.
            onKeyDown={
                stopArrowKeyPropagation
                    ? (event) => {
                          if (event.key.startsWith("Arrow")) {
                              event.stopPropagation();
                          }
                      }
                    : undefined
            }
        >
            <div className="flex flex-row items-center justify-between gap-2">
                {label ? (
                    <span className="text-drac-foreground">{label}</span>
                ) : (
                    <span className="sr-only" id={`${instructionsId}-label`}>
                        {ariaLabel}
                    </span>
                )}
                <ToggleButton
                    data-cy="mdx-vim-toggle"
                    aria-label="Vim source mode"
                    isSelected={mode === "vim"}
                    isDisabled={isPending}
                    onChange={(selected) => setMode(selected ? "vim" : "visual")}
                    className="cursor-default rounded-lg border border-drac-selection px-3 py-1.5 text-drac-foreground outline-none selected:bg-drac-purple selected:text-drac-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-drac-cyan"
                >
                    Vim source mode
                </ToggleButton>
            </div>

            <div
                aria-invalid={invalid || undefined}
                aria-required={isRequired || undefined}
                aria-describedby={describedBy}
            >
                <MdxEditor
                    ref={editorRef}
                    value={value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    mode={mode}
                    sizing={sizing}
                    toolbarWidth={toolbarWidth}
                    ariaLabel={ariaLabel}
                    onSubmitShortcut={submit}
                />
            </div>

            <p id={instructionsId} className="text-xs text-drac-comment">
                Press Ctrl+Enter or Cmd+Enter to submit.
            </p>

            {error ? (
                <p id={errorId} role="alert" className="text-sm text-drac-red">
                    {error.message}
                </p>
            ) : null}
        </div>
    );
}

export default MdxEditorField;
