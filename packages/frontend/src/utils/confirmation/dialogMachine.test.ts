import { describe, expect, test } from "bun:test";
import {
    controlsFor,
    presentationFor,
    registryIdFor,
    statusText,
    transition,
} from "./dialogMachine";
import {
    asIdempotencyKey,
    asOperationToken,
    type ConfirmationRequired,
    type DialogState,
    type DialogSubject,
    type OperationToken,
} from "./protocol";
import { OBJECT_ID, REVISION, challenge, changed } from "./testRig";

const TOKEN = asOperationToken("token-1");
const STALE = asOperationToken("token-0");

const subject: DialogSubject = {
    token: TOKEN,
    operationKind: "storage.visibility.make_public",
    target: { type: "storage_object", id: OBJECT_ID },
    expectedRevision: REVISION,
    focus: { origin: null, rowKey: "row-1" },
};

function keys() {
    let n = 0;
    return () => asIdempotencyKey(`key-${++n}`);
}

const FALLBACK: DialogState = {
    tag: "rejected",
    mode: "safe-copy-fallback",
    subject,
    error: { kind: "protocol_error", scope: "copy", shape: "legacy" },
};

function ready(over: Partial<ConfirmationRequired> = {}): DialogState {
    return {
        tag: "confirmation-ready",
        subject,
        challenge: challenge(over),
    };
}

