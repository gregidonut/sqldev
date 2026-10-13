import { afterEach, describe, expect, mock, test } from "bun:test";
import React from "react";
import { act } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
    QueryClient,
    QueryClientProvider,
    mutationOptions,
} from "@tanstack/react-query";
import type { MarkdownEditorProps } from "./types.ts";

// Lightweight controlled double for the lazy adapters so the field's RHF
// binding, submit plumbing, and accessibility wiring can be verified without
// the heavy MDXEditor / CodeMirror engines (covered in Cypress).
mock.module("./editors/LazyEditors.tsx", () => {
    const Double = React.forwardRef<
        { focus(): void },
        MarkdownEditorProps
    >(function Double(props, ref) {
        React.useImperativeHandle(ref, () => ({ focus: () => {} }));
        return (
            <textarea
                data-testid="editor-surface"
                aria-label={props.ariaLabel}
                value={props.value}
                onChange={(e) => props.onChange(e.target.value)}
                onBlur={() => props.onBlur?.()}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        props.onSubmitShortcut?.();
                    }
                }}
            />
        );
    });
    return {
        LazyVisualMarkdownEditor: Double,
        LazyVimMarkdownEditor: Double,
    };
});

const { MdxEditorField } = await import("./MdxEditorField.tsx");
const { MutationForm, SubmitButton } = await import(
    "@/components/react/MutationForm"
);

afterEach(() => cleanup());

type Values = { p_text_content: string };

function makeClient() {
    return new QueryClient({ defaultOptions: { mutations: { retry: false } } });
}

function CreateHarness({
    mutationFn,
}: {
    mutationFn: (v: Values) => Promise<void>;
}) {
    const options = mutationOptions<void, Error, Values>({ mutationFn });
    return (
        <QueryClientProvider client={makeClient()}>
            <MutationForm<Values, Values, void>
                formOptions={{ defaultValues: { p_text_content: "" } }}
                mutationOptions={options}
            >
                <MdxEditorField<Values>
                    name="p_text_content"
                    rules={{ required: "post text is required." }}
                    isRequired
                    sizing={{ mode: "content", minRows: 4 }}
                    toolbarWidth="100%"
                    ariaLabel="Post content"
                    dataCy="p_text_content_field"
                />
                <SubmitButton dataCy="submit">Submit</SubmitButton>
            </MutationForm>
        </QueryClientProvider>
    );
}

function EditHarness({
    hydrated,
    mutationFn,
}: {
    hydrated: string;
    mutationFn: (v: FormData) => Promise<void>;
}) {
    const options = mutationOptions<void, Error, FormData>({ mutationFn });
    return (
        <QueryClientProvider client={makeClient()}>
            <MutationForm<Values, FormData, void>
                formOptions={{
                    defaultValues: { p_text_content: "" },
                    values: { p_text_content: hydrated },
                }}
                mutationOptions={options}
                toVariables={(values) => {
                    const fd = new FormData();
                    fd.append("p_post_id", "post-1");
                    fd.append("p_text_content", values.p_text_content);
                    return fd;
                }}
            >
                <MdxEditorField<Values>
                    name="p_text_content"
                    rules={{ required: "Post content cannot be empty." }}
                    isRequired
                    autoFocus
                    sizing={{ mode: "content", minRows: 4 }}
                    toolbarWidth="100%"
                    ariaLabel="Post content"
                    dataCy="edit_p_text_content_field"
                />
                <SubmitButton dataCy="edit_submit">Save</SubmitButton>
            </MutationForm>
        </QueryClientProvider>
    );
}

describe("MdxEditorField create", () => {
    test("empty submit shows the required error and starts no mutation", async () => {
        const mutationFn = mock(async () => {});
        const { getByTestId } = render(
            <CreateHarness mutationFn={mutationFn} />,
        );
        await act(async () => {
            getByTestId("editor-surface").dispatchEvent(
                new window.KeyboardEvent("keydown", {
                    key: "Enter",
                    ctrlKey: true,
                    bubbles: true,
                }),
            );
        });
        await waitFor(() => {
            expect(mutationFn).toHaveBeenCalledTimes(0);
        });
    });

    test("Ctrl+Enter submits valid content exactly once", async () => {
        const mutationFn = mock(async () => {});
        const { getByTestId } = render(
            <CreateHarness mutationFn={mutationFn} />,
        );
        const surface = getByTestId("editor-surface") as HTMLTextAreaElement;
        await act(async () => {
            fireEvent.change(surface, { target: { value: "hello world" } });
        });
        await act(async () => {
            fireEvent.keyDown(surface, { key: "Enter", ctrlKey: true });
        });
        await waitFor(() => {
            expect(mutationFn).toHaveBeenCalledTimes(1);
        });
    });

    test("the editor surface exposes the accessible name", () => {
        const { getByTestId } = render(
            <CreateHarness mutationFn={mock(async () => {})} />,
        );
        expect(getByTestId("editor-surface").getAttribute("aria-label")).toBe(
            "Post content",
        );
    });
});

describe("MdxEditorField edit", () => {
    test("hydrates the editor from fetched content", () => {
        const { getByTestId } = render(
            <EditHarness hydrated="seeded post" mutationFn={mock(async () => {})} />,
        );
        expect((getByTestId("editor-surface") as HTMLTextAreaElement).value).toBe(
            "seeded post",
        );
    });

    test("converts to FormData with p_post_id and p_text_content on submit", async () => {
        let seen: FormData | null = null;
        const mutationFn = mock(async (fd: FormData) => {
            seen = fd;
        });
        const { getByTestId } = render(
            <EditHarness hydrated="seeded" mutationFn={mutationFn} />,
        );
        const surface = getByTestId("editor-surface") as HTMLTextAreaElement;
        await act(async () => {
            fireEvent.change(surface, { target: { value: "edited body" } });
        });
        await act(async () => {
            fireEvent.keyDown(surface, { key: "Enter", metaKey: true });
        });
        await waitFor(() => {
            expect(mutationFn).toHaveBeenCalledTimes(1);
        });
        expect(seen!.get("p_post_id")).toBe("post-1");
        expect(seen!.get("p_text_content")).toBe("edited body");
    });
});
