/**
 * Test doubles for the confirmation coordinator: a fake clock the test advances by
 * hand, and an adapter whose requests the test resolves in any order.
 */
import {
    createConfirmationStore,
    type Clock,
    type ConfirmationDeps,
    type OpenRequest,
} from "./confirmationStore";
import {
    asIdempotencyKey,
    asOperationToken,
    asRegistryIdentifier,
    type ChallengeId,
    type ChallengeProof,
    type ConfigRevision,
    type ConfirmableOperationAdapter,
    type ConfirmableResult,
    type ConfirmationRequired,
    type DialogSubject,
    type IdempotencyKey,
    type OperationToken,
    type ProtocolError,
    type StorageObjectId,
    type VisibilityChanged,
} from "./protocol";

export const START = Date.UTC(2026, 9, 14, 12, 0, 0);

export type FakeClock = Clock & {
    advance(ms: number): void;
    set(at: number): void;
    pending(): number;
};

export function createFakeClock(): FakeClock {
    let now = START;
    let nextId = 1;
    const timers = new Map<number, { due: number; callback: () => void }>();
    return {
        now: () => now,
        setTimeout(callback, delayMs) {
            const id = nextId++;
            timers.set(id, { due: now + delayMs, callback });
            return id;
        },
        clearTimeout(handle) {
            timers.delete(handle as number);
        },
        advance(ms) {
            this.set(now + ms);
        },
        set(at) {
            now = at;
            for (;;) {
                const due = [...timers.entries()]
                    .filter(([, timer]) => timer.due <= now)
                    .sort((a, b) => a[1].due - b[1].due)[0];
                if (due === undefined) {
                    return;
                }
                timers.delete(due[0]);
                due[1].callback();
            }
        },
        pending: () => timers.size,
    };
}

export type Deferred<T> = {
    readonly promise: Promise<T>;
    resolve(value: T): void;
    reject(reason: unknown): void;
};

export function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

export const OBJECT_ID =
    "5b1f7f0e-0c4a-4f7e-9a63-2f4f6a1d9b11" as StorageObjectId;
export const REVISION = 3 as ConfigRevision;
const PROOF = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCde" as ChallengeProof;

export type Call<Result> = {
    readonly token: OperationToken;
    readonly key: IdempotencyKey;
    readonly signal?: AbortSignal;
    readonly result: Deferred<Result>;
};

export type FakeAdapter =
    ConfirmableOperationAdapter<"storage.visibility.make_public"> & {
        readonly initiations: Call<ConfirmableResult | ProtocolError>[];
        readonly confirmations: (Call<ConfirmableResult | ProtocolError> & {
            readonly challenge: ConfirmationRequired;
        })[];
        readonly finalSuccesses: VisibilityChanged[];
    };

export function createFakeAdapter(): FakeAdapter {
    const initiations: FakeAdapter["initiations"] = [];
    const confirmations: FakeAdapter["confirmations"] = [];
    const finalSuccesses: VisibilityChanged[] = [];
    return {
        kind: "storage.visibility.make_public",
        initiations,
        confirmations,
        finalSuccesses,
        initiate(subject, key, signal) {
            const call = {
                token: subject.token,
                key,
                signal,
                result: deferred<ConfirmableResult | ProtocolError>(),
            };
            initiations.push(call);
            return call.result.promise;
        },
        confirm(challenge, key) {
            const call = {
                token: tokenForChallenge(challenge),
                key,
                challenge,
                result: deferred<ConfirmableResult | ProtocolError>(),
            };
            confirmations.push(call);
            return call.result.promise;
        },
        onFinalSuccess(result) {
            finalSuccesses.push(result);
        },
    };
}

// The adapter never sees the dialog token on confirm, so tests identify a
// confirmation by its challenge instead.
function tokenForChallenge(challenge: ConfirmationRequired): OperationToken {
    return asOperationToken(`challenge:${challenge.challengeId}`);
}

export function challenge(
    over: Partial<ConfirmationRequired> & { expiresInMs?: number } = {},
): ConfirmationRequired {
    const { expiresInMs, ...rest } = over;
    return {
        kind: "confirmation_required",
        registryId: asRegistryIdentifier("1000"),
        operationKind: "storage.visibility.make_public",
        target: { type: "storage_object", id: OBJECT_ID },
        expectedRevision: REVISION,
        challengeId: `c-${Math.random().toString(16).slice(2)}` as ChallengeId,
        proof: PROOF,
        expiresAt: START + (expiresInMs ?? 5 * 60_000),
        dialogCopy: {
            title: "Make “report.pdf” public?",
            description:
                "Anyone signed in will be able to see and download this file.",
            confirmLabel: "Make public",
        },
        ...rest,
    };
}

export function changed(
    over: Partial<VisibilityChanged> = {},
): VisibilityChanged {
    return {
        kind: "visibility_changed",
        target: { type: "storage_object", id: OBJECT_ID },
        visibility: "public",
        revision: (REVISION + 1) as ConfigRevision,
        ...over,
    };
}

export function openRequest(over: Partial<OpenRequest> = {}): OpenRequest {
    return {
        operationKind: "storage.visibility.make_public",
        target: { type: "storage_object", id: OBJECT_ID },
        expectedRevision: REVISION,
        focus: { origin: null, rowKey: "row-1" },
        ...over,
    };
}

export type Rig = {
    readonly store: ReturnType<typeof createConfirmationStore>;
    readonly clock: FakeClock;
    readonly adapter: FakeAdapter;
    readonly focusRestored: DialogSubject["focus"][];
    readonly visibleListeners: Set<() => void>;
    readonly keys: IdempotencyKey[];
};

export function createRig(): Rig {
    const clock = createFakeClock();
    const adapter = createFakeAdapter();
    const focusRestored: DialogSubject["focus"][] = [];
    const visibleListeners = new Set<() => void>();
    const keys: IdempotencyKey[] = [];
    let keyCounter = 0;
    let tokenCounter = 0;
    const deps: ConfirmationDeps = {
        clock,
        newKey: () => {
            const key = asIdempotencyKey(`key-${++keyCounter}`);
            keys.push(key);
            return key;
        },
        newToken: () => asOperationToken(`token-${++tokenCounter}`),
        restoreFocus: (focus) => focusRestored.push(focus),
        onVisible(listener) {
            visibleListeners.add(listener);
            return () => visibleListeners.delete(listener);
        },
    };
    const store = createConfirmationStore(deps);
    store.getState().registerAdapter(adapter);
    return { store, clock, adapter, focusRestored, visibleListeners, keys };
}

/** Lets pending promise callbacks run. */
export function flush(): Promise<void> {
    // Five chained microtask ticks, built without awaiting inside a loop.
    return Array.from({ length: 5 }).reduce<Promise<void>>(
        (chain) => chain.then(() => undefined),
        Promise.resolve(),
    );
}
