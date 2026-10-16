import {
    assertUnreachable,
    type ConfirmableResult,
    type ConfirmationRequired,
    type DialogEffect,
    type DialogEvent,
    type DialogRejectionCause,
    type DialogState,
    type DialogSubject,
    type IdempotencyKey,
    type OperationToken,
    type ProtocolError,
} from "./protocol";

export type Transition = {
    readonly state: DialogState;
    readonly effects: readonly DialogEffect[];
};

const CLOSED: DialogState = { tag: "closed" };

function stay(state: DialogState): Transition {
    return { state, effects: [] };
}

function restoreFocus(subject: DialogSubject): DialogEffect {
    return { type: "restoreFocus", focus: subject.focus };
}

/** The token a result must carry to be applied, or null when no dialog is open. */
export function currentToken(state: DialogState): OperationToken | null {
    return state.tag === "closed" ? null : state.subject.token;
}

function matchesSubject(
    challenge: ConfirmationRequired,
    subject: DialogSubject,
): boolean {
    return (
        challenge.operationKind === subject.operationKind &&
        challenge.target.type === subject.target.type &&
        challenge.target.id === subject.target.id &&
        challenge.expectedRevision === subject.expectedRevision
    );
}

function rejected(
    subject: DialogSubject,
    cause: DialogRejectionCause,
): Transition {
    return { state: { tag: "rejected", subject, cause }, effects: [] };
}

/** Applies an initiation (or refresh) result. Only a matching challenge enables confirm. */
function applyInitiation(
    subject: DialogSubject,
    result: ConfirmableResult | ProtocolError,
): Transition {
    switch (result.kind) {
        case "confirmation_required":
            if (!matchesSubject(result, subject)) {
                return rejected(subject, "protocol_error");
            }
            return {
                state: {
                    tag: "confirmation-ready",
                    subject,
                    challenge: result,
                },
                effects: [
                    {
                        type: "armExpiry",
                        token: subject.token,
                        challengeId: result.challengeId,
                        at: result.expiresAt,
                    },
                ],
            };
        case "rejected":
            return rejected(subject, result.reason);
        case "visibility_changed":
        case "protocol_error":
            // An initiation can never legitimately change visibility.
            return rejected(subject, "protocol_error");
        default:
            return assertUnreachable(result);
    }
}

function applyConfirmation(
    subject: DialogSubject,
    result: ConfirmableResult | ProtocolError,
): Transition {
    switch (result.kind) {
        case "visibility_changed":
            if (result.target.id !== subject.target.id) {
                return rejected(subject, "protocol_error");
            }
            return { state: CLOSED, effects: [restoreFocus(subject)] };
        case "rejected":
            if (result.reason === "expired_challenge") {
                return {
                    state: { tag: "expired", subject, refreshFailed: false },
                    effects: [],
                };
            }
            return rejected(subject, result.reason);
        case "confirmation_required":
        case "protocol_error":
            return rejected(subject, "protocol_error");
        default:
            return assertUnreachable(result);
    }
}

/**
 * The reference model for the confirmation dialog. It is pure: ids come from
 * `newKey`, time arrives as events, and every side effect is returned as data.
 *
 * Any event except OPEN is ignored unless it carries the current operation's
 * token, so a late result from a closed or replaced dialog changes nothing
 * (Req 10.11, 11.7).
 */
export function transition(
    state: DialogState,
    event: DialogEvent,
    newKey: () => IdempotencyKey,
): Transition {
    if (event.type === "OPEN") {
        // One dialog at a time (Req 10.1): a second request while one is open is dropped.
        if (state.tag !== "closed") {
            return stay(state);
        }
        return {
            state: { tag: "requesting", subject: event.subject },
            effects: [
                {
                    type: "submitInitiation",
                    token: event.subject.token,
                    key: newKey(),
                },
            ],
        };
    }
    if (state.tag === "closed" || event.token !== state.subject.token) {
        return stay(state);
    }

    switch (state.tag) {
        case "requesting":
            switch (event.type) {
                case "INITIATION_RESOLVED":
                    return applyInitiation(state.subject, event.result);
                case "INITIATION_FAILED":
                    return rejected(state.subject, "request_failed");
                case "CLOSE":
                    return {
                        state: CLOSED,
                        effects: [
                            {
                                type: "abortInitiation",
                                token: state.subject.token,
                            },
                            restoreFocus(state.subject),
                        ],
                    };
                default:
                    return stay(state);
            }
        case "confirmation-ready":
            switch (event.type) {
                case "CONFIRM":
                    return {
                        state: {
                            tag: "confirming",
                            subject: state.subject,
                            challenge: state.challenge,
                        },
                        effects: [
                            { type: "cancelExpiry" },
                            {
                                type: "submitConfirmation",
                                token: state.subject.token,
                                key: newKey(),
                                challenge: state.challenge,
                            },
                        ],
                    };
                case "CHALLENGE_EXPIRED":
                    if (event.challengeId !== state.challenge.challengeId) {
                        return stay(state);
                    }
                    return {
                        state: {
                            tag: "expired",
                            subject: state.subject,
                            refreshFailed: false,
                        },
                        effects: [],
                    };
                case "CLOSE":
                    return {
                        state: CLOSED,
                        effects: [
                            { type: "cancelExpiry" },
                            restoreFocus(state.subject),
                        ],
                    };
                default:
                    return stay(state);
            }
        case "confirming":
            switch (event.type) {
                case "CONFIRM_RESOLVED":
                    return applyConfirmation(state.subject, event.result);
                case "CONFIRM_FAILED":
                    return rejected(state.subject, "request_failed");
                default:
                    // CLOSE is ignored: the confirmation job is already submitted.
                    return stay(state);
            }
        case "expired":
            switch (event.type) {
                case "REFRESH":
                    return {
                        state: { tag: "refreshing", subject: state.subject },
                        effects: [
                            {
                                type: "submitInitiation",
                                token: state.subject.token,
                                key: newKey(),
                            },
                        ],
                    };
                case "CLOSE":
                    return {
                        state: CLOSED,
                        effects: [restoreFocus(state.subject)],
                    };
                default:
                    return stay(state);
            }
        case "refreshing":
            switch (event.type) {
                case "INITIATION_RESOLVED":
                    return applyInitiation(state.subject, event.result);
                case "INITIATION_FAILED":
                    return {
                        state: {
                            tag: "expired",
                            subject: state.subject,
                            refreshFailed: true,
                        },
                        effects: [],
                    };
                case "CLOSE":
                    return {
                        state: CLOSED,
                        effects: [
                            {
                                type: "abortInitiation",
                                token: state.subject.token,
                            },
                            restoreFocus(state.subject),
                        ],
                    };
                default:
                    return stay(state);
            }
        case "rejected":
            if (event.type === "CLOSE") {
                return {
                    state: CLOSED,
                    effects: [restoreFocus(state.subject)],
                };
            }
            return stay(state);
        default:
            return assertUnreachable(state);
    }
}

