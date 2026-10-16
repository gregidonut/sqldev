import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import {
    decodeConfirmableResult,
    encodeConfirmableResult,
} from "./decodeResult";
import { REJECTION_REASONS } from "./protocol";

// The corpus is shared with the Go decoder, so both sides agree on what is valid.
const corpus = JSON.parse(
    readFileSync(
        join(
            import.meta.dir,
            "../../../../functions/cmd/goapi/api/testdata/confirmable_results.json",
        ),
        "utf8",
    ),
) as {
    valid: unknown[];
    malformed: { name: string; value: unknown }[];
};

const uuid = fc.uuid();
const proof = fc
    .array(
        fc.constantFrom(
            ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
        ),
        { minLength: 43, maxLength: 43 },
    )
    .map((chars) => chars.join(""));
const revision = fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER });
const target = uuid.map((id) => ({ type: "storage_object", id }));

const required = fc
    .record({
        target,
        expectedRevision: revision,
        challengeId: uuid,
        proof,
        expiresAt: fc.date({
            min: new Date("2026-01-01T00:00:00Z"),
            max: new Date("2100-01-01T00:00:00Z"),
            noInvalidDate: true,
        }),
    })
    .map(({ expiresAt, ...rest }) => ({
        kind: "confirmation_required",
        operationKind: "storage.visibility.make_public",
        ...rest,
        expiresAt: expiresAt.toISOString(),
    }));

const changed = fc.record({
    kind: fc.constant("visibility_changed"),
    target,
    visibility: fc.constantFrom("public", "private"),
    revision,
});

const rejected = fc.record({
    kind: fc.constant("rejected"),
    reason: fc.constantFrom(...REJECTION_REASONS),
});

const validResult = fc.oneof(required, changed, rejected);

describe("decodeConfirmableResult", () => {
    test("Feature: storage-visibility-confirmation, Property 15: Contract round trip preserves every valid tagged result (TypeScript binding)", () => {
        fc.assert(
            fc.property(validResult, (wire) => {
                const decoded = decodeConfirmableResult(wire);
                expect(decoded.kind).not.toBe("protocol_error");
                if (decoded.kind === "protocol_error") {
                    return;
                }
                expect(encodeConfirmableResult(decoded)).toEqual(wire);
            }),
            { numRuns: 200 },
        );

        for (const wire of corpus.valid) {
            const decoded = decodeConfirmableResult(wire);
            expect(decoded.kind).not.toBe("protocol_error");
            if (decoded.kind !== "protocol_error") {
                // Timestamps may differ in trailing zeros; compare the instant instead.
                const again = encodeConfirmableResult(decoded) as Record<
                    string,
                    unknown
                >;
                const original = wire as Record<string, unknown>;
                if (typeof original.expiresAt === "string") {
                    expect(Date.parse(again.expiresAt as string)).toBe(
                        Date.parse(original.expiresAt),
                    );
                    delete again.expiresAt;
                    const { expiresAt: _ignored, ...rest } = original;
                    expect(again).toEqual(rest);
                } else {
                    expect(again).toEqual(original);
                }
            }
        }

        for (const bad of corpus.malformed) {
            expect(
                decodeConfirmableResult(bad.value),
                `malformed corpus case "${bad.name}" was accepted`,
            ).toEqual({ kind: "protocol_error" });
        }
    });

    test("every single-step mutation of a valid result is a protocol error", () => {
        const mutation = fc.record({
            wire: validResult,
            action: fc.constantFrom("drop", "add", "retype"),
            pick: fc.nat(),
        });
        fc.assert(
            fc.property(mutation, ({ wire, action, pick }) => {
                const copy: Record<string, unknown> = { ...wire };
                const keys = Object.keys(copy);
                const key = keys[pick % keys.length]!;
                if (action === "drop") {
                    delete copy[key];
                } else if (action === "add") {
                    copy.unexpected = true;
                } else {
                    copy[key] = [copy[key]];
                }
                expect(decodeConfirmableResult(copy)).toEqual({
                    kind: "protocol_error",
                });
            }),
            { numRuns: 300 },
        );
    });

    test("a non-object is a protocol error", () => {
        fc.assert(
            fc.property(
                fc.oneof(
                    fc.string(),
                    fc.integer(),
                    fc.boolean(),
                    fc.constant(null),
                    fc.constant(undefined),
                    fc.array(fc.anything()),
                ),
                (value) => {
                    expect(decodeConfirmableResult(value)).toEqual({
                        kind: "protocol_error",
                    });
                },
            ),
            { numRuns: 100 },
        );
    });
});
