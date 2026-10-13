import { beforeEach, describe, expect, test } from "bun:test";
import type { SanitizedHtml } from "./renderMarkdownClient.ts";
import {
    DEFAULT_UI_STATE,
    useMdxEditorUiStore,
} from "./mdxEditorStore.ts";

const html = (s: string) => s as SanitizedHtml;

beforeEach(() => {
    useMdxEditorUiStore.getState().resetDemo();
});

describe("mdxEditorStore defaults", () => {
    test("initializes to visual / markdown / empty", () => {
        const s = useMdxEditorUiStore.getState();
        expect(s.editorMode).toBe("visual");
        expect(s.selectedOutputTab).toBe("markdown");
        expect(s.lastSuccess).toEqual({ kind: "empty" });
    });

    test("exposes only the declared state fields", () => {
        const stateKeys = Object.keys(useMdxEditorUiStore.getState()).filter(
            (k) => typeof (useMdxEditorUiStore.getState() as Record<string, unknown>)[k] !== "function",
        );
        expect(stateKeys.sort()).toEqual(
            ["editorMode", "lastSuccess", "selectedOutputTab"].sort(),
        );
    });
});

describe("mdxEditorStore transitions", () => {
    test("setEditorMode and setSelectedOutputTab update only their field", () => {
        useMdxEditorUiStore.getState().setEditorMode("vim");
        useMdxEditorUiStore.getState().setSelectedOutputTab("preview");
        const s = useMdxEditorUiStore.getState();
        expect(s.editorMode).toBe("vim");
        expect(s.selectedOutputTab).toBe("preview");
        expect(s.lastSuccess).toEqual({ kind: "empty" });
    });

    test("commitSuccess stores one atomic ready snapshot", () => {
        useMdxEditorUiStore
            .getState()
            .commitSuccess({ markdown: "# a", html: html("<h1>a</h1>") });
        expect(useMdxEditorUiStore.getState().lastSuccess).toEqual({
            kind: "ready",
            snapshot: { markdown: "# a", html: html("<h1>a</h1>") },
        });
    });

    test("a later commitSuccess atomically replaces the prior snapshot", () => {
        const store = useMdxEditorUiStore.getState();
        store.commitSuccess({ markdown: "# a", html: html("<h1>a</h1>") });
        store.commitSuccess({ markdown: "# b", html: html("<h1>b</h1>") });
        expect(useMdxEditorUiStore.getState().lastSuccess).toEqual({
            kind: "ready",
            snapshot: { markdown: "# b", html: html("<h1>b</h1>") },
        });
    });

    test("changing mode or tab preserves lastSuccess", () => {
        const store = useMdxEditorUiStore.getState();
        store.commitSuccess({ markdown: "# a", html: html("<h1>a</h1>") });
        store.setEditorMode("vim");
        store.setSelectedOutputTab("html-source");
        expect(useMdxEditorUiStore.getState().lastSuccess).toEqual({
            kind: "ready",
            snapshot: { markdown: "# a", html: html("<h1>a</h1>") },
        });
    });

    test("resetDemo restores the documented defaults", () => {
        const store = useMdxEditorUiStore.getState();
        store.setEditorMode("vim");
        store.setSelectedOutputTab("preview");
        store.commitSuccess({ markdown: "# a", html: html("<h1>a</h1>") });
        store.resetDemo();
        expect(useMdxEditorUiStore.getState()).toMatchObject(DEFAULT_UI_STATE);
    });
});
