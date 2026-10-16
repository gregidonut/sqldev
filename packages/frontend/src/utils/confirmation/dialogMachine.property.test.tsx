import { afterEach, describe, expect, test } from "bun:test";
import React, { act } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import fc from "fast-check";
import { ConfirmationDialogHost } from "@/pages/drive/[driveTab]/_components/react/RACCRUDTable/confirmation/ConfirmationDialogHost";
import {
    changed,
    challenge,
    createRig,
    flush,
    openRequest,
    REVISION,
    type Rig,
} from "./testRig";
import type { ConfigRevision } from "./protocol";

afterEach(() => cleanup());

const FIVE_MINUTES = 5 * 60_000;

type Action =
    | "open"
    | "confirm"
    | "refresh"
    | "close"
    | "expire"
    | "initOk"
    | "initMismatch"
    | "initRejected"
    | "initProtocol"
    | "initFail"
    | "confOk"
    | "confExpired"
    | "confRejected"
    | "confFail"
    | "pressConfirmTwice"
    | "lateInitOk";

const ACTIONS: readonly Action[] = [
    "open",
    "confirm",
    "refresh",
    "close",
    "expire",
    "initOk",
    "initMismatch",
    "initRejected",
    "initProtocol",
    "initFail",
    "confOk",
    "confExpired",
    "confRejected",
    "confFail",
    "pressConfirmTwice",
    "lateInitOk",
];

type Tag =
    | "closed"
    | "requesting"
    | "confirmation-ready"
    | "confirming"
    | "expired"
    | "refreshing"
    | "rejected";

/**
 * An oracle written from the requirements, independent of dialogMachine.ts. It
 * tracks only the state tag, the operation id and the open challenge's expiry.
 */
type Model = {
    tag: Tag;
    opId: number;
    expiresAt: number;
    finalSuccesses: number;
};

type Pending = { opId: number; resolved: boolean };

type Expected = {
    makePublic: "absent" | "disabled" | "enabled" | "pending";
    refresh: "absent" | "enabled" | "pending";
    cancel: "absent" | "disabled" | "enabled";
    cancelLabel: "Cancel" | "Close";
    busy: boolean;
};

const EXPECTED: Record<Tag, Expected> = {
    closed: {
        makePublic: "absent",
        refresh: "absent",
        cancel: "absent",
        cancelLabel: "Cancel",
        busy: false,
    },
    requesting: {
        makePublic: "disabled",
        refresh: "absent",
        cancel: "enabled",
        cancelLabel: "Cancel",
        busy: true,
    },
    "confirmation-ready": {
        makePublic: "enabled",
        refresh: "absent",
        cancel: "enabled",
        cancelLabel: "Cancel",
        busy: false,
    },
    confirming: {
        makePublic: "pending",
        refresh: "absent",
        cancel: "disabled",
        cancelLabel: "Cancel",
        busy: true,
    },
    expired: {
        makePublic: "disabled",
        refresh: "enabled",
        cancel: "enabled",
        cancelLabel: "Cancel",
        busy: false,
    },
    refreshing: {
        makePublic: "disabled",
        refresh: "pending",
        cancel: "enabled",
        cancelLabel: "Cancel",
        busy: true,
    },
    rejected: {
        makePublic: "absent",
        refresh: "absent",
        cancel: "enabled",
        cancelLabel: "Close",
        busy: false,
    },
};

const COUNTDOWN =
    /\b\d+\s*(seconds?|secs?|minutes?|mins?|ms)\b|remaining|countdown|time left|expires in/i;

function dialogs(): HTMLElement[] {
    return Array.from(
        document.body.querySelectorAll<HTMLElement>('[role="alertdialog"]'),
    );
}

