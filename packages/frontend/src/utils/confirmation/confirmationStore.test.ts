import { describe, expect, test } from "bun:test";
import { controlsFor } from "./dialogMachine";
import {
    OBJECT_ID,
    challenge,
    changed,
    createRig,
    flush,
    openRequest,
} from "./testRig";

describe("confirmation store", () => {
    test("opening starts exactly one initiation and waits in memory", async () => {
        const rig = createRig();
        expect(rig.store.getState().open(openRequest())).toBe(true);
        expect(rig.store.getState().state.tag).toBe("requesting");
        expect(rig.adapter.initiations).toHaveLength(1);
        expect(rig.adapter.confirmations).toHaveLength(0);
    });

    test("only one dialog can be open", () => {
        const rig = createRig();
        expect(rig.store.getState().open(openRequest())).toBe(true);
        expect(
            rig.store
                .getState()
                .open(
                    openRequest({ focus: { origin: null, rowKey: "row-2" } }),
                ),
        ).toBe(false);
        expect(rig.adapter.initiations).toHaveLength(1);
    });

    test("a matching challenge enables confirm and arms silent expiry", async () => {
        const rig = createRig();
        rig.store.getState().open(openRequest());
        rig.adapter.initiations[0]!.result.resolve(challenge());
        await flush();
        expect(rig.store.getState().state.tag).toBe("confirmation-ready");
        expect(rig.clock.pending()).toBe(1);
    });

    test("confirm submits a separate job with a different key", async () => {
        const rig = createRig();
        rig.store.getState().open(openRequest());
        rig.adapter.initiations[0]!.result.resolve(challenge());
        await flush();
        rig.store.getState().confirm();
        expect(rig.store.getState().state.tag).toBe("confirming");
        expect(rig.adapter.confirmations).toHaveLength(1);
        expect(rig.adapter.confirmations[0]!.key).not.toBe(
            rig.adapter.initiations[0]!.key,
        );
        expect(rig.clock.pending()).toBe(0);
    });

    test("pressing confirm twice submits one confirmation", async () => {
        const rig = createRig();
        rig.store.getState().open(openRequest());
        rig.adapter.initiations[0]!.result.resolve(challenge());
        await flush();
        rig.store.getState().confirm();
        rig.store.getState().confirm();
        rig.store.getState().confirm();
        expect(rig.adapter.confirmations).toHaveLength(1);
    });

    test("the dialog expires silently at the challenge expiry and stays open", async () => {
        const rig = createRig();
        rig.store.getState().open(openRequest());
        rig.adapter.initiations[0]!.result.resolve(
            challenge({ expiresInMs: 60_000 }),
        );
        await flush();
        rig.clock.advance(59_999);
        expect(rig.store.getState().state.tag).toBe("confirmation-ready");
        rig.clock.advance(1);
        expect(rig.store.getState().state.tag).toBe("expired");
        expect(rig.adapter.confirmations).toHaveLength(0);
    });

    test("confirm never submits a challenge the clock says has expired", async () => {
        const rig = createRig();
        rig.store.getState().open(openRequest());
        rig.adapter.initiations[0]!.result.resolve(
            challenge({ expiresInMs: 1_000 }),
        );
        await flush();
        // The timer has not fired (a throttled tab), but time is past the expiry.
        rig.clock.set(rig.clock.now() + 5_000);
        rig.store.getState().confirm();
        expect(rig.adapter.confirmations).toHaveLength(0);
        expect(rig.store.getState().state.tag).toBe("expired");
    });

    test("returning to a hidden tab re-checks expiry", async () => {
        const rig = createRig();
        rig.store.getState().open(openRequest());
        rig.adapter.initiations[0]!.result.resolve(
            challenge({ expiresInMs: 1_000 }),
        );
        await flush();
        expect(rig.visibleListeners.size).toBe(1);
        // Move time without firing the timer, as a background tab would.
        rig.clock.set(rig.clock.now() + 5_000);
        for (const listener of [...rig.visibleListeners]) listener();
        expect(rig.store.getState().state.tag).toBe("expired");
    });

    test("refresh replaces the challenge only once the new one arrives", async () => {
        const rig = createRig();
        rig.store.getState().open(openRequest());
        const first = challenge({ expiresInMs: 1_000 });
        rig.adapter.initiations[0]!.result.resolve(first);
        await flush();
        rig.clock.advance(1_000);
        expect(rig.store.getState().state.tag).toBe("expired");

        rig.store.getState().refresh();
        expect(rig.store.getState().state.tag).toBe("refreshing");
        expect(rig.adapter.initiations).toHaveLength(2);
        expect(rig.adapter.initiations[1]!.key).not.toBe(
            rig.adapter.initiations[0]!.key,
        );

        const second = challenge();
        rig.adapter.initiations[1]!.result.resolve(second);
        await flush();
        const state = rig.store.getState().state;
        expect(state.tag).toBe("confirmation-ready");
        if (state.tag === "confirmation-ready") {
            expect(state.challenge.challengeId).toBe(second.challengeId);
        }
    });

    test("a failed refresh keeps the dialog expired and lets the person retry", async () => {
        const rig = createRig();
        rig.store.getState().open(openRequest());
        rig.adapter.initiations[0]!.result.resolve(
            challenge({ expiresInMs: 1_000 }),
        );
        await flush();
        rig.clock.advance(1_000);
        rig.store.getState().refresh();
        rig.adapter.initiations[1]!.result.reject(new Error("network"));
        await flush();
        const state = rig.store.getState().state;
        expect(state.tag).toBe("expired");
        if (state.tag === "expired") expect(state.refreshFailed).toBe(true);
    });

    test("the server saying expired_challenge expires the dialog in place", async () => {
        const rig = createRig();
        rig.store.getState().open(openRequest());
        rig.adapter.initiations[0]!.result.resolve(challenge());
        await flush();
        rig.store.getState().confirm();
        rig.adapter.confirmations[0]!.result.resolve({
            kind: "rejected",
            reason: "expired_challenge",
        });
        await flush();
        expect(rig.store.getState().state.tag).toBe("expired");
    });

    test("cancelling aborts the pending initiation and ignores its late result", async () => {
        const rig = createRig();
        rig.store.getState().open(openRequest());
        const call = rig.adapter.initiations[0]!;
        rig.store.getState().close();
        expect(call.signal?.aborted).toBe(true);
        expect(rig.store.getState().state.tag).toBe("closed");
        call.result.resolve(challenge());
        await flush();
        expect(rig.store.getState().state.tag).toBe("closed");
        expect(rig.adapter.confirmations).toHaveLength(0);
    });

    test("a late result from a closed dialog cannot reopen a newer one", async () => {
        const rig = createRig();
        rig.store.getState().open(openRequest());
        const stale = rig.adapter.initiations[0]!;
        rig.store.getState().close();
        rig.store
            .getState()
            .open(openRequest({ focus: { origin: null, rowKey: "row-2" } }));
        stale.result.resolve(challenge());
        await flush();
        expect(rig.store.getState().state.tag).toBe("requesting");
    });

    test("closing restores focus; confirming cannot be dismissed", async () => {
        const rig = createRig();
        rig.store.getState().open(openRequest());
        rig.adapter.initiations[0]!.result.resolve(challenge());
        await flush();
        rig.store.getState().confirm();
        rig.store.getState().close();
        expect(rig.store.getState().state.tag).toBe("confirming");
        expect(rig.focusRestored).toHaveLength(0);

        rig.adapter.confirmations[0]!.result.resolve(changed());
        await flush();
        expect(rig.store.getState().state.tag).toBe("closed");
        expect(rig.focusRestored).toHaveLength(1);
    });

    test("a mismatched challenge is rejected, never enabled", async () => {
        const rig = createRig();
        rig.store.getState().open(openRequest());
        rig.adapter.initiations[0]!.result.resolve(
            challenge({
                target: {
                    type: "storage_object",
                    id: "11111111-1111-4111-8111-111111111111" as typeof OBJECT_ID,
                },
            }),
        );
        await flush();
        expect(rig.store.getState().state.tag).toBe("rejected");
    });

    test("a protocol error never enables confirm", async () => {
        const rig = createRig();
        rig.store.getState().open(openRequest());
        rig.adapter.initiations[0]!.result.resolve({
            kind: "protocol_error",
            scope: "payload",
        });
        await flush();
        expect(rig.store.getState().state.tag).toBe("rejected");
        rig.store.getState().confirm();
        expect(rig.adapter.confirmations).toHaveLength(0);
    });

    test("a legacy result enters the safe fallback and only a fresh initiation leaves it", async () => {
        const rig = createRig();
        rig.store.getState().open(openRequest());
        rig.adapter.initiations[0]!.result.resolve({
            kind: "protocol_error",
            scope: "copy",
            shape: "legacy",
        });
        await flush();
        const fallback = rig.store.getState().state;
        expect(fallback.tag).toBe("rejected");
        if (fallback.tag === "rejected") {
            expect(fallback.mode).toBe("safe-copy-fallback");
        }
        rig.store.getState().confirm();
        rig.store.getState().refresh();
        expect(rig.adapter.confirmations).toHaveLength(0);
        expect(rig.adapter.initiations).toHaveLength(1);

        rig.store.getState().freshInitiation();
        await flush();
        expect(rig.store.getState().state.tag).toBe("requesting");
        expect(rig.adapter.initiations).toHaveLength(2);
        expect(rig.adapter.initiations[1]!.key).not.toBe(
            rig.adapter.initiations[0]!.key,
        );

        rig.adapter.initiations[1]!.result.resolve(challenge());
        await flush();
        expect(rig.store.getState().state.tag).toBe("confirmation-ready");
    });

    test("a fresh initiation is ignored outside the safe fallback", async () => {
        const rig = createRig();
        rig.store.getState().freshInitiation();
        rig.store.getState().open(openRequest());
        rig.store.getState().freshInitiation();
        expect(rig.adapter.initiations).toHaveLength(1);
        rig.adapter.initiations[0]!.result.resolve({
            kind: "protocol_error",
            scope: "payload",
        });
        await flush();
        rig.store.getState().freshInitiation();
        expect(rig.store.getState().state.tag).toBe("rejected");
        expect(rig.adapter.initiations).toHaveLength(1);
    });

    test("expired and refreshing keep the validated copy; a refresh replaces it atomically", async () => {
        const rig = createRig();
        rig.store.getState().open(openRequest());
        const first = challenge({ expiresInMs: 60_000 });
        rig.adapter.initiations[0]!.result.resolve(first);
        await flush();
        rig.clock.advance(60_000);
        const expired = rig.store.getState().state;
        expect(expired.tag).toBe("expired");
        if (expired.tag === "expired") {
            expect(expired.copy).toEqual(first.dialogCopy);
            expect("challenge" in expired).toBe(false);
        }
        rig.store.getState().refresh();
        const refreshing = rig.store.getState().state;
        expect(refreshing.tag).toBe("refreshing");
        if (refreshing.tag === "refreshing") {
            expect(refreshing.copy).toEqual(first.dialogCopy);
        }
        const next = challenge({
            dialogCopy: {
                title: "<b>New</b> title",
                description: "New description",
                confirmLabel: "Go",
            },
        });
        rig.adapter.initiations[1]!.result.resolve(next);
        await flush();
        const ready = rig.store.getState().state;
        expect(ready.tag).toBe("confirmation-ready");
        if (ready.tag === "confirmation-ready") {
            expect(ready.challenge).toBe(next);
        }
    });

    test("each freshInitiation() call submits exactly one initiation with a never-used key", async () => {
        const rig = createRig();
        rig.store.getState().open(openRequest());
        const bad = {
            kind: "protocol_error",
            scope: "copy",
            shape: "malformed",
        } as const;
        rig.adapter.initiations[0]!.result.resolve(bad);
        await flush();

        for (let round = 1; round <= 4; round += 1) {
            rig.store.getState().freshInitiation();
            // A second press while the new request is in flight changes nothing.
            rig.store.getState().freshInitiation();
            expect(rig.adapter.initiations).toHaveLength(round + 1);
            rig.adapter.initiations[round]!.result.resolve(bad);
            await flush();
            expect(rig.store.getState().state.tag).toBe("rejected");
        }
        const keys = rig.adapter.initiations.map((call) => call.key);
        expect(new Set(keys).size).toBe(keys.length);
        expect(rig.adapter.confirmations).toHaveLength(0);
        expect(rig.adapter.finalSuccesses).toHaveLength(0);
    });

    test("closing during a fresh initiation aborts it and ignores its late result", async () => {
        const rig = createRig();
        rig.store.getState().open(openRequest());
        rig.adapter.initiations[0]!.result.resolve({
            kind: "protocol_error",
            scope: "copy",
            shape: "legacy",
        });
        await flush();
        rig.store.getState().freshInitiation();
        const call = rig.adapter.initiations[1]!;
        rig.store.getState().close();
        expect(call.signal?.aborted).toBe(true);
        call.result.resolve(challenge());
        await flush();
        expect(rig.store.getState().state.tag).toBe("closed");
        expect(rig.adapter.confirmations).toHaveLength(0);
    });

    test("a result carrying a stale token changes nothing, even from the fallback", async () => {
        const rig = createRig();
        rig.store.getState().open(openRequest());
        const first = rig.adapter.initiations[0]!;
        first.result.resolve({
            kind: "protocol_error",
            scope: "copy",
            shape: "legacy",
        });
        await flush();
        rig.store.getState().close();
        rig.store.getState().open(openRequest());
        const before = rig.store.getState().state;
        // The first dialog's late answer must not reach the second dialog.
        first.result.resolve(challenge());
        await flush();
        expect(rig.store.getState().state).toBe(before);
    });

    test("no cache invalidation happens before a final success, and exactly one after it", async () => {
        const rig = createRig();
        rig.store.getState().open(openRequest());
        rig.adapter.initiations[0]!.result.resolve({
            kind: "protocol_error",
            scope: "copy",
            shape: "malformed",
        });
        await flush();
        expect(rig.adapter.finalSuccesses).toHaveLength(0);
        rig.store.getState().freshInitiation();
        rig.adapter.initiations[1]!.result.resolve(challenge());
        await flush();
        expect(rig.adapter.finalSuccesses).toHaveLength(0);
        rig.store.getState().confirm();
        expect(rig.adapter.finalSuccesses).toHaveLength(0);
        rig.adapter.confirmations[0]!.result.resolve(changed());
        await flush();
        expect(rig.adapter.finalSuccesses).toHaveLength(1);
        expect(rig.store.getState().state.tag).toBe("closed");
    });

    test("requesting hides the confirm control until a result supplies a label", async () => {
        const rig = createRig();
        rig.store.getState().open(openRequest());
        const requesting = rig.store.getState().state;
        expect(requesting.tag).toBe("requesting");
        expect(controlsFor(requesting).confirm.visible).toBe(false);
        rig.adapter.initiations[0]!.result.resolve(challenge());
        await flush();
        expect(controlsFor(rig.store.getState().state).confirm).toEqual({
            visible: true,
            enabled: true,
        });
    });
});
