import type { IdempotencyKey } from "./protocol";

export type FinalSuccessLedger = {
    /**
     * Runs `invalidate` the first time a Final_Success is recorded for `key`, and
     * never again. Returns whether it ran.
     *
     * One idempotency key names exactly one job, so the key is enough to count a
     * committed change once even if its result is delivered twice, arrives after
     * the dialog was closed, or arrives for a dialog that was replaced.
     */
    record(key: IdempotencyKey, invalidate: () => void): boolean;
};

export function createFinalSuccessLedger(): FinalSuccessLedger {
    const seen = new Set<IdempotencyKey>();
    return {
        record(key, invalidate) {
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            invalidate();
            return true;
        },
    };
}
