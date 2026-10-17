/**
 * Types for the backend-requested confirmation protocol.
 *
 * The backend (PostgreSQL) decides when a user must confirm an operation. The
 * browser shows one dialog, waits for the person, and only then submits a second,
 * separate job. Nothing here is specific to storage; the storage make-public
 * operation is the only one registered so far (see ConfirmableOperationAdapter).
 */

declare const brand: unique symbol;
type Brand<Value, Name extends string> = Value & { readonly [brand]: Name };

export type ChallengeId = Brand<string, "ChallengeId">;
export type StorageObjectId = Brand<string, "StorageObjectId">;
export type ChallengeProof = Brand<string, "ChallengeProof">;
/** Identifies one dialog operation; results carrying any other token are stale. */
export type OperationToken = Brand<string, "OperationToken">;
/** One key per submitted job. Initiation, refresh and confirmation each get their own. */
export type IdempotencyKey = Brand<string, "IdempotencyKey">;
export type ConfigRevision = Brand<number, "ConfigRevision">;
/**
 * Canonical base-10 text of a PostgreSQL BIGINT of at least 1000. Text, not a
 * number, because JavaScript numbers are exact only to 2^53-1. Presentation and
 * protocol identity only; it carries no authorization weight.
 */
export type RegistryIdentifier = Brand<string, "RegistryIdentifier">;

export const OPERATION_KINDS = ["storage.visibility.make_public"] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

export type ConfirmationTarget = {
    readonly type: "storage_object";
    readonly id: StorageObjectId;
};

