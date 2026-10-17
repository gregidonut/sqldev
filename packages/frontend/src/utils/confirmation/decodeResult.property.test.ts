import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import {
    decodeConfirmableResult,
    encodeConfirmableResult,
} from "./decodeResult";
import { controlsFor } from "./dialogMachine";
import { REJECTION_REASONS } from "./protocol";
import { createRig, flush, openRequest } from "./testRig";

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
    legacy: unknown[];
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

const MIN_ID = BigInt("1000");
const MAX_ID = BigInt("9223372036854775807");
const LIMITS = { title: 200, description: 2000, confirmLabel: 80 } as const;

const registryId = fc
    .oneof(
        fc.bigInt({ min: MIN_ID, max: MAX_ID }),
        fc.constantFrom(MIN_ID, MAX_ID, MIN_ID + BigInt(1), MAX_ID - BigInt(1)),
    )
    .map((id) => id.toString());

// An independent oracle for the shared blank class: the Unicode White_Space property.
const isBlank = (value: string) => /^\p{White_Space}*$/u.test(value);
const codePoints = (value: string) => Array.from(value).length;

const FRAGMENTS = [
    "<b>bold</b>",
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "&amp; &lt; &#x27;",
    "javascript:alert(1)",
    "https://example.test/?a=1&b=2",
    'style="color:red"',
    "{{targetLabel}}",
    "\\ \" ' `",
    "\u{1D518}\u{1F600}",
    "e\u0301",
    "\u202Eabc\u202C",
    "\uFEFF",
    "\u0000",
    " ",
];

// Plain text of at most `max` code points that contains something visible.
const copyText = (max: number) =>
    fc
        .array(
            fc.oneof(
                fc.constantFrom(...FRAGMENTS),
                fc
                    .integer({ min: 0x20, max: 0xd7ff })
                    .map((c) => String.fromCodePoint(c)),
                fc
                    .integer({ min: 0xe000, max: 0x10ffff })
                    .map((c) => String.fromCodePoint(c)),
            ),
            { minLength: 1, maxLength: 12 },
        )
        .map((parts) => Array.from(parts.join("")).slice(0, max).join(""))
        .filter((text) => !isBlank(text));

const dialogCopy = fc.record({
    title: copyText(LIMITS.title),
    description: copyText(LIMITS.description),
    confirmLabel: copyText(LIMITS.confirmLabel),
});

const required = fc
    .record({
        registryId,
        target,
        expectedRevision: revision,
        challengeId: uuid,
        proof,
        dialogCopy,
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
                decodeConfirmableResult(bad.value).kind,
                `malformed corpus case "${bad.name}" was accepted`,
            ).toBe("protocol_error");
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
                expect(decodeConfirmableResult(copy).kind).toBe(
                    "protocol_error",
                );
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
                        scope: "payload",
                    });
                },
            ),
            { numRuns: 100 },
        );
    });
});

type Wire = Record<string, unknown>;

const MALFORMED_COPY = {
    kind: "protocol_error",
    scope: "copy",
    shape: "malformed",
} as const;

/** Applies one mutation at the top level, inside `target`, or inside `dialogCopy`. */
const singleStepMutation = fc.record({
    wire: required,
    where: fc.constantFrom("top", "target", "dialogCopy"),
    action: fc.constantFrom("drop", "add", "retype"),
    pick: fc.nat(),
});

function mutate(wire: Wire, where: string, action: string, pick: number): Wire {
    const clone = structuredClone(wire);
    const holder = where === "top" ? clone : (clone[where] as Wire);
    const keys = Object.keys(holder);
    const key = keys[pick % keys.length]!;
    if (action === "drop") {
        delete holder[key];
    } else if (action === "add") {
        holder.unexpected = "x";
    } else {
        holder[key] = [holder[key]];
    }
    return clone;
}

/** A result that failed decoding must never be able to confirm or invalidate. */
async function expectNothingCanBeConfirmed(wire: unknown) {
    const result = decodeConfirmableResult(wire);
    expect(result.kind).toBe("protocol_error");
    const rig = createRig();
    rig.store.getState().open(openRequest());
    rig.adapter.initiations[0]!.result.resolve(result);
    await flush();
    const state = rig.store.getState().state;
    expect(state.tag).toBe("rejected");
    expect(controlsFor(state).confirm.enabled).toBe(false);
    rig.store.getState().confirm();
    expect(rig.adapter.confirmations).toHaveLength(0);
    expect(rig.adapter.finalSuccesses).toHaveLength(0);
}

function withCopy(field: keyof typeof LIMITS, value: string): Wire {
    const wire = structuredClone(
        fc.sample(required, { numRuns: 1, seed: 7 })[0],
    ) as Wire;
    (wire.dialogCopy as Wire)[field] = value;
    return wire;
}

