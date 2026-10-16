import { requestJob } from "@/server/requestJob";
import { toConfirmableResult } from "@/utils/confirmation/requestResult";
import type {
    ConfirmableResult,
    ConfirmationRequired,
    IdempotencyKey,
    ProtocolError,
} from "@/utils/confirmation/protocol";

/**
 * Submits the confirmation as its own job, with its own idempotency key. The
 * challenge came from an earlier job that has already finished; nothing on the
 * backend waited for this request.
 */
export function requestConfirmation(
    challenge: ConfirmationRequired,
    key: IdempotencyKey,
): Promise<ConfirmableResult | ProtocolError> {
    return toConfirmableResult(() =>
        requestJob({
            method: "POST",
            url: "/api/confirmations",
            headers: { "Idempotency-Key": key },
            data: {
                operationKind: challenge.operationKind,
                target: {
                    type: challenge.target.type,
                    id: challenge.target.id,
                },
                expectedRevision: challenge.expectedRevision,
                challengeId: challenge.challengeId,
                proof: challenge.proof,
            },
        }),
    );
}
