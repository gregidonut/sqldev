import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import React from "react";
import { act } from "react";
import { cleanup, render } from "@testing-library/react";
import fc from "fast-check";
import type { MarkdownEditorProps } from "./types.ts";

// Lightweight controlled doubles for the heavy lazy adapters. They honour the
// same contract (controlled value, onChange, onBlur, onSubmitShortcut, focus),
// which is exactly what the shell orchestrates. The real MDXEditor and
// CodeMirror behaviour is verified in Cypress.
let visualMounts = 0;
let vimMounts = 0;
let visualFocusCalls = 0;
let vimFocusCalls = 0;

function makeDouble(
    kind: "visual" | "vim",
    onMount: () => void,
    onFocus: () => void,
) {
    return React.forwardRef<
        { focus(): void },
        MarkdownEditorProps
    >(function Double(props, ref) {
        React.useEffect(() => {
            onMount();
        }, []);
        React.useImperativeHandle(ref, () => ({
            focus: () => onFocus(),
        }));
        return (
            <textarea
                data-testid={`double-${kind}`}
                data-sizing={props.sizing.mode}
                value={props.value}
                aria-label={props.ariaLabel}
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
}

mock.module("./editors/LazyEditors.tsx", () => ({
    LazyVisualMarkdownEditor: makeDouble(
        "visual",
        () => (visualMounts += 1),
        () => (visualFocusCalls += 1),
    ),
    LazyVimMarkdownEditor: makeDouble(
        "vim",
        () => (vimMounts += 1),
        () => (vimFocusCalls += 1),
    ),
}));

const { MdxEditor } = await import("./MdxEditor.tsx");
const { toSizingStyle } = await import("./types.ts");

beforeEach(() => {
    visualMounts = 0;
    vimMounts = 0;
    visualFocusCalls = 0;
    vimFocusCalls = 0;
});

afterEach(() => cleanup());

const RUNS = { numRuns: 100 } as const;

/** Controlled host that mirrors edits back into the editor value, like RHF. */
function ControlledHost({
    initial,
    mode,
    onChangeSpy,
}: {
    initial: string;
    mode: "visual" | "vim";
    onChangeSpy?: (v: string) => void;
}) {
    const [value, setValue] = React.useState(initial);
    return (
        <MdxEditor
            value={value}
            onChange={(next) => {
                onChangeSpy?.(next);
                setValue(next);
            }}
            mode={mode}
            sizing={{ mode: "content", minRows: 4 }}
            toolbarWidth="100%"
            ariaLabel="draft"
        />
    );
}

// Property 1: Draft Authority — the mounted adapter always shows the current
// controlled value.
describe("Property 1: draft authority", () => {
    test("the mounted adapter displays the controlled value", () => {
        fc.assert(
            fc.property(fc.string(), (text) => {
                const { getByTestId, unmount } = render(
                    <ControlledHost initial={text} mode="visual" />,
                );
                const area = getByTestId("double-visual") as HTMLTextAreaElement;
                expect(area.value).toBe(text);
                unmount();
            }),
            RUNS,
        );
    });
});

// Property 2: No Synchronization Feedback Loop — initializing/syncing from the
// controlled value emits no onChange.
describe("Property 2: no synchronization feedback", () => {
    test("initialization emits zero onChange callbacks", () => {
        fc.assert(
            fc.property(fc.string(), (text) => {
                const spy = mock((_v: string) => {});
                const { unmount } = render(
                    <ControlledHost
                        initial={text}
                        mode="visual"
                        onChangeSpy={spy}
                    />,
                );
                expect(spy).toHaveBeenCalledTimes(0);
                unmount();
            }),
            RUNS,
        );
    });
});

// Property 3: Single Mounted Implementation — only one adapter is mounted for a
// given mode, and switching mode mounts exactly the other one.
describe("Property 3: single mounted implementation", () => {
    test("exactly one adapter is mounted per mode", () => {
        fc.assert(
            fc.property(
                fc.constantFrom<"visual" | "vim">("visual", "vim"),
                (mode) => {
                    visualMounts = 0;
                    vimMounts = 0;
                    const { queryByTestId, unmount } = render(
                        <ControlledHost initial="x" mode={mode} />,
                    );
                    const hasVisual = queryByTestId("double-visual") !== null;
                    const hasVim = queryByTestId("double-vim") !== null;
                    expect(hasVisual && hasVim).toBe(false);
                    expect(hasVisual || hasVim).toBe(true);
                    if (mode === "visual") {
                        expect(hasVisual).toBe(true);
                    } else {
                        expect(hasVim).toBe(true);
                    }
                    unmount();
                },
            ),
            RUNS,
        );
    });
});

// Property 5 (shell plumbing): the submit shortcut reaches onSubmitShortcut once
// and never for a plain Enter.
describe("Property 5: submit shortcut plumbing", () => {
    test("Ctrl+Enter triggers the shortcut exactly once; plain Enter never does", async () => {
        const submitSpy = mock(() => {});
        const { getByTestId, unmount } = render(
            <MdxEditor
                value="hello"
                onChange={() => {}}
                mode="visual"
                sizing={{ mode: "content", minRows: 4 }}
                toolbarWidth="100%"
                ariaLabel="draft"
                onSubmitShortcut={submitSpy}
            />,
        );
        const area = getByTestId("double-visual");
        await act(async () => {
            const { fireEvent } = await import("@testing-library/react");
            fireEvent.keyDown(area, { key: "Enter" });
            fireEvent.keyDown(area, { key: "Enter", ctrlKey: true });
        });
        expect(submitSpy).toHaveBeenCalledTimes(1);
        unmount();
    });
});

describe("toSizingStyle shell wiring", () => {
    test("shell style carries sizing variables", () => {
        const style = toSizingStyle({ mode: "fixed", height: "100%" }, "100%");
        expect(style["--mdx-editor-height"]).toBe("100%");
    });
});
