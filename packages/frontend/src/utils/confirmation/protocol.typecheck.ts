/**
 * Compile-time checks, not run. `bunx tsc --noEmit -p packages/frontend/tsconfig.json`
 * fails if a @ts-expect-error below stops being an error, which means an invalid
 * state became representable again.
 */
import { controlsFor } from "./dialogMachine";
import type {
    AuthoritativeDialogCopy,
    ChallengeId,
    ConfigRevision,
    ConfirmableOperationAdapter,
    ConfirmableResult,
    ConfirmationRequired,
    CopyProtocolError,
    DialogEffect,
    DialogEvent,
    DialogState,
    DialogSubject,
    IdempotencyKey,
    OperationToken,
    ProtocolError,
    RegistryIdentifier,
    RejectedState,
    StorageObjectId,
} from "./protocol";
import { assertUnreachable } from "./protocol";

declare const subject: DialogSubject;
declare const challenge: ConfirmationRequired;

// Each state carries exactly its own data.
const requesting: DialogState = { tag: "requesting", subject };
const ready: DialogState = { tag: "confirmation-ready", subject, challenge };
void requesting;
void ready;

// @ts-expect-error a requesting dialog has no challenge yet
const bad1: DialogState = { tag: "requesting", subject, challenge };
// @ts-expect-error confirmation-ready needs its challenge
const bad2: DialogState = { tag: "confirmation-ready", subject };
// @ts-expect-error expired must carry its validated copy and say whether a refresh failed
const bad3: DialogState = { tag: "expired", subject };
// @ts-expect-error an unknown state tag is not a DialogState
const bad4: DialogState = { tag: "paused", subject };
void bad1;
void bad2;
void bad3;
void bad4;

// Narrowing exposes the challenge only where it exists.
export function challengeIdOf(state: DialogState): ChallengeId | null {
    switch (state.tag) {
        case "confirmation-ready":
        case "confirming":
            return state.challenge.challengeId;
        case "closed":
        case "requesting":
        case "expired":
        case "refreshing":
        case "rejected":
            // @ts-expect-error these states have no challenge
            return state.challenge.challengeId;
        default:
            return assertUnreachable(state);
    }
}

// A result with an unknown kind is not a ConfirmableResult.
// @ts-expect-error "deleted" is not a known result kind
const bad5: ConfirmableResult = { kind: "deleted" };
// @ts-expect-error rejected requires a reason from the contract
const bad6: ConfirmableResult = { kind: "rejected", reason: "teapot" };
void bad5;
void bad6;

// Switching over ConfirmableResult must be exhaustive.
export function describeResult(result: ConfirmableResult): string {
    switch (result.kind) {
        case "confirmation_required":
            return "ask";
        case "visibility_changed":
            return "done";
        case "rejected":
            return result.reason;
        default:
            return assertUnreachable(result);
    }
}

// Brands keep look-alike strings and numbers apart.
declare const key: IdempotencyKey;
declare const token: OperationToken;
declare const objectId: StorageObjectId;
declare const revision: ConfigRevision;
// @ts-expect-error an idempotency key is not an operation token
const bad7: OperationToken = key;
// @ts-expect-error a storage object id is not a challenge id
const bad8: ChallengeId = objectId;
// @ts-expect-error a plain number is not a ConfigRevision
const bad9: ConfigRevision = 3;
void bad7;
void bad8;
void bad9;
void token;
void revision;

// controlsFor accepts every state and nothing else.
export const closedControls = controlsFor({ tag: "closed" });
// @ts-expect-error not a DialogState
controlsFor({ tag: "closing" });

// ---------------------------------------------------------------------------
// Authoritative dialog copy (spec: confirmation-dialog-copy)
// ---------------------------------------------------------------------------

declare const copy: AuthoritativeDialogCopy;
declare const registryId: RegistryIdentifier;
declare const copyError: CopyProtocolError;
declare const initiate: ConfirmableOperationAdapter<"storage.visibility.make_public">["initiate"];
declare const confirm: ConfirmableOperationAdapter<"storage.visibility.make_public">["confirm"];
declare const onFinalSuccess: ConfirmableOperationAdapter<"storage.visibility.make_public">["onFinalSuccess"];

// The adapter is exactly kind, initiate, confirm and onFinalSuccess: it owns no dialog text.
export const adapter: ConfirmableOperationAdapter<"storage.visibility.make_public"> =
    {
        kind: "storage.visibility.make_public",
        initiate,
        confirm,
        onFinalSuccess,
    };
export const adapterWithCopy: ConfirmableOperationAdapter<"storage.visibility.make_public"> =
    {
        kind: "storage.visibility.make_public",
        initiate,
        confirm,
        onFinalSuccess,
        // @ts-expect-error the adapter no longer owns dialog text
        copy: () => copy,
    };

// The subject carries no label: the browser never supplies text for the dialog.
export const subjectWithLabel: DialogSubject = {
    token: subject.token,
    operationKind: subject.operationKind,
    target: subject.target,
    expectedRevision: subject.expectedRevision,
    focus: subject.focus,
    // @ts-expect-error DialogSubject has no label
    label: "report.pdf",
};

// A registry identifier is a branded decimal string, not any string or a number.
declare const plainText: string;
// @ts-expect-error unvalidated text is not a RegistryIdentifier
const bad10: RegistryIdentifier = plainText;
// @ts-expect-error a number cannot carry a BIGINT exactly and is not a RegistryIdentifier
const bad11: RegistryIdentifier = 1000;
void bad10;
void bad11;