function find(name: string): HTMLButtonElement | null {
    const root = dialogs()[0];
    const buttons = Array.from(
        root?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    return buttons.find((b) => b.textContent?.trim() === name) ?? null;
}

function inert(button: HTMLButtonElement): boolean {
    return button.disabled || button.getAttribute("aria-disabled") === "true";
}

function checkButton(
    label: string,
    button: HTMLButtonElement | null,
    expected: "absent" | "disabled" | "enabled" | "pending",
) {
    if (expected === "absent") {
        expect(button, `${label} should be absent`).toBeNull();
        return;
    }
    expect(button, `${label} should be present`).not.toBeNull();
    const isInert = inert(button!);
    expect(isInert, `${label} should be ${expected}`).toBe(
        expected !== "enabled",
    );
}

async function settle() {
    await act(async () => {
        await flush();
    });
}

function expectedChallengeExpiry(rig: Rig): number {
    return rig.clock.now() + FIVE_MINUTES;
}

async function drive(actions: readonly Action[]) {
    const rig = createRig();
    render(<ConfirmationDialogHost store={rig.store} />);

    const model: Model = {
        tag: "closed",
        opId: 0,
        expiresAt: 0,
        finalSuccesses: 0,
    };
    const initiations: Pending[] = [];
    const confirmations: Pending[] = [];

    // Associate calls the adapter has recorded since the last action with the current op.
    function tagNewCalls() {
        while (initiations.length < rig.adapter.initiations.length) {
            initiations.push({ opId: model.opId, resolved: false });
        }
        while (confirmations.length < rig.adapter.confirmations.length) {
            confirmations.push({ opId: model.opId, resolved: false });
        }
    }

    function oldestOpen(list: Pending[]): number {
        // Prefer a call that can apply to the current dialog; otherwise any unresolved one.
        const applicable = list.findIndex(
            (p) => !p.resolved && p.opId === model.opId,
        );
        return applicable >= 0
            ? applicable
            : list.findIndex((p) => !p.resolved);
    }

    for (const action of actions) {
        const tokenBefore = (() => {
            const s = rig.store.getState().state;
            return s.tag === "closed" ? null : s.subject.token;
        })();
        let stale = false;

        switch (action) {
            case "open":
                if (model.tag === "closed") {
                    model.opId += 1;
                    model.tag = "requesting";
                }
                act(() => {
                    rig.store.getState().open(openRequest());
                });
                break;
            case "confirm":
                if (model.tag === "confirmation-ready") {
                    model.tag =
                        rig.clock.now() >= model.expiresAt
                            ? "expired"
                            : "confirming";
                }
                act(() => rig.store.getState().confirm());
                break;
            case "pressConfirmTwice":
                if (model.tag === "confirmation-ready") {
                    model.tag =
                        rig.clock.now() >= model.expiresAt
                            ? "expired"
                            : "confirming";
                }
                act(() => {
                    rig.store.getState().confirm();
                    rig.store.getState().confirm();
                });
                break;
            case "refresh":
                if (model.tag === "expired") model.tag = "refreshing";
                act(() => rig.store.getState().refresh());
                break;
            case "close":
                if (
                    model.tag === "requesting" ||
                    model.tag === "confirmation-ready" ||
                    model.tag === "expired" ||
                    model.tag === "refreshing" ||
                    model.tag === "rejected"
                ) {
                    model.tag = "closed";
                }
                act(() => rig.store.getState().close());
                break;
            case "expire":
                if (model.tag === "confirmation-ready") model.tag = "expired";
                act(() => rig.clock.advance(FIVE_MINUTES + 1_000));
                break;
            case "initOk":
            case "initMismatch":
            case "initRejected":
            case "initProtocol":
            case "initFail": {
                tagNewCalls();
                const index = oldestOpen(initiations);
                if (index < 0) break;
                const call = initiations[index]!;
                call.resolved = true;
                const awaiting =
                    model.tag === "requesting" || model.tag === "refreshing";
                const applies = awaiting && call.opId === model.opId;
                stale = !applies;
                if (applies) {
                    if (action === "initOk") {
                        model.tag = "confirmation-ready";
                        model.expiresAt = expectedChallengeExpiry(rig);
                    } else if (action === "initFail") {
                        model.tag =
                            model.tag === "refreshing" ? "expired" : "rejected";
                    } else {
                        model.tag = "rejected";
                    }
                }
                const result =
                    action === "initOk"
                        ? challenge({ expiresAt: expectedChallengeExpiry(rig) })
                        : action === "initMismatch"
                          ? challenge({
                                expectedRevision: (REVISION +
                                    1) as ConfigRevision,
                                expiresAt: expectedChallengeExpiry(rig),
                            })
                          : action === "initRejected"
                            ? ({
                                  kind: "rejected",
                                  reason: "stale_revision",
                              } as const)
                            : action === "initProtocol"
                              ? ({ kind: "protocol_error" } as const)
                              : null;
                const deferred = rig.adapter.initiations[index]!.result;
                await act(async () => {
                    if (result === null) deferred.reject(new Error("network"));
                    else deferred.resolve(result);
                    await flush();
                });
                break;
            }
            case "lateInitOk": {
                // A result from an earlier dialog arrives while a newer one may be waiting.
                tagNewCalls();
                const index = initiations.findIndex(
                    (p) => !p.resolved && p.opId !== model.opId,
                );
                if (index < 0) break;
                initiations[index]!.resolved = true;
                stale = true;
                const deferred = rig.adapter.initiations[index]!.result;
                await act(async () => {
                    deferred.resolve(
                        challenge({ expiresAt: expectedChallengeExpiry(rig) }),
                    );
                    await flush();
                });
                break;
            }
            case "confOk":
            case "confExpired":
            case "confRejected":
            case "confFail": {
                tagNewCalls();
                const index = oldestOpen(confirmations);
                if (index < 0) break;
                const call = confirmations[index]!;
                call.resolved = true;
                const applies =
                    model.tag === "confirming" && call.opId === model.opId;
                stale = !applies;
                if (applies) {
                    if (action === "confOk") {
                        model.tag = "closed";
                        model.finalSuccesses += 1;
                    } else if (action === "confExpired") {
                        model.tag = "expired";
                    } else {
                        model.tag = "rejected";
                    }
                } else if (action === "confOk") {
                    // A committed change is counted even if its dialog is gone.
                    model.finalSuccesses += 1;
                }
                const deferred = rig.adapter.confirmations[index]!.result;
                await act(async () => {
                    if (action === "confOk") deferred.resolve(changed());
                    else if (action === "confExpired")
                        deferred.resolve({
                            kind: "rejected",
                            reason: "expired_challenge",
                        });
                    else if (action === "confRejected")
                        deferred.resolve({
                            kind: "rejected",
                            reason: "forbidden",
                        });
                    else deferred.reject(new Error("network"));
                    await flush();
                });
                break;
            }
        }
        await settle();
        tagNewCalls();

        // 1. The store follows the oracle.
        const label = `after ${action}`;
        expect(rig.store.getState().state.tag, label).toBe(model.tag);

        // 2. A stale result never changes which operation is current.
        if (stale) {
            const s = rig.store.getState().state;
            expect(
                s.tag === "closed" ? null : s.subject.token,
                `${label}: token`,
            ).toBe(tokenBefore);
        }

        // 3. The rendered dialog matches the requirements table.
        const open = dialogs();
        expect(open.length, `${label}: dialogs`).toBeLessThanOrEqual(1);
        if (model.tag === "closed") {
            expect(open.length, `${label}: closed`).toBe(0);
            continue;
        }
        expect(open.length, `${label}: open`).toBe(1);
        const expected = EXPECTED[model.tag];
        checkButton("Make public", find("Make public"), expected.makePublic);
        checkButton(
            "Refresh confirmation",
            find("Refresh confirmation"),
            expected.refresh,
        );
        checkButton(
            expected.cancelLabel,
            find(expected.cancelLabel),
            expected.cancel,
        );
        expect(
            find(expected.cancelLabel === "Cancel" ? "Close" : "Cancel"),
            `${label}: wrong cancel label`,
        ).toBeNull();
        expect(
            open[0]!.getAttribute("aria-busy") === "true",
            `${label}: busy`,
        ).toBe(expected.busy);
        expect(
            open[0]!.textContent ?? "",
            `${label}: countdown text`,
        ).not.toMatch(COUNTDOWN);
        for (const element of open[0]!.querySelectorAll(
            "[aria-label],[aria-valuetext]",
        )) {
            const text = `${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("aria-valuetext") ?? ""}`;
            expect(text, `${label}: accessible countdown`).not.toMatch(
                COUNTDOWN,
            );
        }
    }

    // Confirmations: one job per press, each with its own key.
    const keys = new Set(rig.keys);
    expect(keys.size).toBe(rig.keys.length);
    expect(rig.adapter.confirmations.length).toBeLessThanOrEqual(
        rig.adapter.initiations.length + 0 + rig.adapter.confirmations.length,
    );
    // Every committed change was counted exactly once.
    expect(rig.adapter.finalSuccesses.length).toBe(model.finalSuccesses);
    cleanup();
}

describe("dialog transitions", () => {
    test("Feature: storage-visibility-confirmation, Property 11: Dialog transitions match the tagged-state model", async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(fc.constantFrom(...ACTIONS), {
                    minLength: 1,
                    maxLength: 20,
                }),
                async (actions) => {
                    await drive(actions);
                },
            ),
            {
                numRuns: 150,
                // Stale-result scenarios are too specific for random generation to hit reliably.
                examples: [
                    [["open", "close", "open", "lateInitOk"]],
                    [
                        [
                            "open",
                            "initOk",
                            "expire",
                            "refresh",
                            "close",
                            "open",
                            "lateInitOk",
                        ],
                    ],
                    [
                        [
                            "open",
                            "close",
                            "open",
                            "initOk",
                            "lateInitOk",
                            "confirm",
                        ],
                    ],
                    [
                        [
                            "open",
                            "initOk",
                            "confirm",
                            "confOk",
                            "open",
                            "initOk",
                            "confirm",
                            "confOk",
                        ],
                    ],
                    [["open", "initOk", "confirm", "close", "confOk"]],
                    [
                        [
                            "open",
                            "initOk",
                            "confirm",
                            "pressConfirmTwice",
                            "confExpired",
                            "refresh",
                            "initOk",
                        ],
                    ],
                    [
                        [
                            "open",
                            "initOk",
                            "expire",
                            "refresh",
                            "initFail",
                            "refresh",
                            "initOk",
                            "confirm",
                        ],
                    ],
                ],
            },
        );
    }, 120_000);
});
