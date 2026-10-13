import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { dispatchExCommand, type VimExHandlers } from "./vimExCommands.ts";

/**
 * Property tests for the pure Vim Ex-command dispatcher.
 *
 * Feature: mdx-editor-ui-refinements
 *
 * The document content is irrelevant to dispatch, but each property generates
 * an arbitrary content string to model "for any editor content". Handlers are
 * spy counters that also record a monotonic call order so ordering can be
 * asserted.
 */

type Recorder = {
    submitCalls: number;
    closeCalls: number;
    order: Array<"submit" | "close">;
};

function makeHandlers(
    includeSubmit: boolean,
    includeClose: boolean,
): { handlers: VimExHandlers; rec: Recorder } {
    const rec: Recorder = { submitCalls: 0, closeCalls: 0, order: [] };
    const handlers: VimExHandlers = {
        submit: includeSubmit
            ? () => {
                  rec.submitCalls += 1;
                  rec.order.push("submit");
              }
            : undefined,
        close: includeClose
            ? () => {
                  rec.closeCalls += 1;
                  rec.order.push("close");
              }
            : undefined,
    };
    return { handlers, rec };
}

describe("Feature: mdx-editor-ui-refinements, Property 1: :w submits exactly once and never closes", () => {
    test("for any content and handler presence, :w submits once (if present) and never closes", () => {
        fc.assert(
            fc.property(
                fc.string(),
                fc.boolean(),
                fc.boolean(),
                (_content, includeSubmit, includeClose) => {
                    const { handlers, rec } = makeHandlers(
                        includeSubmit,
                        includeClose,
                    );
                    dispatchExCommand("w", handlers);
                    expect(rec.submitCalls).toBe(includeSubmit ? 1 : 0);
                    expect(rec.closeCalls).toBe(0);
                },
            ),
            { numRuns: 200 },
        );
    });
});

describe("Feature: mdx-editor-ui-refinements, Property 2: :wq submits then closes, each exactly once, in order", () => {
    test("for any content, :wq calls submit once then close once, submit strictly before close", () => {
        fc.assert(
            fc.property(fc.string(), (_content) => {
                const { handlers, rec } = makeHandlers(true, true);
                dispatchExCommand("wq", handlers);
                expect(rec.submitCalls).toBe(1);
                expect(rec.closeCalls).toBe(1);
                expect(rec.order).toEqual(["submit", "close"]);
            }),
            { numRuns: 200 },
        );
    });
});

describe("Feature: mdx-editor-ui-refinements, Property 3: :wq with no close handler submits once and performs no close", () => {
    test("for any content, :wq without a close handler submits once, no close, no throw", () => {
        fc.assert(
            fc.property(fc.string(), fc.boolean(), (_content, includeSubmit) => {
                const { handlers, rec } = makeHandlers(includeSubmit, false);
                expect(() => dispatchExCommand("wq", handlers)).not.toThrow();
                expect(rec.submitCalls).toBe(includeSubmit ? 1 : 0);
                expect(rec.closeCalls).toBe(0);
            }),
            { numRuns: 200 },
        );
    });
});
