import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { cleanup } from "@testing-library/react";
import fc from "fast-check";
import { restoreFocusNow } from "./confirmationStore";
import { resolveFocusTarget } from "./focusRestore";
import { challenge, createRig, flush, openRequest } from "./testRig";

afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
});

type Phase = "requesting" | "confirmation-ready" | "expired" | "refreshing";
type Availability = "origin" | "row" | "none";

/** A page with a heading, a row, and (optionally) the menu trigger inside the row. */
function buildPage(available: Availability) {
    document.body.innerHTML = `
        <h1 id="page-heading">Drive</h1>
        <div id="grid">
            <div data-key="row-1" tabindex="0" id="row">
                ${available === "origin" ? '<button id="origin">Actions</button>' : ""}
            </div>
        </div>`;
    if (available === "none") document.getElementById("row")?.remove();
    return {
        origin: document.getElementById("origin") as HTMLElement | null,
        row: document.getElementById("row"),
        heading: document.getElementById("page-heading")!,
    };
}

describe("cancel and stale results", () => {
    test("Feature: storage-visibility-confirmation, Property 14: Cancel and stale async results are mutation-free UI no-ops", async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.constantFrom<Phase>(
                    "requesting",
                    "confirmation-ready",
                    "expired",
                    "refreshing",
                ),
                fc.constantFrom<"cancel" | "closeCall">("cancel", "closeCall"),
                fc.constantFrom<Availability>("origin", "row", "none"),
                fc.boolean(),
                async (phase, how, available, lateResult) => {
                    const page = buildPage(available);
                    const rig = createRig();
                    const focus = { origin: page.origin, rowKey: "row-1" };

                    // Open with the real focus targets.
                    rig.store.getState().open(openRequest({ focus }));
                    if (phase !== "requesting") {
                        rig.adapter.initiations[0]!.result.resolve(
                            challenge({ expiresInMs: 1_000 }),
                        );
                        await flush();
                        if (phase !== "confirmation-ready") {
                            rig.clock.advance(1_000);
                            if (phase === "refreshing")
                                rig.store.getState().refresh();
                        }
                    }
                    expect(rig.store.getState().state.tag).toBe(phase);

                    const invalidations = rig.adapter.finalSuccesses.length;
                    const confirmationsBefore =
                        rig.adapter.confirmations.length;
                    const lastInitiation =
                        rig.adapter.initiations[
                            rig.adapter.initiations.length - 1
                        ]!;

                    // Dismiss through the store, which is what Cancel, Escape and an
                    // outside press all call.
                    act(() => rig.store.getState().close());
                    expect(rig.store.getState().state.tag).toBe("closed");

                    // A request still in flight for the closed dialog is aborted.
                    if (phase === "requesting" || phase === "refreshing") {
                        expect(lastInitiation.signal?.aborted).toBe(true);
                    }
                    if (lateResult) {
                        lastInitiation.result.resolve(challenge());
                        await flush();
                    }

                    // Nothing was submitted, invalidated, or reopened.
                    expect(rig.adapter.confirmations.length).toBe(
                        confirmationsBefore,
                    );
                    expect(rig.adapter.finalSuccesses.length).toBe(
                        invalidations,
                    );
                    expect(rig.store.getState().state.tag).toBe("closed");

                    // Focus goes to the origin, else the row, else the heading (never body).
                    expect(rig.focusRestored).toHaveLength(1);
                    const target = resolveFocusTarget(rig.focusRestored[0]!);
                    const expected =
                        available === "origin"
                            ? page.origin
                            : available === "row"
                              ? page.row
                              : page.heading;
                    expect(target).toBe(expected);

                    // restoreFocusNow focuses it when React Aria left focus on nothing.
                    (document.activeElement as HTMLElement | null)?.blur();
                    restoreFocusNow(rig.focusRestored[0]!);
                    expect(document.activeElement).toBe(expected);
                },
            ),
            { numRuns: 120 },
        );
    });

    test("focus already placed by the modal is left alone", () => {
        buildPage("origin");
        const origin = document.getElementById("origin")!;
        const row = document.getElementById("row")!;
        row.focus();
        restoreFocusNow({ origin, rowKey: "row-1" });
        expect(document.activeElement).toBe(row);
    });

    test("a detached origin falls back to the row, then the heading", () => {
        const page = buildPage("origin");
        const detached = page.origin!;
        detached.remove();
        expect(resolveFocusTarget({ origin: detached, rowKey: "row-1" })).toBe(
            page.row,
        );
        page.row!.remove();
        expect(resolveFocusTarget({ origin: detached, rowKey: "row-1" })).toBe(
            page.heading,
        );
        expect(page.heading.getAttribute("tabindex")).toBe("-1");
    });

    test("a disabled origin is skipped", () => {
        const page = buildPage("origin");
        (page.origin as HTMLButtonElement).disabled = true;
        expect(
            resolveFocusTarget({ origin: page.origin, rowKey: "row-1" }),
        ).toBe(page.row);
    });

    test("a row key with special characters cannot break the selector", () => {
        buildPage("row");
        expect(() =>
            resolveFocusTarget({ origin: null, rowKey: 'a"] , body [x="' }),
        ).not.toThrow();
    });
});
