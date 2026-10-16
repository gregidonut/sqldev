import { create } from "zustand";
import { currentToken, transition } from "./dialogMachine";
import {
    createFinalSuccessLedger,
    type FinalSuccessLedger,
} from "./finalSuccessLedger";
import { resolveFocusTarget } from "./focusRestore";
import {
    asIdempotencyKey,
    asOperationToken,
    type ChallengeId,
    type ConfirmableOperationAdapter,
    type ConfirmableResult,
    type ConfirmationTarget,
    type ConfigRevision,
    type DialogEffect,
    type DialogEvent,
    type DialogState,
    type DialogSubject,
    type IdempotencyKey,
    type OperationKind,
    type OperationToken,
    type ProtocolError,
    type VisibilityChanged,
} from "./protocol";

/**
 * The coordinator for backend-requested confirmations.
 *
 * It is deliberately NOT persisted: a challenge proof must never reach
 * localStorage, and a timer or abort controller cannot be serialized. It is also
 * separate from the persisted storage-table preferences store.
 *
 * All waiting happens here, in browser memory. When a dialog is open the backend
 * holds no worker slot, transaction, workflow or queue message.
 */

export type Clock = {
    now(): number;
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
};

export type ConfirmationDeps = {
    readonly clock: Clock;
    newKey(): IdempotencyKey;
    newToken(): OperationToken;
    /** Moves focus after the dialog closed. Defaults to the origin -> row -> heading chain. */
    restoreFocus(focus: DialogSubject["focus"]): void;
    /** Calls `listener` when the tab becomes visible again; returns an unsubscribe function. */
    onVisible(listener: () => void): () => void;
};

export type OpenRequest = {
    readonly operationKind: OperationKind;
    readonly target: ConfirmationTarget;
    readonly expectedRevision: ConfigRevision;
    readonly label: string;
    readonly focus: DialogSubject["focus"];
};

export interface ConfirmationStore {
    readonly state: DialogState;
    /** Opens the dialog and starts the initiation. Returns false if one is already open. */
    readonly open: (request: OpenRequest) => boolean;
    readonly confirm: () => void;
    readonly refresh: () => void;
    readonly close: () => void;
    /** Registers an operation; returns a function that removes it. */
    readonly registerAdapter: <Kind extends OperationKind>(
        adapter: ConfirmableOperationAdapter<Kind>,
    ) => () => void;
    readonly adapterFor: (
        kind: OperationKind,
    ) => ConfirmableOperationAdapter<OperationKind> | undefined;
    /**
     * Counts a committed change once per idempotency key. Used for changes that
     * never open the dialog (making an object private) as well as confirmations.
     */
    readonly recordFinalSuccess: (
        key: IdempotencyKey,
        invalidate: () => void,
    ) => boolean;
}

const FOCUS_RESTORE_DELAY_MS = 250;

/**
 * Moves focus to the best remaining target if React Aria's own restoration left
 * it on nothing: the menu trigger, else the object's row, else the page heading.
 */
export function restoreFocusNow(focus: DialogSubject["focus"]): void {
    const active = document.activeElement;
    if (active !== null && active !== document.body) {
        return;
    }
    resolveFocusTarget(focus)?.focus();
}

export const realDeps: ConfirmationDeps = {
    clock: {
        now: () => Date.now(),
        setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
        clearTimeout: (handle) =>
            clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    newKey: () => asIdempotencyKey(crypto.randomUUID()),
    newToken: () => asOperationToken(crypto.randomUUID()),
    restoreFocus(focus) {
        // The modal animates out and React Aria restores focus when it unmounts.
        // Only step in afterwards, and only if focus was left on nothing.
        setTimeout(() => restoreFocusNow(focus), FOCUS_RESTORE_DELAY_MS);
    },
    onVisible(listener) {
        const handler = () => {
            if (document.visibilityState === "visible") {
                listener();
            }
        };
        document.addEventListener("visibilitychange", handler);
        return () => document.removeEventListener("visibilitychange", handler);
    },
};

function isAbort(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        (error.name === "AbortError" || error.name === "CanceledError")
    );
}

