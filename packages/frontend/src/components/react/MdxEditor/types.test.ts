import { describe, expect, test } from "bun:test";
import {
    assertValidSizing,
    toSizingStyle,
    type EditorSizing,
} from "./types.ts";

describe("toSizingStyle", () => {
    test("fixed sizing emits a height variable and the toolbar width", () => {
        const style = toSizingStyle({ mode: "fixed", height: "100%" }, "100%");
        expect(style["--mdx-editor-height"]).toBe("100%");
        expect(style["--mdx-editor-toolbar-width"]).toBe("100%");
        expect(style["--mdx-editor-min-rows"]).toBeUndefined();
    });

    test("content sizing emits a min-rows variable and the toolbar width", () => {
        const style = toSizingStyle({ mode: "content", minRows: 4 }, "100%");
        expect(style["--mdx-editor-min-rows"]).toBe(4);
        expect(style["--mdx-editor-toolbar-width"]).toBe("100%");
        expect(style["--mdx-editor-height"]).toBeUndefined();
    });

    test("passes a numeric toolbar width through unchanged", () => {
        const style = toSizingStyle({ mode: "content", minRows: 4 }, 480);
        expect(style["--mdx-editor-toolbar-width"]).toBe(480);
    });
});

describe("assertValidSizing", () => {
    test("accepts fixed sizing without inspecting rows", () => {
        expect(() =>
            assertValidSizing({ mode: "fixed", height: "42vh" }),
        ).not.toThrow();
    });

    test("accepts a positive integer row count", () => {
        expect(() =>
            assertValidSizing({ mode: "content", minRows: 4 }),
        ).not.toThrow();
    });

    test.each([
        ["zero", 0],
        ["negative", -1],
        ["fractional", 2.5],
        ["NaN", Number.NaN],
        ["Infinity", Number.POSITIVE_INFINITY],
    ])("rejects a %s row count in development", (_name, minRows) => {
        const sizing = { mode: "content", minRows } as EditorSizing;
        // import.meta.env.MODE is "development" under bun test unless overridden,
        // but guard both: assertion must either throw or (in prod) be a no-op.
        const isDev =
            (import.meta.env?.DEV ?? import.meta.env?.MODE === "development") ===
            true;
        if (isDev) {
            expect(() => assertValidSizing(sizing)).toThrow();
        } else {
            expect(() => assertValidSizing(sizing)).not.toThrow();
        }
    });
});