describe("confirmation_required with authoritative copy", () => {
    test("Feature: confirmation-dialog-copy, Property 3: Contract round trip preserves every valid confirmation-required result", async () => {
        // Valid results round trip exactly, and valid text is returned unchanged.
        fc.assert(
            fc.property(required, (wire) => {
                const decoded = decodeConfirmableResult(wire);
                expect(decoded.kind).toBe("confirmation_required");
                if (decoded.kind !== "confirmation_required") {
                    return;
                }
                expect(String(decoded.registryId)).toBe(wire.registryId);
                expect(decoded.dialogCopy.title).toBe(wire.dialogCopy.title);
                expect(decoded.dialogCopy.description).toBe(
                    wire.dialogCopy.description,
                );
                expect(decoded.dialogCopy.confirmLabel).toBe(
                    wire.dialogCopy.confirmLabel,
                );
                expect(encodeConfirmableResult(decoded)).toEqual(wire);
            }),
            { numRuns: 200 },
        );

        // Every single-step mutation fails before anything can be confirmed.
        await fc.assert(
            fc.asyncProperty(
                singleStepMutation,
                async ({ wire, where, action, pick }) => {
                    await expectNothingCanBeConfirmed(
                        mutate(wire, where, action, pick),
                    );
                },
            ),
            { numRuns: 150 },
        );

        // Out-of-range and non-canonical identifiers.
        const badIds = fc.oneof(
            fc.bigInt({ min: BigInt(0), max: BigInt(999) }).map(String),
            fc
                .bigInt({
                    min: MAX_ID + BigInt(1),
                    max: MAX_ID * BigInt(100),
                })
                .map(String),
            fc.bigInt({ min: BigInt(-99999), max: BigInt(-1) }).map(String),
            registryId.map((id) => `0${id}`),
            registryId.map((id) => `+${id}`),
            registryId.map((id) => ` ${id}`),
            registryId.map((id) => `${id} `),
            registryId.map((id) => `${id}.0`),
            registryId.map((id) => `${id}n`),
            fc.constantFrom("", "1e3", "0x3e8", "1_000", "１０００"),
        );
        await fc.assert(
            fc.asyncProperty(required, badIds, async (wire, id) => {
                await expectNothingCanBeConfirmed({ ...wire, registryId: id });
            }),
            { numRuns: 100 },
        );
        for (const id of [1000, 1e3, 9007199254740993, null, true]) {
            expect(
                decodeConfirmableResult({
                    ...fc.sample(required, { numRuns: 1, seed: 3 })[0],
                    registryId: id,
                }),
            ).toEqual(MALFORMED_COPY);
        }

        // Blank, over-length, and unpaired-surrogate copy.
        const blank = fc
            .array(
                fc.constantFrom(
                    ..."\t\n\v\f\r \u0085\u00A0\u1680\u2000\u200A\u2028\u2029\u202F\u205F\u3000",
                ),
                { minLength: 1, maxLength: 20 },
            )
            .map((chars) => chars.join(""));
        const field = fc.constantFrom(
            ...(Object.keys(LIMITS) as (keyof typeof LIMITS)[]),
        );
        await fc.assert(
            fc.asyncProperty(field, blank, async (name, text) => {
                await expectNothingCanBeConfirmed(withCopy(name, text));
            }),
            { numRuns: 60 },
        );
        await fc.assert(
            fc.asyncProperty(field, async (name) => {
                const max = LIMITS[name];
                // The bound counts code points: an astral character counts once.
                const atLimit = "\u{1D518}".repeat(max);
                expect(codePoints(atLimit)).toBe(max);
                expect(
                    decodeConfirmableResult(withCopy(name, atLimit)).kind,
                ).toBe("confirmation_required");
                await expectNothingCanBeConfirmed(
                    withCopy(name, "\u{1D518}".repeat(max + 1)),
                );
            }),
            { numRuns: 15 },
        );
        const lone = fc.constantFrom("\uD800", "\uDBFF", "\uDC00", "\uDFFF");
        await fc.assert(
            fc.asyncProperty(
                field,
                lone,
                copyText(10),
                async (name, bad, ok) => {
                    await expectNothingCanBeConfirmed(
                        withCopy(name, `${ok}${bad}`),
                    );
                    await expectNothingCanBeConfirmed(
                        withCopy(name, `${bad}${ok}`),
                    );
                },
            ),
            { numRuns: 40 },
        );

        // The shared Go/TypeScript corpus.
        expect(corpus.valid.length).toBeGreaterThan(0);
        for (const wire of corpus.valid) {
            const decoded = decodeConfirmableResult(wire);
            expect(decoded.kind).not.toBe("protocol_error");
            if (decoded.kind !== "confirmation_required") {
                continue;
            }
            const again = encodeConfirmableResult(decoded) as Wire;
            const original = wire as Wire;
            expect(Date.parse(again.expiresAt as string)).toBe(
                Date.parse(original.expiresAt as string),
            );
            const { expiresAt: _a, ...encodedRest } = again;
            const { expiresAt: _b, ...originalRest } = original;
            expect(encodedRest).toEqual(originalRest);
        }
        expect(corpus.legacy.length).toBeGreaterThan(0);
        for (const [index, legacy] of corpus.legacy.entries()) {
            expect(
                decodeConfirmableResult(legacy),
                `legacy corpus case ${index}`,
            ).toEqual({
                kind: "protocol_error",
                scope: "copy",
                shape: "legacy",
            });
        }
        for (const bad of corpus.malformed) {
            expect(
                decodeConfirmableResult(bad.value).kind,
                `malformed corpus case "${bad.name}" was accepted`,
            ).toBe("protocol_error");
        }
    });

    test("a seven-key legacy result and a nine-key mutation are told apart", () => {
        const wire = fc.sample(required, { numRuns: 1, seed: 11 })[0] as Wire;
        const { registryId: _id, dialogCopy: _copy, ...legacy } = wire;
        expect(decodeConfirmableResult(legacy)).toEqual({
            kind: "protocol_error",
            scope: "copy",
            shape: "legacy",
        });
        expect(decodeConfirmableResult({ ...legacy, proof: "short" })).toEqual(
            MALFORMED_COPY,
        );
        expect(
            decodeConfirmableResult({ ...legacy, registryId: "1000" }),
        ).toEqual(MALFORMED_COPY);
        expect(decodeConfirmableResult({ kind: "deleted" })).toEqual({
            kind: "protocol_error",
            scope: "payload",
        });
    });
});