export function createConfirmationStore(deps: ConfirmationDeps = realDeps) {
    const adapters = new Map<
        OperationKind,
        ConfirmableOperationAdapter<OperationKind>
    >();
    const aborts = new Map<OperationToken, AbortController>();
    const ledger: FinalSuccessLedger = createFinalSuccessLedger();
    let expiryTimer: unknown = null;
    let unsubscribeVisible: (() => void) | null = null;

    return create<ConfirmationStore>()((set, get) => {
        function clearExpiry() {
            if (expiryTimer !== null) {
                deps.clock.clearTimeout(expiryTimer);
                expiryTimer = null;
            }
        }

        function stopWatchingVisibility() {
            unsubscribeVisible?.();
            unsubscribeVisible = null;
        }

        function dispatch(event: DialogEvent) {
            const result = transition(get().state, event, deps.newKey);
            if (result.state !== get().state) {
                set({ state: result.state });
            }
            for (const effect of result.effects) {
                run(effect);
            }
            if (get().state.tag !== "confirmation-ready") {
                stopWatchingVisibility();
            }
        }

        function checkExpiry() {
            const state = get().state;
            if (
                state.tag === "confirmation-ready" &&
                deps.clock.now() >= state.challenge.expiresAt
            ) {
                dispatch({
                    type: "CHALLENGE_EXPIRED",
                    token: state.subject.token,
                    challengeId: state.challenge.challengeId,
                });
            }
        }

        function armExpiry(
            token: OperationToken,
            challengeId: ChallengeId,
            at: number,
        ) {
            clearExpiry();
            // A timer can be throttled in a background tab, so also re-check on return.
            stopWatchingVisibility();
            unsubscribeVisible = deps.onVisible(checkExpiry);
            expiryTimer = deps.clock.setTimeout(
                () => {
                    expiryTimer = null;
                    dispatch({ type: "CHALLENGE_EXPIRED", token, challengeId });
                },
                Math.max(0, at - deps.clock.now()),
            );
        }

        function run(effect: DialogEffect) {
            switch (effect.type) {
                case "submitInitiation": {
                    const state = get().state;
                    if (state.tag === "closed") {
                        return;
                    }
                    const adapter = adapters.get(state.subject.operationKind);
                    if (adapter === undefined) {
                        dispatch({
                            type: "INITIATION_FAILED",
                            token: effect.token,
                        });
                        return;
                    }
                    const controller = new AbortController();
                    aborts.set(effect.token, controller);
                    adapter
                        .initiate(state.subject, effect.key, controller.signal)
                        .then((result) =>
                            finishInitiation(effect.token, result),
                        )
                        .catch((error: unknown) => {
                            if (!isAbort(error)) {
                                dispatch({
                                    type: "INITIATION_FAILED",
                                    token: effect.token,
                                });
                            }
                        })
                        .finally(() => {
                            if (aborts.get(effect.token) === controller) {
                                aborts.delete(effect.token);
                            }
                        });
                    return;
                }
                case "abortInitiation":
                    aborts.get(effect.token)?.abort();
                    aborts.delete(effect.token);
                    return;
                case "submitConfirmation": {
                    const adapter = adapters.get(
                        effect.challenge.operationKind,
                    );
                    if (adapter === undefined) {
                        dispatch({
                            type: "CONFIRM_FAILED",
                            token: effect.token,
                        });
                        return;
                    }
                    adapter
                        .confirm(effect.challenge, effect.key)
                        .then((result) =>
                            finishConfirmation(
                                adapter,
                                effect.token,
                                effect.key,
                                result,
                            ),
                        )
                        .catch(() =>
                            dispatch({
                                type: "CONFIRM_FAILED",
                                token: effect.token,
                            }),
                        );
                    return;
                }
                case "armExpiry":
                    armExpiry(effect.token, effect.challengeId, effect.at);
                    return;
                case "cancelExpiry":
                    clearExpiry();
                    stopWatchingVisibility();
                    return;
                case "restoreFocus":
                    deps.restoreFocus(effect.focus);
                    return;
            }
        }

        function finishInitiation(
            token: OperationToken,
            result: ConfirmableResult | ProtocolError,
        ) {
            dispatch({ type: "INITIATION_RESOLVED", token, result });
        }

        function finishConfirmation(
            adapter: ConfirmableOperationAdapter<OperationKind>,
            token: OperationToken,
            key: IdempotencyKey,
            result: ConfirmableResult | ProtocolError,
        ) {
            // A committed change is counted before the token check, so it
            // invalidates exactly once even if its dialog is gone (Req 12.7).
            if (result.kind === "visibility_changed") {
                ledger.record(key, () => adapter.onFinalSuccess(result));
            }
            dispatch({ type: "CONFIRM_RESOLVED", token, result });
        }

        return {
            state: { tag: "closed" },
            open(request) {
                if (get().state.tag !== "closed") {
                    return false;
                }
                const subject: DialogSubject = {
                    token: deps.newToken(),
                    operationKind: request.operationKind,
                    target: request.target,
                    expectedRevision: request.expectedRevision,
                    label: request.label,
                    focus: request.focus,
                };
                dispatch({ type: "OPEN", subject });
                return true;
            },
            confirm() {
                const state = get().state;
                if (state.tag !== "confirmation-ready") {
                    return;
                }
                // Never submit a challenge the clock says has expired, even if the
                // timer has not fired yet (Req 11.1).
                if (deps.clock.now() >= state.challenge.expiresAt) {
                    checkExpiry();
                    return;
                }
                dispatch({ type: "CONFIRM", token: state.subject.token });
            },
            refresh() {
                const token = currentToken(get().state);
                if (token !== null) {
                    dispatch({ type: "REFRESH", token });
                }
            },
            close() {
                const token = currentToken(get().state);
                if (token !== null) {
                    dispatch({ type: "CLOSE", token });
                }
            },
            registerAdapter(adapter) {
                adapters.set(
                    adapter.kind,
                    adapter as ConfirmableOperationAdapter<OperationKind>,
                );
                return () => {
                    if (adapters.get(adapter.kind) === adapter) {
                        adapters.delete(adapter.kind);
                    }
                };
            },
            adapterFor: (kind) => adapters.get(kind),
            recordFinalSuccess: (key, invalidate) =>
                ledger.record(key, invalidate),
        };
    });
}

export const useConfirmationStore = createConfirmationStore();

export type { VisibilityChanged };
