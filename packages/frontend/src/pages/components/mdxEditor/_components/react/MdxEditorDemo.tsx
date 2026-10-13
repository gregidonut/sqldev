import React from "react";
import { Controller, useForm } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { Form } from "react-aria-components";
import { ToggleButton } from "react-aria-components";
import { Button } from "@/components/ui/Button.tsx";
import {
    MdxEditor,
    MARKDOWN_EDITOR_LABEL,
    createRenderMarkdownMutationOptions,
    RenderMarkdownError,
    type EditorSizing,
    type MarkdownEditorHandle,
    type RenderMarkdownData,
    type RenderMarkdownVariables,
} from "@/components/react/MdxEditor";
import { OutputTabs } from "./OutputTabs.tsx";
import { useMdxEditorUiStore } from "./mdxEditorStore.ts";
import { SAMPLE_MARKDOWN } from "./sampleMarkdown.ts";

type DraftForm = { markdown: string };

// The demo editor fills its reserved, bounded authoring slot and scrolls
// internally, preserving the prior layout.
const DEMO_SIZING = { mode: "fixed", height: "100%" } satisfies EditorSizing;

export function MdxEditorDemo(): React.JSX.Element {
    const { control, handleSubmit } = useForm<DraftForm>({
        defaultValues: { markdown: SAMPLE_MARKDOWN },
    });

    const editorMode = useMdxEditorUiStore((s) => s.editorMode);
    const selectedOutputTab = useMdxEditorUiStore((s) => s.selectedOutputTab);
    const lastSuccess = useMdxEditorUiStore((s) => s.lastSuccess);
    const setEditorMode = useMdxEditorUiStore((s) => s.setEditorMode);
    const setSelectedOutputTab = useMdxEditorUiStore(
        (s) => s.setSelectedOutputTab,
    );
    const commitSuccess = useMdxEditorUiStore((s) => s.commitSuccess);

    const editorRef = React.useRef<MarkdownEditorHandle | null>(null);
    const inFlightRef = React.useRef(false);
    const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
    const [statusMessage, setStatusMessage] = React.useState<string>("");
    const errorRef = React.useRef<HTMLDivElement | null>(null);

    const mutation = useMutation<
        RenderMarkdownData,
        RenderMarkdownError,
        RenderMarkdownVariables
    >({
        ...createRenderMarkdownMutationOptions(),
        onMutate: () => {
            setErrorMessage(null);
            setStatusMessage("Rendering Markdown…");
        },
        onSuccess: (data, variables) => {
            commitSuccess({ markdown: variables.text, html: data.html });
            setStatusMessage("Render complete.");
        },
        onError: (error) => {
            setStatusMessage("");
            const message =
                error instanceof RenderMarkdownError
                    ? error.message
                    : "Rendering failed. Please try again.";
            setErrorMessage(message);
        },
        onSettled: () => {
            inFlightRef.current = false;
        },
    });

    React.useEffect(() => {
        if (errorMessage) {
            errorRef.current?.focus();
        }
    }, [errorMessage]);

    const onSubmit = (values: DraftForm) => {
        if (inFlightRef.current || mutation.isPending) {
            return;
        }
        inFlightRef.current = true;
        mutation.mutate({ text: values.markdown });
    };

    const submitDraft = () => void handleSubmit(onSubmit)();

    return (
        <section className="flex w-full flex-col gap-4" data-cy="mdx-editor-demo">
            <h1 className="text-xl text-drac-foreground">
                MDXEditor Goldmark demo
            </h1>

            <Form
                onSubmit={handleSubmit(onSubmit)}
                validationBehavior="aria"
                className="flex min-h-0 flex-1 flex-col gap-4"
            >
                {/* Authoring region */}
                <section
                    aria-labelledby="mdx-authoring-heading"
                    className="flex min-h-80 flex-col gap-2 sm:h-[42vh]"
                >
                    <div className="flex flex-row items-center justify-between gap-2">
                        <h2
                            id="mdx-authoring-heading"
                            className="text-drac-foreground"
                        >
                            Author
                        </h2>
                        <div className="flex flex-row items-center gap-2">
                            <ToggleButton
                                data-cy="mdx-vim-toggle"
                                aria-label="Vim source mode"
                                isSelected={editorMode === "vim"}
                                onChange={(isSelected) =>
                                    setEditorMode(isSelected ? "vim" : "visual")
                                }
                                className="cursor-default rounded-lg border border-drac-selection px-3 py-1.5 text-drac-foreground outline-none selected:bg-drac-purple selected:text-drac-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-drac-cyan"
                            >
                                Vim source mode
                            </ToggleButton>
                            <Button
                                type="submit"
                                data-cy="mdx-render"
                                isPending={mutation.isPending}
                                isDisabled={mutation.isPending}
                                aria-label="Render Markdown"
                                aria-description={
                                    mutation.isPending
                                        ? "Rendering in progress"
                                        : undefined
                                }
                            >
                                Render Markdown
                            </Button>
                        </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-drac-selection bg-drac-background">
                        <Controller
                            control={control}
                            name="markdown"
                            render={({ field }) => (
                                <MdxEditor
                                    ref={editorRef}
                                    value={field.value}
                                    onChange={field.onChange}
                                    onBlur={field.onBlur}
                                    mode={editorMode}
                                    sizing={DEMO_SIZING}
                                    toolbarWidth="100%"
                                    ariaLabel={MARKDOWN_EDITOR_LABEL}
                                    onSubmitShortcut={submitDraft}
                                />
                            )}
                        />
                    </div>

                    <div
                        data-cy="mdx-status"
                        role="status"
                        aria-live="polite"
                        aria-atomic="true"
                        className="min-h-5 text-sm text-drac-green"
                    >
                        {statusMessage}
                    </div>
                    <div
                        data-cy="mdx-error"
                        ref={errorRef}
                        tabIndex={-1}
                        role="alert"
                        aria-live="assertive"
                        aria-atomic="true"
                        className="min-h-5 text-sm text-drac-red"
                    >
                        {errorMessage}
                    </div>
                </section>

                {/* Output region */}
                <section
                    aria-labelledby="mdx-output-heading"
                    className="flex min-h-80 flex-col gap-2 sm:h-[42vh]"
                >
                    <h2 id="mdx-output-heading" className="text-drac-foreground">
                        Output
                    </h2>
                    <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-drac-selection">
                        <OutputTabs
                            lastSuccess={lastSuccess}
                            selectedOutputTab={selectedOutputTab}
                            onSelect={setSelectedOutputTab}
                        />
                    </div>
                </section>
            </Form>
        </section>
    );
}

export default MdxEditorDemo;
