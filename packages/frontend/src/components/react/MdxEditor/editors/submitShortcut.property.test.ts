import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { isSubmitShortcut, type KeyEventLike } from "./submitShortcut.ts";

/**
 * Property 4: the submit-shortcut classifier is well-defined.
 *
 * Feature: mdx-editor-ui-refinements
 *
 * `isSubmitShortcut` must report true if and only if the key is "Enter" with
 * either Control or Meta held. The `:w`/`:wq` Ex commands do not change this —
 * Ctrl/Cmd+Enter must still route to the guarded submit (Requirement 3.7).
 */
describe("Feature: mdx-editor-ui-refinements, Property 4: submit shortcut classifier is well-defined", () => {
    const keyArb = fc.oneof(
        fc.constant("Enter"),
        fc.constant("a"),
        fc.constant("Escape"),
        fc.constant(" "),
        fc.string(),
    );

    test("true iff Enter with Control or Meta", () => {
        fc.assert(
            fc.property(
                keyArb,
                fc.boolean(),
                fc.boolean(),
                (key, ctrlKey, metaKey) => {
                    const event: KeyEventLike = { key, ctrlKey, metaKey };
                    const expected = key === "Enter" && (ctrlKey || metaKey);
                    expect(isSubmitShortcut(event)).toBe(expected);
                },
            ),
            { numRuns: 300 },
        );
    });

    test("plain Enter (no modifiers) is never the submit gesture", () => {
        fc.assert(
            fc.property(fc.constant("Enter"), (key) => {
                expect(
                    isSubmitShortcut({ key, ctrlKey: false, metaKey: false }),
                ).toBe(false);
            }),
            { numRuns: 50 },
        );
    });
});
