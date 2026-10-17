import {
    asRegistryIdentifier,
    isConfigRevision,
    isOperationKind,
    isProof,
    isRejectionReason,
    isUuid,
    type AuthoritativeDialogCopy,
    type ChallengeId,
    type ConfirmableResult,
    type ConfirmationRequired,
    type ConfirmationTarget,
    type OperationKind,
    type ProtocolError,
    type RegistryIdentifier,
    type StorageObjectId,
    type Visibility,
} from "./protocol";

const PAYLOAD_ERROR: ProtocolError = {
    kind: "protocol_error",
    scope: "payload",
};
const LEGACY_COPY_ERROR: ProtocolError = {
    kind: "protocol_error",
    scope: "copy",
    shape: "legacy",
};
const MALFORMED_COPY_ERROR: ProtocolError = {
    kind: "protocol_error",
    scope: "copy",
    shape: "malformed",
};

// Canonical decimal text of a registry identifier: no sign, no leading zero, at
// least four digits (the minimum is 1000). The numeric range is checked below.
const REGISTRY_ID_TEXT = /^[1-9][0-9]{3,18}$/;
// BigInt(...) calls, not 1000n literals, so the compile target does not matter.
const MIN_REGISTRY_ID = BigInt("1000");
const MAX_REGISTRY_ID = BigInt("9223372036854775807");

// The shared "blank" class: Unicode White_Space. The same set is used by the
// PostgreSQL CHECKs and the Go decoder. Deliberately not String.prototype.trim(),
// which also strips U+FEFF and so disagrees with the other two layers.
const BLANK =
    /^[\t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]*$/;

const COPY_LIMITS = {
    title: 200,
    description: 2000,
    confirmLabel: 80,
} as const;

// RFC 3339 with an explicit offset; "tomorrow" or a bare year must not be accepted.
const TIMESTAMP =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Exactly these keys: a missing field and an undeclared field are both errors. */
function hasExactKeys(
    value: Record<string, unknown>,
    keys: readonly string[],
): boolean {
    const own = Object.keys(value);
    return own.length === keys.length && keys.every((key) => key in value);
}

function decodeTarget(value: unknown): ConfirmationTarget | null {
    if (
        !isRecord(value) ||
        !hasExactKeys(value, ["type", "id"]) ||
        value.type !== "storage_object" ||
        !isUuid(value.id)
    ) {
        return null;
    }
    return { type: "storage_object", id: value.id as StorageObjectId };
}

/** True when every UTF-16 surrogate in the string is part of a valid pair. */
function isWellFormed(value: string): boolean {
    for (let i = 0; i < value.length; i += 1) {
        const unit = value.charCodeAt(i);
        if (unit >= 0xd800 && unit <= 0xdbff) {
            const next = value.charCodeAt(i + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff)) {
                return false;
            }
            i += 1;
        } else if (unit >= 0xdc00 && unit <= 0xdfff) {
            return false;
        }
    }
    return true;
}

function decodeRegistryId(value: unknown): RegistryIdentifier | null {
    if (typeof value !== "string" || !REGISTRY_ID_TEXT.test(value)) {
        return null;
    }
    const id = BigInt(value);
    return id >= MIN_REGISTRY_ID && id <= MAX_REGISTRY_ID
        ? asRegistryIdentifier(value)
        : null;
}

/** One copy field: a string, not blank, within its code-point bound, well formed. */
function isValidCopyText(value: unknown, max: number): value is string {
    return (
        typeof value === "string" &&
        isWellFormed(value) &&
        !BLANK.test(value) &&
        Array.from(value).length <= max
    );
}

function decodeDialogCopy(value: unknown): AuthoritativeDialogCopy | null {
    if (
        !isRecord(value) ||
        !hasExactKeys(value, ["title", "description", "confirmLabel"]) ||
        !isValidCopyText(value.title, COPY_LIMITS.title) ||
        !isValidCopyText(value.description, COPY_LIMITS.description) ||
        !isValidCopyText(value.confirmLabel, COPY_LIMITS.confirmLabel)
    ) {
        return null;
    }
    // Returned unchanged: no trim, sanitize or interpolation.
    return {
        title: value.title,
        description: value.description,
        confirmLabel: value.confirmLabel,
    };
}

type RequiredCore = Omit<
    ConfirmationRequired,
    "registryId" | "dialogCopy" | "kind"
>;

