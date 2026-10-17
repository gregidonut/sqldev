import {
    assertUnreachable,
    type AuthoritativeDialogCopy,
    type ConfirmableResult,
    type ConfirmationRequired,
    type CopyProtocolError,
    type DialogEffect,
    type DialogEvent,
    type DialogRejectionCause,
    type DialogState,
    type DialogSubject,
    type IdempotencyKey,
    type OperationToken,
    type ProtocolError,
    type RegistryIdentifier,
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
    return {
        state: { tag: "rejected", mode: "domain-or-request", subject, cause },
        effects: [],
    };
}

/** A legacy or malformed confirmation_required result: nothing from it is kept. */
function safeCopyFallback(
    subject: DialogSubject,
    error: CopyProtocolError,
): Transition {
    return {
        state: { tag: "rejected", mode: "safe-copy-fallback", subject, error },
        effects: [],
    };
}

function expiredWith(
    subject: DialogSubject,
    registryId: RegistryIdentifier,
    copy: AuthoritativeDialogCopy,
    refreshFailed: boolean,
): DialogState {
    return { tag: "expired", subject, registryId, copy, refreshFailed };
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
        case "protocol_error":
            // A bad confirmation_required result gets the safe fallback; any
            // other contract break is a generic rejection.
            return result.scope === "copy"
                ? safeCopyFallback(subject, result)
                : rejected(subject, "protocol_error");
        case "visibility_changed":
            // An initiation can never legitimately change visibility.
            return rejected(subject, "protocol_error");
        default:
            return assertUnreachable(result);
    }
}

function applyConfirmation(
    subject: DialogSubject,
    challenge: ConfirmationRequired,
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
                    state: expiredWith(
                        subject,
                        challenge.registryId,
                        challenge.dialogCopy,
                        false,
                    ),
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
                        state: expiredWith(
                            state.subject,
                            state.challenge.registryId,
                            state.challenge.dialogCopy,
                            false,
                        ),
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
                    return applyConfirmation(
                        state.subject,
                        state.challenge,
                        event.result,
                    );
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
                        state: {
                            tag: "refreshing",
                            subject: state.subject,
                            registryId: state.registryId,
                            copy: state.copy,
                        },
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
                        state: expiredWith(
                            state.subject,
                            state.registryId,
                            state.copy,
                            true,
                        ),
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
            // Only the safe fallback can start over, and only with a new key.
            // Nothing from the bad result is carried into the new request.
            if (
                event.type === "FRESH_INITIATION" &&
                state.mode === "safe-copy-fallback"
            ) {
                return {
                    state: { tag: "requesting", subject: state.subject },
                    effects: [
                        {
                            type: "submitInitiation",
                            token: state.subject.token,
                            key: newKey(),
                        },
                    ],
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
    /** Starts a new initiation after a legacy or malformed result (safe fallback only). */
    readonly freshInitiation: Control;
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
                freshInitiation: HIDDEN,
                cancel: { ...HIDDEN, label: "Cancel" },
                busy: false,
                dismissable: false,
            };
        case "requesting":
            // No authoritative label exists yet, so no confirm button is shown.
            return {
                confirm: HIDDEN,
                refresh: HIDDEN,
                freshInitiation: HIDDEN,
                cancel: { ...ENABLED, label: "Cancel" },
                busy: true,
                dismissable: true,
            };
        case "confirmation-ready":
            return {
                confirm: ENABLED,
                refresh: HIDDEN,
                freshInitiation: HIDDEN,
                cancel: { ...ENABLED, label: "Cancel" },
                busy: false,
                dismissable: true,
            };
        case "confirming":
            return {
                confirm: DISABLED,
                refresh: HIDDEN,
                freshInitiation: HIDDEN,
                cancel: { ...DISABLED, label: "Cancel" },
                busy: true,
                dismissable: false,
            };
        case "expired":
            return {
                confirm: DISABLED,
                refresh: ENABLED,
                freshInitiation: HIDDEN,
                cancel: { ...ENABLED, label: "Cancel" },
                busy: false,
                dismissable: true,
            };
        case "refreshing":
            return {
                confirm: DISABLED,
                refresh: DISABLED,
                freshInitiation: HIDDEN,
                cancel: { ...ENABLED, label: "Cancel" },
                busy: true,
                dismissable: true,
            };
        case "rejected":
            return {
                confirm: HIDDEN,
                refresh: HIDDEN,
                freshInitiation:
                    state.mode === "safe-copy-fallback" ? ENABLED : HIDDEN,
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
            return "Confirming…";
        case "refreshing":
            return "Refreshing confirmation…";
        case "expired":
            return state.refreshFailed
                ? "This confirmation expired and could not be refreshed. Try again."
                : "This confirmation expired. Refresh to get a new one.";
        case "rejected":
            return state.mode === "safe-copy-fallback"
                ? FALLBACK_STATUS_TEXT
                : REJECTION_TEXT[state.cause];
        default:
            return assertUnreachable(state);
    }
}

const FALLBACK_STATUS_TEXT =
    "We couldn't show what this confirmation would do, so nothing was changed. Close this dialog, or get a new confirmation.";

/** What the dialog shows as its heading, description and primary-button label. */
export type Presentation = {
    readonly title: string;
    /** Null in the generic states: the host then omits aria-describedby. */
    readonly description: string | null;
    /** Null when no authoritative label exists, so no primary button is shown. */
    readonly confirmLabel: string | null;
};

const GENERIC_TITLE = "Confirmation";
const UNAVAILABLE_TITLE = "Confirmation unavailable";
const FALLBACK_TITLE = "Confirmation details unavailable";

/**
 * The dialog text for a state. Operation-specific text exists only in the
 * validated copy PostgreSQL returned; every other state gets fixed generic strings
 * that name no operation (Req 6.8).
 */
export function presentationFor(state: DialogState): Presentation {
    switch (state.tag) {
        case "confirmation-ready":
        case "confirming":
            return state.challenge.dialogCopy;
        case "expired":
        case "refreshing":
            return state.copy;
        case "closed":
        case "requesting":
            return {
                title: GENERIC_TITLE,
                description: null,
                confirmLabel: null,
            };
        case "rejected":
            return {
                title:
                    state.mode === "safe-copy-fallback"
                        ? FALLBACK_TITLE
                        : UNAVAILABLE_TITLE,
                description: null,
                confirmLabel: null,
            };
        default:
            return assertUnreachable(state);
    }
}

/**
 * The registry identifier PostgreSQL returned with the challenge being shown, or
 * null when no validated result exists yet (requesting) or the dialog shows only
 * fixed generic text (rejected, closed). Display only: it has no authorization
 * weight and is never sent back.
 */
export function registryIdFor(state: DialogState): RegistryIdentifier | null {
    switch (state.tag) {
        case "confirmation-ready":
        case "confirming":
            return state.challenge.registryId;
        case "expired":
        case "refreshing":
            return state.registryId;
        case "closed":
        case "requesting":
        case "rejected":
            return null;
        default:
            return assertUnreachable(state);
    }
}
