import { afterEach, describe, expect, mock, test } from "bun:test";
import React from "react";
import { act } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
    QueryClient,
    QueryClientProvider,
    mutationOptions,
} from "@tanstack/react-query";
import fc from "fast-check";
import type { MarkdownEditorProps } from "./types.ts";

// Controlled double for the lazy adapters (same approach as MdxEditorField.test.tsx):
// verifies the field's header/title/hint and draft binding without the heavy
// MDXEditor / CodeMirror engines.
mock.module("./editors/LazyEditors.tsx", () => {
    const Double = React.forwardRef<{ focus(): void }, MarkdownEditorProps>(
        function Double(props, ref) {
            React.useImperativeHandle(ref, () => ({ focus: () => {} }));
            return (
                <textarea
                    data-testid="editor-surface"
                    aria-label={props.ariaLabel}
                    value={props.value}
                    onChange={(e) => props.onChange(e.target.value)}
                />
            );
        },
    );
    return { LazyVisualMarkdownEditor: Double, LazyVimMarkdownEditor: Double };
});

const { MdxEditorField } = await import("./MdxEditorField.tsx");
const { MutationForm } = await import("@/components/react/MutationForm");

afterEach(() => cleanup());

type Values = { p_text_content: string };

function makeClient() {
    return new QueryClient({ defaultOptions: { mutations: { retry: false } } });
}

function Harness({
    label,
    value = "",
}: {
    label?: string;
    value?: string;
}) {
    const options = mutationOptions<void, Error, Values>({
        mutationFn: async () => {},
    });
    return (
        <QueryClientProvider client={makeClient()}>
            <MutationForm<Values, Values, void>
                formOptions={{
                    defaultValues: { p_text_content: "" },
                    values: { p_text_content: value },
                }}
                mutationOptions={options}
            >
                <MdxEditorField<Values>
                    name="p_text_content"
                    sizing={{ mode: "content", minRows: 4 }}
                    toolbarWidth="100%"
                    ariaLabel="Post content"
                    label={label}
                    dataCy="field"
                />
            </MutationForm>
        </QueryClientProvider>
    );
}

describe("Feature: mdx-editor-ui-refinements, Property 5: header title renders iff supplied", () => {
    test("the title shows at the header start exactly when a non-empty label is supplied; toggle stays last", () => {
        fc.assert(
            fc.property(
                fc.option(fc.string(), { nil: undefined }),
                (label) => {
                    const { container, getByRole, unmount } = render(
                        <Harness label={label} />,
                    );
                    const header = container.querySelector(
                        ".flex.flex-row.items-center.justify-between",
                    );
                    expect(header).not.toBeNull();

                    const toggle = getByRole("button", {
                        name: "Vim source mode",
                    });
                    // The toggle is always the last child of the header row.
                    expect(header!.lastElementChild).toBe(toggle);

                    const hasVisibleTitle =
                        typeof label === "string" && label.length > 0;
                    if (hasVisibleTitle) {
                        const titleSpan = header!.firstElementChild;
                        expect(titleSpan?.textContent).toBe(label);
                        expect(
                            titleSpan?.classList.contains("sr-only"),
                        ).toBe(false);
                    } else {
                        // No visible title: the start slot is the sr-only span.
                        const first = header!.firstElementChild;
                        expect(first?.classList.contains("sr-only")).toBe(true);
                    }
                    unmount();
                },
            ),
            { numRuns: 100 },
        );
    });
});

describe("Feature: mdx-editor-ui-refinements, Property 6: draft value preserved across refinements", () => {
    test("for any value, the controlled surface mirrors it and onChange round-trips unchanged", () => {
        fc.assert(
            fc.property(
                fc.string(),
                fc.option(fc.string(), { nil: undefined }),
                (value, label) => {
                    const { getByTestId, unmount } = render(
                        <Harness label={label} value={value} />,
                    );
                    const surface = getByTestId(
                        "editor-surface",
                    ) as HTMLTextAreaElement;
                    expect(surface.value).toBe(value);

                    const next = value + "x";
                    act(() => {
                        fireEvent.change(surface, {
                            target: { value: next },
                        });
                    });
                    expect(
                        (getByTestId("editor-surface") as HTMLTextAreaElement)
                            .value,
                    ).toBe(next);
                    unmount();
                },
            ),
            { numRuns: 100 },
        );
    });
});

describe("MdxEditorField refinements: toggle and hint (examples)", () => {
    test("toggle shows 'vim' over 'mode' with accessible name 'Vim source mode'", () => {
        const { getByRole } = render(<Harness label="Create post" />);
        const toggle = getByRole("button", { name: "Vim source mode" });
        const spans = toggle.querySelectorAll("span[aria-hidden='true']");
        expect(spans.length).toBe(2);
        expect(spans[0]?.textContent).toBe("vim");
        expect(spans[1]?.textContent).toBe("mode");
        // Stacked layout: flex column.
        expect(toggle.className).toContain("flex-col");
        // Smaller font than the former default.
        expect(toggle.className).toContain("text-[0.625rem]");
    });

    test("submit hint keeps exact text and uses the smaller size class", () => {
        const { getByText } = render(<Harness label="Edit post" />);
        const hint = getByText("Press Ctrl+Enter or Cmd+Enter to submit.");
        expect(hint.className).toContain("text-[0.625rem]");
    });

    test("supplied label renders as the visible header title", () => {
        const { getByText } = render(<Harness label="Edit post" />);
        expect(getByText("Edit post")).toBeDefined();
    });
});