/** The fields the legacy and current shapes share. */
function decodeRequiredCore(
    value: Record<string, unknown>,
): RequiredCore | null {
    const target = decodeTarget(value.target);
    const expiresAt = decodeTimestamp(value.expiresAt);
    if (
        !isOperationKind(value.operationKind) ||
        target === null ||
        !isConfigRevision(value.expectedRevision) ||
        !isUuid(value.challengeId) ||
        !isProof(value.proof) ||
        expiresAt === null
    ) {
        return null;
    }
    return {
        operationKind: value.operationKind as OperationKind,
        target,
        expectedRevision: value.expectedRevision,
        challengeId: value.challengeId as ChallengeId,
        proof: value.proof,
        expiresAt,
    };
}

const CURRENT_KEYS = [
    "kind",
    "registryId",
    "operationKind",
    "target",
    "expectedRevision",
    "challengeId",
    "proof",
    "expiresAt",
    "dialogCopy",
] as const;
// The pre-feature shape: the current keys without registryId and dialogCopy.
const LEGACY_KEYS = CURRENT_KEYS.filter(
    (key) => key !== "registryId" && key !== "dialogCopy",
);

/**
 * Classifies a `confirmation_required` payload: the current nine-key shape is a
 * result; the seven-key pre-feature shape is a legacy copy error; anything else
 * is a malformed copy error. Neither error can enable a confirm action.
 */
function decodeConfirmationRequired(
    value: Record<string, unknown>,
): ConfirmationRequired | ProtocolError {
    if (hasExactKeys(value, CURRENT_KEYS)) {
        const core = decodeRequiredCore(value);
        const registryId = decodeRegistryId(value.registryId);
        const dialogCopy = decodeDialogCopy(value.dialogCopy);
        if (core === null || registryId === null || dialogCopy === null) {
            return MALFORMED_COPY_ERROR;
        }
        return {
            kind: "confirmation_required",
            registryId,
            ...core,
            dialogCopy,
        };
    }
    if (
        hasExactKeys(value, LEGACY_KEYS) &&
        decodeRequiredCore(value) !== null
    ) {
        return LEGACY_COPY_ERROR;
    }
    return MALFORMED_COPY_ERROR;
}

function decodeTimestamp(value: unknown): number | null {
    if (typeof value !== "string" || !TIMESTAMP.test(value)) {
        return null;
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Validates a completed job's result against the contract. Anything that is not
 * exactly one known branch becomes a ProtocolError, which can never enable a
 * confirm action (Req 13.6).
 */
export function decodeConfirmableResult(
    value: unknown,
): ConfirmableResult | ProtocolError {
    if (!isRecord(value) || typeof value.kind !== "string") {
        return PAYLOAD_ERROR;
    }
    switch (value.kind) {
        case "confirmation_required":
            return decodeConfirmationRequired(value);
        case "visibility_changed": {
            if (
                !hasExactKeys(value, [
                    "kind",
                    "target",
                    "visibility",
                    "revision",
                ])
            ) {
                return PAYLOAD_ERROR;
            }
            const target = decodeTarget(value.target);
            const visibility = value.visibility;
            if (
                target === null ||
                (visibility !== "public" && visibility !== "private") ||
                !isConfigRevision(value.revision)
            ) {
                return PAYLOAD_ERROR;
            }
            return {
                kind: "visibility_changed",
                target,
                visibility: visibility as Visibility,
                revision: value.revision,
            };
        }
        case "rejected": {
            if (
                !hasExactKeys(value, ["kind", "reason"]) ||
                !isRejectionReason(value.reason)
            ) {
                return PAYLOAD_ERROR;
            }
            return { kind: "rejected", reason: value.reason };
        }
        default:
            return PAYLOAD_ERROR;
    }
}

/** The wire form of a decoded result, used to test that decoding loses nothing. */
export function encodeConfirmableResult(result: ConfirmableResult): unknown {
    switch (result.kind) {
        case "confirmation_required":
            return {
                kind: result.kind,
                registryId: result.registryId,
                operationKind: result.operationKind,
                target: { type: result.target.type, id: result.target.id },
                expectedRevision: result.expectedRevision,
                challengeId: result.challengeId,
                proof: result.proof,
                expiresAt: new Date(result.expiresAt).toISOString(),
                dialogCopy: {
                    title: result.dialogCopy.title,
                    description: result.dialogCopy.description,
                    confirmLabel: result.dialogCopy.confirmLabel,
                },
            };
        case "visibility_changed":
            return {
                kind: result.kind,
                target: { type: result.target.type, id: result.target.id },
                visibility: result.visibility,
                revision: result.revision,
            };
        case "rejected":
            return { kind: result.kind, reason: result.reason };
    }
}