export type Control = { readonly visible: boolean; readonly enabled: boolean };

export type Controls = {
    readonly confirm: Control;
    readonly refresh: Control;
    readonly cancel: Control & { readonly label: "Cancel" | "Close" };
    /** True while a request is in flight (requesting, refreshing, confirming). */
    readonly busy: boolean;
    /** Whether Escape and an outside press may close the dialog. */
    readonly dismissable: boolean;
};

const HIDDEN: Control = { visible: false, enabled: false };
const DISABLED: Control = { visible: true, enabled: false };
const ENABLED: Control = { visible: true, enabled: true };

/**
 * What the dialog may offer in each state. The host renders from this alone, and
 * the property test compares the rendered DOM against it.
 */
export function controlsFor(state: DialogState): Controls {
    switch (state.tag) {
        case "closed":
            return {
                confirm: HIDDEN,
                refresh: HIDDEN,
                cancel: { ...HIDDEN, label: "Cancel" },
                busy: false,
                dismissable: false,
            };
        case "requesting":
            return {
                confirm: DISABLED,
                refresh: HIDDEN,
                cancel: { ...ENABLED, label: "Cancel" },
                busy: true,
                dismissable: true,
            };
        case "confirmation-ready":
            return {
                confirm: ENABLED,
                refresh: HIDDEN,
                cancel: { ...ENABLED, label: "Cancel" },
                busy: false,
                dismissable: true,
            };
        case "confirming":
            return {
                confirm: DISABLED,
                refresh: HIDDEN,
                cancel: { ...DISABLED, label: "Cancel" },
                busy: true,
                dismissable: false,
            };
        case "expired":
            return {
                confirm: DISABLED,
                refresh: ENABLED,
                cancel: { ...ENABLED, label: "Cancel" },
                busy: false,
                dismissable: true,
            };
        case "refreshing":
            return {
                confirm: DISABLED,
                refresh: DISABLED,
                cancel: { ...ENABLED, label: "Cancel" },
                busy: true,
                dismissable: true,
            };
        case "rejected":
            return {
                confirm: HIDDEN,
                refresh: HIDDEN,
                cancel: { ...ENABLED, label: "Close" },
                busy: false,
                dismissable: true,
            };
        default:
            return assertUnreachable(state);
    }
}

const REJECTION_TEXT: Record<DialogRejectionCause, string> = {
    forbidden: "You can't change who can see this file.",
    stale_revision:
        "This file changed since you opened it. Close this dialog and try again.",
    invalid_challenge:
        "This confirmation is no longer valid. Close this dialog and try again.",
    expired_challenge:
        "This confirmation expired. Close this dialog and try again.",
    consumed_challenge: "This confirmation was already used.",
    superseded_challenge:
        "A newer confirmation replaced this one. Close this dialog and try again.",
    idempotency_conflict:
        "That request conflicted with an earlier one. Close this dialog and try again.",
    protocol_error:
        "The server sent an unexpected response. Close this dialog and try again.",
    request_failed:
        "The request could not be completed. Close this dialog and try again.",
};

/**
 * The polite status line for a state, or null when there is nothing to announce.
 * None of these mention remaining time: the dialog never shows a countdown.
 */
export function statusText(state: DialogState): string | null {
    switch (state.tag) {
        case "closed":
        case "confirmation-ready":
            return null;
        case "requesting":
            return "Preparing confirmation…";
        case "confirming":
            return "Making public…";
        case "refreshing":
            return "Refreshing confirmation…";
        case "expired":
            return state.refreshFailed
                ? "This confirmation expired and could not be refreshed. Try again."
                : "This confirmation expired. Refresh to get a new one.";
        case "rejected":
            return REJECTION_TEXT[state.cause];
        default:
            return assertUnreachable(state);
    }
}