// A current result needs its identity and copy.
// @ts-expect-error a current result without registryId and dialogCopy is the legacy shape
const bad12: ConfirmationRequired = { ...challenge, registryId: undefined };
void bad12;

// ProtocolError is tagged: a payload error has no shape, a copy error needs one.
// @ts-expect-error scope is required
const bad13: ProtocolError = { kind: "protocol_error" };
// @ts-expect-error a copy error needs its shape
const bad14: ProtocolError = { kind: "protocol_error", scope: "copy" };
const bad15: ProtocolError = {
    kind: "protocol_error",
    scope: "payload",
    // @ts-expect-error a payload error has no shape
    shape: "legacy",
};
const bad16: CopyProtocolError = {
    kind: "protocol_error",
    scope: "copy",
    // @ts-expect-error shape is legacy or malformed
    shape: "odd",
};
void bad13;
void bad14;
void bad15;
void bad16;

// The safe fallback keeps only its classification: no challenge, proof, or copy.
export const fallback: DialogState = {
    tag: "rejected",
    mode: "safe-copy-fallback",
    subject,
    error: copyError,
};
export const fallbackWithChallenge: DialogState = {
    tag: "rejected",
    mode: "safe-copy-fallback",
    subject,
    error: copyError,
    // @ts-expect-error the fallback state has no challenge
    challenge,
};
export const fallbackWithCopy: DialogState = {
    tag: "rejected",
    mode: "safe-copy-fallback",
    subject,
    error: copyError,
    // @ts-expect-error the fallback state has no copy
    copy,
};
// @ts-expect-error a fallback needs a copy-scoped protocol error
const bad17: DialogState = {
    tag: "rejected",
    mode: "safe-copy-fallback",
    subject,
};
const bad18: DialogState = {
    tag: "rejected",
    mode: "safe-copy-fallback",
    subject,
    // @ts-expect-error a payload error cannot put the dialog in the fallback
    error: { kind: "protocol_error", scope: "payload" },
};
// @ts-expect-error a domain rejection needs its cause
const bad19: DialogState = {
    tag: "rejected",
    mode: "domain-or-request",
    subject,
};
const bad20: DialogState = {
    tag: "rejected",
    mode: "domain-or-request",
    subject,
    cause: "forbidden",
    // @ts-expect-error a domain rejection has no protocol error
    error: copyError,
};
// @ts-expect-error a rejected state needs a mode
const bad21: DialogState = { tag: "rejected", subject, cause: "forbidden" };
void bad17;
void bad18;
void bad19;
void bad20;
void bad21;

// expired and refreshing carry the last validated copy.
export const expiredState: DialogState = {
    tag: "expired",
    subject,
    registryId,
    copy,
    refreshFailed: false,
};
export const refreshingState: DialogState = {
    tag: "refreshing",
    subject,
    registryId,
    copy,
};
// @ts-expect-error refreshing must carry the validated copy
const bad22: DialogState = { tag: "refreshing", subject };
const bad23: DialogState = {
    tag: "expired",
    subject,
    registryId,
    copy,
    refreshFailed: false,
    // @ts-expect-error expired does not keep the challenge or its proof
    challenge,
};
void bad22;
void bad23;

// Exhaustive switches: adding a variant to any of these unions breaks the build here.
export function rejectedModeOf(state: RejectedState): string {
    switch (state.mode) {
        case "domain-or-request":
            return state.cause;
        case "safe-copy-fallback":
            return state.error.shape;
        default:
            return assertUnreachable(state);
    }
}

export function protocolErrorText(error: ProtocolError): string {
    switch (error.scope) {
        case "payload":
            return "payload";
        case "copy":
            return error.shape;
        default:
            return assertUnreachable(error);
    }
}

export function stateName(state: DialogState): string {
    switch (state.tag) {
        case "closed":
        case "requesting":
        case "confirmation-ready":
        case "confirming":
        case "expired":
        case "refreshing":
            return state.tag;
        case "rejected":
            return rejectedModeOf(state);
        default:
            return assertUnreachable(state);
    }
}

// No confirm effect can be produced from a rejected state: the effect needs a
// ConfirmationRequired, and only confirmation-ready (and confirming) carry one.
type ConfirmEffect = Extract<DialogEffect, { type: "submitConfirmation" }>;
export function confirmEffectOf(
    state: DialogState,
    token: OperationToken,
    key: IdempotencyKey,
): ConfirmEffect | null {
    switch (state.tag) {
        case "confirmation-ready":
            return {
                type: "submitConfirmation",
                token,
                key,
                challenge: state.challenge,
            };
        case "rejected":
            return {
                type: "submitConfirmation",
                token,
                key,
                // @ts-expect-error a rejected state has no challenge to confirm
                challenge: state.challenge,
            };
        case "closed":
        case "requesting":
        case "confirming":
        case "expired":
        case "refreshing":
            return null;
        default:
            return assertUnreachable(state);
    }
}

// FRESH_INITIATION is a real event and carries only the dialog token.
export const freshInitiation: DialogEvent = { type: "FRESH_INITIATION", token };
export const freshWithResult: DialogEvent = {
    type: "FRESH_INITIATION",
    token,
    // @ts-expect-error a fresh initiation carries no result or challenge
    result: copyError,
};

// controlsFor exposes the fresh-initiation control, and only that control name.
export const freshControl: boolean =
    controlsFor(fallback).freshInitiation.enabled;
