import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { createFinalSuccessLedger } from "./finalSuccessLedger";
import { changed, challenge, createRig, flush, openRequest } from "./testRig";
import { asIdempotencyKey, REJECTION_REASONS } from "./protocol";

type Outcome =
    | "required"
    | "changed"
    | "rejected"
    | "protocolError"
    | "failure"
    | "cancel"
    | "refresh"
    | "expiry"
    | "duplicateChanged"
    | "changedAfterClose";

const OUTCOMES: readonly Outcome[] = [
    "required",
    "changed",
    "rejected",
    "protocolError",
    "failure",
    "cancel",
    "refresh",
    "expiry",
    "duplicateChanged",
    "changedAfterClose",
];

describe("final success ledger", () => {
    test("records a key at most once", () => {
        const ledger = createFinalSuccessLedger();
        let calls = 0;
        const key = asIdempotencyKey("k1");
        expect(ledger.record(key, () => calls++)).toBe(true);
        expect(ledger.record(key, () => calls++)).toBe(false);
        expect(ledger.record(asIdempotencyKey("k2"), () => calls++)).toBe(true);
        expect(calls).toBe(2);
    });

    test("Feature: storage-visibility-confirmation, Property 12: Cache invalidation occurs if and only if visibility commits", async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.constantFrom(...OUTCOMES),
                fc.constantFrom(...REJECTION_REASONS),
                fc.integer({ min: 1, max: 4 }),
                async (outcome, reason, deliveries) => {
                    const rig = createRig();
                    const store = rig.store.getState();
                    store.open(openRequest());
                    const initiation = rig.adapter.initiations[0]!;
                    let committed = 0;

                    switch (outcome) {
                        case "required":
                            initiation.result.resolve(challenge());
                            break;
                        case "rejected":
                            initiation.result.resolve({
                                kind: "rejected",
                                reason,
                            });
                            break;
                        case "protocolError":
                            initiation.result.resolve({
                                kind: "protocol_error",
                            });
                            break;
                        case "failure":
                            initiation.result.reject(new Error("network"));
                            break;
                        case "cancel":
                            store.close();
                            initiation.result.resolve(challenge());
                            break;
                        case "refresh":
                            initiation.result.resolve(
                                challenge({ expiresInMs: 1_000 }),
                            );
                            await flush();
                            rig.clock.advance(1_000);
                            rig.store.getState().refresh();
                            rig.adapter.initiations[1]!.result.resolve(
                                challenge(),
                            );
                            break;
                        case "expiry":
                            initiation.result.resolve(
                                challenge({ expiresInMs: 1_000 }),
                            );
                            await flush();
                            rig.clock.advance(5_000);
                            break;
                        case "changed":
                        case "duplicateChanged":
                        case "changedAfterClose": {
                            initiation.result.resolve(challenge());
                            await flush();
                            rig.store.getState().confirm();
                            const confirmation = rig.adapter.confirmations[0]!;
                            if (outcome === "changedAfterClose") {
                                // The person cannot dismiss a submitted confirmation, but a
                                // late delivery for a replaced dialog must still count once.
                                rig.store.getState().close();
                            }
                            const times =
                                outcome === "duplicateChanged" ? deliveries : 1;
                            for (let i = 0; i < times; i += 1) {
                                confirmation.result.resolve(changed());
                            }
                            committed = 1;
                            break;
                        }
                    }
                    await flush();
                    await flush();
                    expect(rig.adapter.finalSuccesses.length, outcome).toBe(
                        committed,
                    );
                },
            ),
            { numRuns: 150 },
        );
    });

    test("a committed change counts once even when its dialog was already replaced", async () => {
        const rig = createRig();
        rig.store.getState().open(openRequest());
        rig.adapter.initiations[0]!.result.resolve(challenge());
        await flush();
        rig.store.getState().confirm();
        const confirmation = rig.adapter.confirmations[0]!;
        // Same key delivered twice, as a retried poll could.
        confirmation.result.resolve(changed());
        await flush();
        expect(rig.store.getState().state.tag).toBe("closed");

        rig.store.getState().open(openRequest({ label: "second.pdf" }));
        expect(rig.adapter.finalSuccesses).toHaveLength(1);
        expect(rig.store.getState().state.tag).toBe("requesting");
    });

    test("recordFinalSuccess counts a direct change once per key", () => {
        const rig = createRig();
        let invalidations = 0;
        const key = asIdempotencyKey("direct-1");
        expect(
            rig.store.getState().recordFinalSuccess(key, () => invalidations++),
        ).toBe(true);
        expect(
            rig.store.getState().recordFinalSuccess(key, () => invalidations++),
        ).toBe(false);
        expect(invalidations).toBe(1);
    });
});
