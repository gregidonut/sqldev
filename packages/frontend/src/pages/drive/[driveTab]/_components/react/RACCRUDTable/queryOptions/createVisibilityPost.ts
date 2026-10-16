import { mutationOptions } from "@tanstack/react-query";
import { requestJob } from "@/server/requestJob";
import { toConfirmableResult } from "@/utils/confirmation/requestResult";
import type {
    ConfigRevision,
    ConfirmableResult,
    ConfirmationTarget,
    IdempotencyKey,
    ProtocolError,
    Visibility,
} from "@/utils/confirmation/protocol";
import { asIdempotencyKey } from "@/utils/confirmation/protocol";
import { storageBasePath } from "./paths.ts";

export type VisibilityChange = {
    readonly bucketName: string;
    readonly target: ConfirmationTarget;
    readonly expectedRevision: ConfigRevision;
    readonly visibility: Visibility;
};

/**
 * Submits one visibility job. `public` only begins the confirmation (the job
 * completes with a challenge); `private` changes the object directly.
 *
 * The caller owns the idempotency key so a retry of the same request reuses it,
 * while a new user action, a refresh and a confirmation each get their own.
 */
export function requestVisibilityChange(
    { bucketName, target, expectedRevision, visibility }: VisibilityChange,
    key: IdempotencyKey,
    signal?: AbortSignal,
): Promise<ConfirmableResult | ProtocolError> {
    return toConfirmableResult(() =>
        requestJob(
            {
                method: "POST",
                url: `${storageBasePath(bucketName)}/objects/visibility`,
                headers: { "Idempotency-Key": key },
                data: {
                    target: { type: target.type, id: target.id },
                    expectedRevision,
                    visibility,
                },
            },
            signal,
        ),
    );
}

export type MakePrivateVariables = {
    readonly target: ConfirmationTarget;
    readonly expectedRevision: ConfigRevision;
    /** One key per user invocation. Defaults to a fresh one. */
    readonly key?: IdempotencyKey;
};

/** Making an object private needs no confirmation, so it is one ordinary mutation. */
export function createMakePrivateMutationOptions({
    bucketName,
}: {
    bucketName: string;
}) {
    return mutationOptions({
        mutationFn: function ({
            target,
            expectedRevision,
            key,
        }: MakePrivateVariables) {
            return requestVisibilityChange(
                { bucketName, target, expectedRevision, visibility: "private" },
                key ?? asIdempotencyKey(crypto.randomUUID()),
            );
        },
    });
}
