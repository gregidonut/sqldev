/**
 * Compile-time checks, not run. `bunx tsc --noEmit -p packages/frontend/tsconfig.json`
 * fails if a @ts-expect-error below stops being an error, which means an invalid
 * state became representable again.
 */
import { controlsFor } from "./dialogMachine";
import type {
    ChallengeId,
    ConfigRevision,
    ConfirmableResult,
    ConfirmationRequired,
    DialogState,
    DialogSubject,
    IdempotencyKey,
    OperationToken,
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
// @ts-expect-error expired must say whether a refresh failed
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
