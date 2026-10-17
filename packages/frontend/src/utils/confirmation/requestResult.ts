import axios from "axios";
import { decodeConfirmableResult } from "./decodeResult";
import type { ConfirmableResult, ProtocolError } from "./protocol";

/**
 * Runs a request whose completed job result is a ConfirmableOperationResult.
 *
 * - A completed job's result is validated against the contract.
 * - The API answers 409 {kind:"rejected", reason:"idempotency_conflict"} before any
 *   job exists. That body is decoded the same way, so the caller sees a rejection
 *   rather than an opaque error.
 * - Every other failure (network, a failed job, 4xx/5xx) is rethrown. Callers treat
 *   it as "request failed", never as a rejection or a success.
 */
export async function toConfirmableResult(
    run: () => Promise<unknown>,
): Promise<ConfirmableResult | ProtocolError> {
    try {
        return decodeConfirmableResult(await run());
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 409) {
            const decoded = decodeConfirmableResult(error.response.data);
            if (decoded.kind === "rejected") {
                return decoded;
            }
            return { kind: "protocol_error", scope: "payload" };
        }
        throw error;
    }
}