describe("dialogMachine examples", () => {
    test("OPEN submits one initiation and hides confirm while requesting", () => {
        const next = transition(
            { tag: "closed" },
            { type: "OPEN", subject },
            keys(),
        );
        expect(next.state).toEqual({ tag: "requesting", subject });
        expect(next.effects).toEqual([
            {
                type: "submitInitiation",
                token: TOKEN,
                key: asIdempotencyKey("key-1"),
            },
        ]);
        expect(controlsFor(next.state).confirm.visible).toBe(false);
    });

    test("a legacy or malformed result enters the fallback and keeps nothing from it", () => {
        for (const shape of ["legacy", "malformed"] as const) {
            const next = transition(
                { tag: "requesting", subject },
                {
                    type: "INITIATION_RESOLVED",
                    token: TOKEN,
                    result: { kind: "protocol_error", scope: "copy", shape },
                },
                keys(),
            );
            expect(next.state).toEqual({
                tag: "rejected",
                mode: "safe-copy-fallback",
                subject,
                error: { kind: "protocol_error", scope: "copy", shape },
            });
            expect(next.effects).toEqual([]);
        }
    });

    test("a payload-scoped protocol error is a domain-or-request rejection, not the fallback", () => {
        const next = transition(
            { tag: "requesting", subject },
            {
                type: "INITIATION_RESOLVED",
                token: TOKEN,
                result: { kind: "protocol_error", scope: "payload" },
            },
            keys(),
        );
        expect(next.state).toEqual({
            tag: "rejected",
            mode: "domain-or-request",
            subject,
            cause: "protocol_error",
        });
        expect(controlsFor(next.state).freshInitiation.visible).toBe(false);
    });

    test("only CLOSE and FRESH_INITIATION change the fallback state", () => {
        const events = [
            { type: "CONFIRM", token: TOKEN },
            { type: "REFRESH", token: TOKEN },
            { type: "CHALLENGE_EXPIRED", token: TOKEN, challengeId: "c" },
            { type: "INITIATION_FAILED", token: TOKEN },
            { type: "CONFIRM_FAILED", token: TOKEN },
            {
                type: "INITIATION_RESOLVED",
                token: TOKEN,
                result: challenge(),
            },
            {
                type: "CONFIRM_RESOLVED",
                token: TOKEN,
                result: changed(),
            },
        ] as const;
        for (const event of events) {
            const next = transition(
                FALLBACK,
                event as Parameters<typeof transition>[1],
                keys(),
            );
            expect(next.state).toBe(FALLBACK);
            expect(next.effects).toEqual([]);
        }
        expect(
            transition(FALLBACK, { type: "CLOSE", token: TOKEN }, keys()).state
                .tag,
        ).toBe("closed");
        expect(
            transition(
                FALLBACK,
                { type: "FRESH_INITIATION", token: TOKEN },
                keys(),
            ).state.tag,
        ).toBe("requesting");
    });

    test("FRESH_INITIATION uses a new key and is a no-op elsewhere or with a stale token", () => {
        const next = transition(
            FALLBACK,
            { type: "FRESH_INITIATION", token: TOKEN },
            keys(),
        );
        expect(next.state).toEqual({ tag: "requesting", subject });
        expect(next.effects).toEqual([
            {
                type: "submitInitiation",
                token: TOKEN,
                key: asIdempotencyKey("key-1"),
            },
        ]);

        expect(
            transition(
                FALLBACK,
                { type: "FRESH_INITIATION", token: STALE },
                keys(),
            ).state,
        ).toBe(FALLBACK);

        const others: DialogState[] = [
            { tag: "closed" },
            { tag: "requesting", subject },
            ready(),
            { ...ready(), tag: "confirming" } as DialogState,
            {
                tag: "expired",
                subject,
                registryId: challenge().registryId,
                copy: challenge().dialogCopy,
                refreshFailed: false,
            },
            {
                tag: "refreshing",
                subject,
                registryId: challenge().registryId,
                copy: challenge().dialogCopy,
            },
            {
                tag: "rejected",
                mode: "domain-or-request",
                subject,
                cause: "forbidden",
            },
        ];
        for (const state of others) {
            const result = transition(
                state,
                { type: "FRESH_INITIATION", token: TOKEN },
                keys(),
            );
            expect(result.state).toBe(state);
            expect(result.effects).toEqual([]);
        }
    });

    test("a challenge for another target or revision is rejected, never ready", () => {
        const mismatches = [
            challenge({
                target: {
                    type: "storage_object",
                    id: "11111111-1111-4111-8111-111111111111" as typeof OBJECT_ID,
                },
            }),
            challenge({ expectedRevision: (REVISION + 1) as typeof REVISION }),
        ];
        for (const result of mismatches) {
            const next = transition(
                { tag: "requesting", subject },
                { type: "INITIATION_RESOLVED", token: TOKEN, result },
                keys(),
            );
            expect(next.state.tag).toBe("rejected");
            expect(controlsFor(next.state).confirm.enabled).toBe(false);
        }
    });

    test("expired and refreshing retain the previous copy and disable confirm", () => {
        const first = challenge();
        const expired = transition(
            { tag: "confirmation-ready", subject, challenge: first },
            {
                type: "CHALLENGE_EXPIRED",
                token: TOKEN,
                challengeId: first.challengeId,
            },
            keys(),
        );
        expect(expired.state).toEqual({
            tag: "expired",
            subject,
            registryId: first.registryId,
            copy: first.dialogCopy,
            refreshFailed: false,
        });
        expect(presentationFor(expired.state)).toEqual(first.dialogCopy);
        expect(controlsFor(expired.state).confirm).toEqual({
            visible: true,
            enabled: false,
        });

        const refreshing = transition(
            expired.state,
            { type: "REFRESH", token: TOKEN },
            keys(),
        );
        expect(refreshing.state.tag).toBe("refreshing");
        expect(presentationFor(refreshing.state)).toEqual(first.dialogCopy);
        expect(controlsFor(refreshing.state).confirm.enabled).toBe(false);

        const second = challenge({
            dialogCopy: { title: "T", description: "D", confirmLabel: "L" },
        });
        const replaced = transition(
            refreshing.state,
            { type: "INITIATION_RESOLVED", token: TOKEN, result: second },
            keys(),
        );
        expect(replaced.state).toEqual({
            tag: "confirmation-ready",
            subject,
            challenge: second,
        });
        expect(presentationFor(replaced.state)).toEqual(second.dialogCopy);
    });

    test("a failed refresh keeps the previous copy", () => {
        const copy = challenge().dialogCopy;
        const registryId = challenge().registryId;
        const next = transition(
            { tag: "refreshing", subject, registryId, copy },
            { type: "INITIATION_FAILED", token: TOKEN },
            keys(),
        );
        expect(next.state).toEqual({
            tag: "expired",
            subject,
            registryId,
            copy,
            refreshFailed: true,
        });
    });

    test("confirming cannot be closed and the stale token cannot move it", () => {
        const confirming = {
            ...ready(),
            tag: "confirming",
        } as DialogState;
        expect(
            transition(confirming, { type: "CLOSE", token: TOKEN }, keys())
                .state,
        ).toBe(confirming);
        expect(
            transition(
                confirming,
                { type: "CONFIRM_FAILED", token: STALE },
                keys(),
            ).state,
        ).toBe(confirming);
        expect(controlsFor(confirming).dismissable).toBe(false);
    });

    test("presentation: operation text only from validated copy; generic otherwise", () => {
        const copy = challenge().dialogCopy;
        expect(presentationFor(ready())).toEqual(copy);
        const generic: DialogState[] = [
            { tag: "closed" },
            { tag: "requesting", subject },
            FALLBACK,
            {
                tag: "rejected",
                mode: "domain-or-request",
                subject,
                cause: "request_failed",
            },
        ];
        for (const state of generic) {
            const view = presentationFor(state);
            expect(view.description).toBeNull();
            expect(view.confirmLabel).toBeNull();
            for (const text of [view.title, statusText(state) ?? ""]) {
                expect(text).not.toMatch(/public|private|file|report/i);
            }
        }
    });

    test("the fallback offers one Close and one fresh initiation, nothing else", () => {
        const controls = controlsFor(FALLBACK);
        expect(controls.cancel).toEqual({
            visible: true,
            enabled: true,
            label: "Close",
        });
        expect(controls.freshInitiation).toEqual({
            visible: true,
            enabled: true,
        });
        expect(controls.confirm.visible).toBe(false);
        expect(controls.refresh.visible).toBe(false);
        expect(controls.dismissable).toBe(true);
    });
});

describe("registryIdFor", () => {
    test("returns the identifier of the validated result being shown, and null otherwise", () => {
        const current = challenge();
        const ready: DialogState = {
            tag: "confirmation-ready",
            subject,
            challenge: current,
        };
        expect(registryIdFor(ready)).toBe(current.registryId);
        expect(registryIdFor({ ...ready, tag: "confirming" } as DialogState)).toBe(
            current.registryId,
        );
        for (const tag of ["expired", "refreshing"] as const) {
            const state = {
                tag,
                subject,
                registryId: current.registryId,
                copy: current.dialogCopy,
                refreshFailed: false,
            } as DialogState;
            expect(registryIdFor(state)).toBe(current.registryId);
        }
        expect(registryIdFor({ tag: "closed" })).toBeNull();
        expect(registryIdFor({ tag: "requesting", subject })).toBeNull();
        expect(
            registryIdFor({
                tag: "rejected",
                mode: "domain-or-request",
                subject,
                cause: "forbidden",
            }),
        ).toBeNull();
    });
});
