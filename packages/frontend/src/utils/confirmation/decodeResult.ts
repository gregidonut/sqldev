import {
    isConfigRevision,
    isOperationKind,
    isProof,
    isRejectionReason,
    isUuid,
    type ChallengeId,
    type ConfirmableResult,
    type ConfirmationTarget,
    type ProtocolError,
    type StorageObjectId,
    type Visibility,
} from "./protocol";

const PROTOCOL_ERROR: ProtocolError = { kind: "protocol_error" };

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
        return PROTOCOL_ERROR;
    }
    switch (value.kind) {
        case "confirmation_required": {
            if (
                !hasExactKeys(value, [
                    "kind",
                    "operationKind",
                    "target",
                    "expectedRevision",
                    "challengeId",
                    "proof",
                    "expiresAt",
                ])
            ) {
                return PROTOCOL_ERROR;
            }
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
                return PROTOCOL_ERROR;
            }
            return {
                kind: "confirmation_required",
                operationKind: value.operationKind,
                target,
                expectedRevision: value.expectedRevision,
                challengeId: value.challengeId as ChallengeId,
                proof: value.proof,
                expiresAt,
            };
        }
        case "visibility_changed": {
            if (
                !hasExactKeys(value, [
                    "kind",
                    "target",
                    "visibility",
                    "revision",
                ])
            ) {
                return PROTOCOL_ERROR;
            }
            const target = decodeTarget(value.target);
            const visibility = value.visibility;
            if (
                target === null ||
                (visibility !== "public" && visibility !== "private") ||
                !isConfigRevision(value.revision)
            ) {
                return PROTOCOL_ERROR;
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
                return PROTOCOL_ERROR;
            }
            return { kind: "rejected", reason: value.reason };
        }
        default:
            return PROTOCOL_ERROR;
    }
}

/** The wire form of a decoded result, used to test that decoding loses nothing. */
export function encodeConfirmableResult(result: ConfirmableResult): unknown {
    switch (result.kind) {
        case "confirmation_required":
            return {
                kind: result.kind,
                operationKind: result.operationKind,
                target: { type: result.target.type, id: result.target.id },
                expectedRevision: result.expectedRevision,
                challengeId: result.challengeId,
                proof: result.proof,
                expiresAt: new Date(result.expiresAt).toISOString(),
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