export const REJECTION_REASONS = [
    "forbidden",
    "stale_revision",
    "invalid_challenge",
    "expired_challenge",
    "consumed_challenge",
    "superseded_challenge",
    "idempotency_conflict",
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

/**
 * The text of the dialog, produced by PostgreSQL and validated by the decoder.
 * Plain text: the host renders it as text children, never as HTML.
 */
export type AuthoritativeDialogCopy = {
    readonly title: string;
    readonly description: string;
    readonly confirmLabel: string;
};

/** The first job finished and issued a challenge. Nothing on the backend is waiting. */
export type ConfirmationRequired = {
    readonly kind: "confirmation_required";
    readonly registryId: RegistryIdentifier;
    readonly operationKind: OperationKind;
    readonly target: ConfirmationTarget;
    readonly expectedRevision: ConfigRevision;
    readonly challengeId: ChallengeId;
    readonly proof: ChallengeProof;
    /** Epoch milliseconds, parsed from the server's ISO timestamp. */
    readonly expiresAt: number;
    readonly dialogCopy: AuthoritativeDialogCopy;
};

export type Visibility = "public" | "private";

export type VisibilityChanged = {
    readonly kind: "visibility_changed";
    readonly target: ConfirmationTarget;
    readonly visibility: Visibility;
    readonly revision: ConfigRevision;
};

export type OperationRejected = {
    readonly kind: "rejected";
    readonly reason: RejectionReason;
};

export type ConfirmableResult =
    ConfirmationRequired | VisibilityChanged | OperationRejected;

/**
 * Frontend-only: the payload broke the contract. It never enables a confirm.
 * `scope: "copy"` means a `confirmation_required` payload that is not a valid
 * current result (`legacy` = the pre-feature seven-key shape, `malformed` =
 * anything else); `scope: "payload"` is every other contract break.
 */
export type ProtocolError =
    | { readonly kind: "protocol_error"; readonly scope: "payload" }
    | {
          readonly kind: "protocol_error";
          readonly scope: "copy";
          readonly shape: "legacy" | "malformed";
      };
export type CopyProtocolError = Extract<ProtocolError, { scope: "copy" }>;

/** What the person asked to change, captured when the menu item was invoked. */
export type DialogSubject<Kind extends OperationKind = OperationKind> = {
    readonly token: OperationToken;
    readonly operationKind: Kind;
    readonly target: ConfirmationTarget;
    readonly expectedRevision: ConfigRevision;
    readonly focus: {
        readonly origin: HTMLElement | null;
        /** React Aria row key (`data-key`) used to find the row again. */
        readonly rowKey: string;
    };
};

export type DialogRejectionCause =
    RejectionReason | "protocol_error" | "request_failed";

/**
 * `domain-or-request`: a rejection or request failure shown as fixed generic text.
 * `safe-copy-fallback`: a legacy or malformed confirmation_required result; only
 * Close and a fresh initiation are offered, and nothing from the bad result is kept
 * except its classification.
 */
export type RejectedState =
    | {
          readonly tag: "rejected";
          readonly mode: "domain-or-request";
          readonly subject: DialogSubject;
          readonly cause: DialogRejectionCause;
      }
    | {
          readonly tag: "rejected";
          readonly mode: "safe-copy-fallback";
          readonly subject: DialogSubject;
          readonly error: CopyProtocolError;
      };

/** Exactly one state; each variant carries only the data valid for it (Req 10.10). */
export type DialogState =
    | { readonly tag: "closed" }
    | { readonly tag: "requesting"; readonly subject: DialogSubject }
    | {
          readonly tag: "confirmation-ready";
          readonly subject: DialogSubject;
          readonly challenge: ConfirmationRequired;
      }
    | {
          readonly tag: "confirming";
          readonly subject: DialogSubject;
          readonly challenge: ConfirmationRequired;
      }
    | {
          readonly tag: "expired";
          readonly subject: DialogSubject;
          /** The previously validated identity and copy; the challenge and proof are not kept. */
          readonly registryId: RegistryIdentifier;
          readonly copy: AuthoritativeDialogCopy;
          /** True after a refresh failed for a transient reason; the person can retry. */
          readonly refreshFailed: boolean;
      }
    | {
          readonly tag: "refreshing";
          readonly subject: DialogSubject;
          readonly registryId: RegistryIdentifier;
          readonly copy: AuthoritativeDialogCopy;
      }
    | RejectedState;

export type DialogTag = DialogState["tag"];

export type DialogEvent =
    | { readonly type: "OPEN"; readonly subject: DialogSubject }
    | {
          readonly type: "INITIATION_RESOLVED";
          readonly token: OperationToken;
          readonly result: ConfirmableResult | ProtocolError;
      }
    | { readonly type: "INITIATION_FAILED"; readonly token: OperationToken }
    | {
          readonly type: "CHALLENGE_EXPIRED";
          readonly token: OperationToken;
          readonly challengeId: ChallengeId;
      }
    | { readonly type: "CONFIRM"; readonly token: OperationToken }
    | {
          readonly type: "CONFIRM_RESOLVED";
          readonly token: OperationToken;
          readonly result: ConfirmableResult | ProtocolError;
      }
    | { readonly type: "CONFIRM_FAILED"; readonly token: OperationToken }
    | { readonly type: "REFRESH"; readonly token: OperationToken }
    /** Only from `rejected` / `safe-copy-fallback`: start over with a new idempotency key. */
    | { readonly type: "FRESH_INITIATION"; readonly token: OperationToken }
    | { readonly type: "CLOSE"; readonly token: OperationToken };

export type DialogEffect =
    | {
          readonly type: "submitInitiation";
          readonly token: OperationToken;
          readonly key: IdempotencyKey;
      }
    | { readonly type: "abortInitiation"; readonly token: OperationToken }
    | {
          readonly type: "submitConfirmation";
          readonly token: OperationToken;
          readonly key: IdempotencyKey;
          readonly challenge: ConfirmationRequired;
      }
    | {
          readonly type: "armExpiry";
          readonly token: OperationToken;
          readonly challengeId: ChallengeId;
          readonly at: number;
      }
    | { readonly type: "cancelExpiry" }
    | { readonly type: "restoreFocus"; readonly focus: DialogSubject["focus"] };

/**
 * One operation the dialog host can confirm: transport and success handling only.
 * The dialog text comes from the validated result (`ConfirmationRequired.dialogCopy`),
 * never from the adapter. The host never imports storage code.
 */
export interface ConfirmableOperationAdapter<Kind extends OperationKind> {
    readonly kind: Kind;
    initiate(
        subject: DialogSubject<Kind>,
        key: IdempotencyKey,
        signal: AbortSignal,
    ): Promise<ConfirmableResult | ProtocolError>;
    confirm(
        challenge: ConfirmationRequired,
        key: IdempotencyKey,
    ): Promise<ConfirmableResult | ProtocolError>;
    /** Runs once per committed change, for example to invalidate cached lists. */
    onFinalSuccess(result: VisibilityChanged): void;
}

export function assertUnreachable(value: never): never {
    throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROOF = /^[A-Za-z0-9_-]{43}$/;

export function isUuid(value: unknown): value is string {
    return typeof value === "string" && UUID.test(value);
}

export function isProof(value: unknown): value is ChallengeProof {
    return typeof value === "string" && PROOF.test(value);
}

/** A revision is a positive integer a JavaScript number can hold exactly. */
export function isConfigRevision(value: unknown): value is ConfigRevision {
    return (
        typeof value === "number" && Number.isSafeInteger(value) && value >= 1
    );
}

export function toStorageObjectId(value: string): StorageObjectId | null {
    return isUuid(value) ? (value as StorageObjectId) : null;
}

export function toConfigRevision(value: unknown): ConfigRevision | null {
    return isConfigRevision(value) ? value : null;
}

/** Brands text the decoder has already proven canonical and in range. */
export function asRegistryIdentifier(value: string): RegistryIdentifier {
    return value as RegistryIdentifier;
}

export function asOperationToken(value: string): OperationToken {
    return value as OperationToken;
}

export function asIdempotencyKey(value: string): IdempotencyKey {
    return value as IdempotencyKey;
}

export function isOperationKind(value: unknown): value is OperationKind {
    return OPERATION_KINDS.some((kind) => kind === value);
}

export function isRejectionReason(value: unknown): value is RejectionReason {
    return REJECTION_REASONS.some((reason) => reason === value);
}
