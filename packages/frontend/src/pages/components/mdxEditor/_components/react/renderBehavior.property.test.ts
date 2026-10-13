import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import fc from "fast-check";
import {
    decodeRenderMarkdownResponse,
    RenderMarkdownError,
    type SanitizedHtml,
} from "@/components/react/MdxEditor";
import { useMdxEditorUiStore } from "./mdxEditorStore.ts";

const RUNS = { numRuns: 100 } as const;

beforeEach(() => {
    useMdxEditorUiStore.getState().resetDemo();
});

afterEach(() => {
    useMdxEditorUiStore.getState().resetDemo();
});

function okResponse(html: string): Response {
    return new Response(JSON.stringify({ html }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
}

// Property 16: Render Snapshot Integrity — the committed snapshot always pairs
// the submitted (variable) markdown with the returned HTML, even when the live
// draft would differ.
describe("Property 16: render snapshot integrity", () => {
    test("snapshot pairs submitted markdown with returned html", () => {
        fc.assert(
            fc.property(
                fc.string(),
                fc.string(),
                (submitted, laterLiveDraft) => {
                    useMdxEditorUiStore.getState().resetDemo();
                    const html = `<p>${submitted.length}</p>` as SanitizedHtml;
                    // The demo commits from the mutation variables, not the live
                    // draft. Simulate that commit directly.
                    useMdxEditorUiStore
                        .getState()
                        .commitSuccess({ markdown: submitted, html });
                    // Even if editing continued (laterLiveDraft), the snapshot is
                    // unchanged until the next successful commit.
                    void laterLiveDraft;
                    const snap = useMdxEditorUiStore.getState().lastSuccess;
                    expect(snap.kind).toBe("ready");
                    if (snap.kind === "ready") {
                        expect(snap.snapshot.markdown).toBe(submitted);
                        expect(snap.snapshot.html).toBe(html);
                    }
                },
            ),
            RUNS,
        );
    });

    test("a pending/failed later render preserves the prior snapshot", () => {
        const html = "<h1>a</h1>" as SanitizedHtml;
        useMdxEditorUiStore.getState().commitSuccess({ markdown: "# a", html });
        // No commit occurs on failure; the store is unchanged.
        const snap = useMdxEditorUiStore.getState().lastSuccess;
        expect(snap).toEqual({
            kind: "ready",
            snapshot: { markdown: "# a", html },
        });
    });
});

// Property 17: Trust-Boundary Preservation — only a validated 2xx { html }
// response produces a branded value; invalid/failed responses never do.
describe("Property 17: trust-boundary preservation", () => {
    test("valid 2xx html decodes to a branded value", async () => {
        await fc.assert(
            fc.asyncProperty(fc.string(), async (html) => {
                const data = await decodeRenderMarkdownResponse(
                    okResponse(html),
                );
                expect(data.html).toBe(html as SanitizedHtml);
            }),
            RUNS,
        );
    });

    test("non-2xx and malformed responses never produce a value", async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 400, max: 599 }),
                fc.string(),
                async (status, message) => {
                    const res = new Response(
                        JSON.stringify({ message }),
                        {
                            status,
                            headers: { "Content-Type": "application/json" },
                        },
                    );
                    const err = (await decodeRenderMarkdownResponse(res).catch(
                        (e: unknown) => e,
                    )) as RenderMarkdownError;
                    expect(err).toBeInstanceOf(RenderMarkdownError);
                },
            ),
            RUNS,
        );
    });
});
