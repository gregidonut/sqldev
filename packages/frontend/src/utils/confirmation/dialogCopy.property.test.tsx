import { afterEach, describe, expect, test } from "bun:test";
import React, { act } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import fc from "fast-check";
import { ConfirmationDialogHost } from "@/pages/drive/[driveTab]/_components/react/RACCRUDTable/confirmation/ConfirmationDialogHost";
import { decodeConfirmableResult } from "./decodeResult";
import {
    controlsFor,
    presentationFor,
    statusText,
    transition,
} from "./dialogMachine";
import {
    asIdempotencyKey,
    asOperationToken,
    type ConfirmationRequired,
    type DialogEvent,
    type DialogState,
    type DialogSubject,
} from "./protocol";
import {
    OBJECT_ID,
    REVISION,
    START,
    challenge,
    changed,
    createRig,
    flush,
    openRequest,
    type Rig,
} from "./testRig";

afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const MIN_ID = BigInt("1000");
const MAX_ID = BigInt("9223372036854775807");
const LIMITS = { title: 200, description: 2000, confirmLabel: 80 } as const;
const PROOF = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCde";

/** Markup-, script-, URL-, style-, handler-, combining-, astral- and RTL-like text. */
const FRAGMENTS = [
    "plain words",
    "<b>bold</b>",
    "<script>window.__pwned = 1</script>",
    '<img src=x onerror="window.__pwned = 2">',
    '<a href="https://example.test/">link</a>',
    "<style>body{display:none}</style>",
    'style="color:red" onclick="x()"',
    "&amp; &lt; &#x27; &nbsp;",
    "javascript:window.__pwned = 3",
    "https://example.test/?a=1&b=2",
    "{{targetLabel}}",
    "\\ \" ' `",
    "\u{1D518}\u{1F600}",
    "e\u0301",
    "\u202Eexe.pdf\u202C",
    "\uFEFF",
    " leading and trailing ",
    "line\nbreak",
];

const isBlank = (value: string) => /^\p{White_Space}*$/u.test(value);

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
            { minLength: 1, maxLength: 8 },
        )
        .map((parts) => Array.from(parts.join("")).slice(0, max).join(""))
        .filter((text) => !isBlank(text));

const dialogCopy = fc.record({
    title: copyText(LIMITS.title),
    description: copyText(LIMITS.description),
    confirmLabel: copyText(LIMITS.confirmLabel),
});

const registryId = fc
    .oneof(
        fc.bigInt({ min: MIN_ID, max: MAX_ID }),
        fc.constantFrom(MIN_ID, MAX_ID),
    )
    .map((id) => id.toString());

type Wire = Record<string, unknown> & {
    target: Record<string, unknown>;
    dialogCopy: Record<string, unknown>;
};

/** A valid current result for the subject the tests open (same target and revision). */
const currentWire = fc
    .record({
        registryId,
        challengeId: fc.uuid(),
        dialogCopy,
    })
    .map((parts): Wire => ({
        kind: "confirmation_required",
        registryId: parts.registryId,
        operationKind: "storage.visibility.make_public",
        target: { type: "storage_object", id: OBJECT_ID },
        expectedRevision: REVISION,
        challengeId: parts.challengeId,
        proof: PROOF,
        expiresAt: new Date(START + 5 * 60_000).toISOString(),
        dialogCopy: parts.dialogCopy,
    }));

function clone(wire: Wire): Wire {
    return structuredClone(wire);
}

type Mutation = readonly [
    name: string,
    apply: (wire: Wire) => Record<string, unknown>,
];

const TOP_KEYS = [
    "registryId",
    "operationKind",
    "target",
    "expectedRevision",
    "challengeId",
    "proof",
    "expiresAt",
    "dialogCopy",
] as const;

function setCopy(field: string, value: unknown): Mutation[1] {
    return (wire: Wire) => {
        const next = clone(wire);
        next.dialogCopy[field] = value;
        return next;
    };
}

/** Every mutation turns a valid current result into one the decoder must refuse. */
const MUTATIONS: readonly Mutation[] = [
    ...TOP_KEYS.map((key): Mutation => [
        `drop ${key}`,
        (wire) => {
            const next = clone(wire);
            delete next[key];
            return next;
        },
    ]),
    ...(["type", "id"] as const).map((key): Mutation => [
        `drop target.${key}`,
        (wire) => {
            const next = clone(wire);
            delete next.target[key];
            return next;
        },
    ]),
    ...(["title", "description", "confirmLabel"] as const).map(
        (key): Mutation => [
            `drop dialogCopy.${key}`,
            (wire) => {
                const next = clone(wire);
                delete next.dialogCopy[key];
                return next;
            },
        ],
    ),
    [
        "extra top-level key",
        (wire) => ({ ...clone(wire), dialog_title_template: "x" }),
    ],
    [
        "extra target key",
        (wire) => {
            const next = clone(wire);
            next.target.label = "x";
            return next;
        },
    ],
    [
        "extra dialogCopy key",
        (wire) => {
            const next = clone(wire);
            next.dialogCopy.html = "<b>x</b>";
            return next;
        },
    ],
    [
        "legacy seven-key shape",
        (wire) => {
            const next = clone(wire);
            delete next.registryId;
            delete (next as Record<string, unknown>).dialogCopy;
            return next;
        },
    ],
    ["registryId as number", (wire) => ({ ...wire, registryId: 1000 })],
    ["registryId null", (wire) => ({ ...wire, registryId: null })],
    ...[
        "999",
        "9223372036854775808",
        "-1000",
        "+1000",
        "01000",
        " 1000",
        "1000 ",
        "1000.0",
        "1e3",
        "",
        "abcd",
    ].map((value): Mutation => [
        `registryId ${JSON.stringify(value)}`,
        (wire) => ({ ...wire, registryId: value }),
    ]),
    ["dialogCopy string", (wire) => ({ ...wire, dialogCopy: "text" })],
    ["dialogCopy null", (wire) => ({ ...wire, dialogCopy: null })],
    ["dialogCopy array", (wire) => ({ ...wire, dialogCopy: [] })],
    ["title number", setCopy("title", 7)],
    ...(["title", "description", "confirmLabel"] as const).flatMap(
        (field): Mutation[] => [
            [`${field} null`, setCopy(field, null)],
            [`${field} array`, setCopy(field, ["a"])],
            ...["", " ", "\u00A0", "\u0085", "\u2003", "\u3000", "\t\n"].map(
                (value): Mutation => [
                    `${field} blank ${JSON.stringify(value)}`,
                    setCopy(field, value),
                ],
            ),
            [
                `${field} over length`,
                setCopy(field, "\u{1F600}".repeat(LIMITS[field] + 1)),
            ],
            [`${field} lone surrogate`, setCopy(field, "a\ud800b")],
        ],
    ),
];

const badWire = fc
    .tuple(currentWire, fc.constantFrom(...MUTATIONS))
    .map(([wire, [name, apply]]) => ({ name, wire: apply(wire) }));

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const ALLOWED_TAGS = new Set([
    "SECTION",
    "DIV",
    "H1",
    "H2",
    "H3",
    "H4",
    "P",
    "BUTTON",
]);

function dialogs(): HTMLElement[] {
    return Array.from(
        document.body.querySelectorAll<HTMLElement>('[role="alertdialog"]'),
    );
}

function onlyDialog(): HTMLElement {
    const open = dialogs();
    expect(open).toHaveLength(1);
    return open[0]!;
}

function buttonsOf(root: HTMLElement): HTMLButtonElement[] {
    return Array.from(root.querySelectorAll<HTMLButtonElement>("button"));
}

function nameOf(root: HTMLElement): string {
    const ids = (root.getAttribute("aria-labelledby") ?? "").split(/\s+/);
    expect(ids).toHaveLength(1);
    return document.getElementById(ids[0]!)?.textContent ?? "";
}

function descriptionOf(root: HTMLElement): string | null {
    const attribute = root.getAttribute("aria-describedby");
    if (attribute === null) return null;
    const ids = attribute.split(/\s+/);
    expect(ids).toHaveLength(1);
    return document.getElementById(ids[0]!)?.textContent ?? null;
}

/** No element, tag or attribute in the dialog came from interpreting copy. */
function expectNoInterpretedNodes(root: HTMLElement, fields: string[]) {
    for (const element of [
        root,
        ...Array.from(root.querySelectorAll<HTMLElement>("*")),
    ]) {
        expect(ALLOWED_TAGS.has(element.tagName), element.tagName).toBe(true);
        for (const attribute of Array.from(element.attributes)) {
            expect(attribute.name.startsWith("on"), attribute.name).toBe(false);
            expect(["href", "src", "srcdoc", "style"]).not.toContain(
                attribute.name,
            );
            expect(fields).not.toContain(attribute.value);
        }
    }
}

async function settle() {
    await act(async () => {
        await flush();
    });
}

async function resolveInitiation(rig: Rig, index: number, result: unknown) {
    await act(async () => {
        rig.adapter.initiations[index]!.result.resolve(
            result as Parameters<
                (typeof rig.adapter.initiations)[number]["result"]["resolve"]
            >[0],
        );
        await flush();
    });
}

function mountOpen(rig: Rig) {
    render(<ConfirmationDialogHost store={rig.store} />);
    act(() => {
        rig.store.getState().open(openRequest());
    });
}

function decodeCurrent(wire: unknown): ConfirmationRequired {
    const decoded = decodeConfirmableResult(wire);
    if (decoded.kind !== "confirmation_required") {
        throw new Error(`expected a current result, got ${decoded.kind}`);
    }
    return decoded;
}

// ---------------------------------------------------------------------------
// Property 4
// ---------------------------------------------------------------------------

const subject: DialogSubject = {
    token: asOperationToken("token-1"),
    operationKind: "storage.visibility.make_public",
    target: { type: "storage_object", id: OBJECT_ID },
    expectedRevision: REVISION,
    focus: { origin: null, rowKey: "row-1" },
};

/** Every event type, built for the fallback's current token. */
function eventsFor(token: DialogSubject["token"]): DialogEvent[] {
    return [
        { type: "CONFIRM", token },
        { type: "REFRESH", token },
        { type: "INITIATION_FAILED", token },
        { type: "CONFIRM_FAILED", token },
        {
            type: "CHALLENGE_EXPIRED",
            token,
            challengeId: challenge().challengeId,
        },
        { type: "INITIATION_RESOLVED", token, result: challenge() },
        { type: "CONFIRM_RESOLVED", token, result: changed() },
        {
            type: "INITIATION_RESOLVED",
            token,
            result: { kind: "protocol_error", scope: "payload" },
        },
        { type: "OPEN", subject },
    ];
}

async function checkRenderedCopy(wire: Wire) {
    const copy = wire.dialogCopy as {
        title: string;
        description: string;
        confirmLabel: string;
    };
    const current = decodeCurrent(wire);
    expect(current.dialogCopy).toEqual(copy);

    // The pure model first.
    const ready: DialogState = {
        tag: "confirmation-ready",
        subject,
        challenge: current,
    };
    expect(presentationFor(ready)).toEqual(copy);
    expect(controlsFor(ready).confirm).toEqual({
        visible: true,
        enabled: true,
    });

    // Then the host.
    const rig = createRig();
    mountOpen(rig);
    await settle();
    (window as unknown as { __pwned?: number }).__pwned = 0;
    await resolveInitiation(rig, 0, current);

    const root = onlyDialog();
    expect(rig.store.getState().state.tag).toBe("confirmation-ready");
    expect(nameOf(root)).toBe(copy.title);
    expect(descriptionOf(root)).toBe(copy.description);

    const enabled = buttonsOf(root).filter((b) => !b.disabled);
    const primary = enabled.filter(
        (b) => !b.hasAttribute("data-confirm-cancel"),
    );
    expect(primary).toHaveLength(1);
    expect(primary[0]!.textContent).toBe(copy.confirmLabel);
    expect(enabled.map((b) => b.textContent)).toContain("Cancel");

    expectNoInterpretedNodes(root, [
        copy.title,
        copy.description,
        copy.confirmLabel,
    ]);
    expect((window as unknown as { __pwned?: number }).__pwned).toBe(0);
    cleanup();
}

async function checkRefreshReplacesCopy(
    first: Wire,
    second: Wire,
    resolveWhile: "refreshing" | "expired",
) {
    const before = first.dialogCopy as { title: string; confirmLabel: string };
    const after = second.dialogCopy as {
        title: string;
        description: string;
        confirmLabel: string;
    };
    const rig = createRig();
    mountOpen(rig);
    await settle();
    await resolveInitiation(rig, 0, decodeCurrent(first));
    act(() => rig.clock.advance(5 * 60_000 + 1_000));
    await settle();
    expect(rig.store.getState().state.tag).toBe("expired");
    expect(nameOf(onlyDialog())).toBe(before.title);

    if (resolveWhile === "expired") {
        // A result nobody asked for cannot replace anything while merely expired.
        await resolveInitiation(rig, 0, decodeCurrent(second));
        expect(rig.store.getState().state.tag).toBe("expired");
        expect(nameOf(onlyDialog())).toBe(before.title);
        cleanup();
        return;
    }

    act(() => rig.store.getState().refresh());
    await settle();
    const refreshing = rig.store.getState().state;
    expect(refreshing.tag).toBe("refreshing");
    // Until the refreshed result arrives the old copy stays and nothing is confirmable.
    expect(nameOf(onlyDialog())).toBe(before.title);
    const stillOld = buttonsOf(onlyDialog()).filter(
        (b) => !b.hasAttribute("data-confirm-cancel"),
    );
    expect(
        stillOld.every(
            (b) => b.disabled || b.getAttribute("aria-disabled") === "true",
        ),
    ).toBe(true);

    const next = decodeCurrent(second);
    await resolveInitiation(rig, 1, next);
    const state = rig.store.getState().state;
    expect(state.tag).toBe("confirmation-ready");
    if (state.tag === "confirmation-ready") {
        // Identity and copy are replaced together, as one value.
        expect(state.challenge).toBe(next);
        expect(state.challenge.registryId).toBe(second.registryId as never);
    }
    const root = onlyDialog();
    expect(nameOf(root)).toBe(after.title);
    expect(descriptionOf(root)).toBe(after.description);
    const primary = buttonsOf(root).filter(
        (b) => !b.hasAttribute("data-confirm-cancel") && !b.disabled,
    );
    expect(primary.map((b) => b.textContent)).toEqual([after.confirmLabel]);
    cleanup();
}

function checkFallbackFold(error: DialogState, eventsSeed: number[]) {
    if (error.tag !== "rejected") throw new Error("not rejected");
    const events = eventsFor(subject.token);
    const control = controlsFor(error);
    expect(control.confirm.visible).toBe(false);
    expect(control.refresh.visible).toBe(false);
    expect(control.freshInitiation.enabled).toBe(true);
    for (const seed of eventsSeed) {
        const event = events[seed % events.length]!;
        let n = 0;
        const result = transition(error, event, () =>
            asIdempotencyKey(`k-${++n}`),
        );
        // None of these changes anything or starts any request.
        expect(result.state).toBe(error);
        expect(result.effects).toEqual([]);
    }
    expect(
        transition(error, { type: "CLOSE", token: subject.token }, () =>
            asIdempotencyKey("k"),
        ).state.tag,
    ).toBe("closed");
    const fresh = transition(
        error,
        { type: "FRESH_INITIATION", token: subject.token },
        () => asIdempotencyKey("fresh"),
    );
    expect(fresh.state.tag).toBe("requesting");
    expect(fresh.effects).toEqual([
        {
            type: "submitInitiation",
            token: subject.token,
            key: asIdempotencyKey("fresh"),
        },
    ]);
}

async function checkFallbackRendering(
    bad: { name: string; wire: Record<string, unknown> },
    freshCount: number,
    finalWire: Wire,
) {
    const decoded = decodeConfirmableResult(bad.wire);
    expect(decoded.kind, bad.name).toBe("protocol_error");
    if (decoded.kind !== "protocol_error") return;
    expect(decoded.scope, bad.name).toBe("copy");

    const rig = createRig();
    mountOpen(rig);
    await settle();
    await resolveInitiation(rig, 0, decoded);

    const state = rig.store.getState().state;
    expect(state.tag).toBe("rejected");
    if (state.tag !== "rejected") return;
    expect(state.mode).toBe("safe-copy-fallback");
    checkFallbackFold(state, [0, 1, 2, 3, 4, 5, 6, 7, 8]);

    for (let round = 1; round <= freshCount; round += 1) {
        const root = onlyDialog();
        // Only fixed generic text: nothing from the bad result reaches the DOM.
        expect(nameOf(root)).toBe("Confirmation details unavailable");
        expect(descriptionOf(root)).toBeNull();
        expect(root.querySelector('[role="status"]')?.textContent).toBe(
            statusText(rig.store.getState().state) ?? undefined,
        );
        expect(
            buttonsOf(root).map((b) => [b.textContent, b.disabled] as const),
        ).toEqual([
            ["Close", false],
            ["Get new confirmation", false],
        ]);
        expectNoInterpretedNodes(root, []);
        for (const piece of [PROOF, String(bad.wire.challengeId ?? "")]) {
            if (piece !== "") expect(root.textContent).not.toContain(piece);
        }

        const fresh = buttonsOf(root).find(
            (b) => b.textContent === "Get new confirmation",
        )!;
        act(() => {
            fireEvent.click(fresh);
        });
        await settle();
        expect(rig.adapter.initiations).toHaveLength(round + 1);
        expect(rig.adapter.confirmations).toHaveLength(0);
        // While the new request is in flight there is nothing to confirm.
        expect(buttonsOf(onlyDialog()).map((b) => b.textContent)).toEqual([
            "Cancel",
        ]);
        if (round < freshCount) {
            await resolveInitiation(rig, round, decoded);
            expect(rig.store.getState().state.tag).toBe("rejected");
        }
    }

    const keys = rig.adapter.initiations.map((call) => call.key);
    expect(new Set(keys).size).toBe(keys.length);

    // Only a strictly validated current result can enable confirmation.
    await resolveInitiation(rig, freshCount, decodeCurrent(finalWire));
    expect(rig.store.getState().state.tag).toBe("confirmation-ready");
    const root = onlyDialog();
    const finalCopy = finalWire.dialogCopy as { confirmLabel: string };
    expect(
        buttonsOf(root)
            .filter(
                (b) => !b.disabled && !b.hasAttribute("data-confirm-cancel"),
            )
            .map((b) => b.textContent),
    ).toEqual([finalCopy.confirmLabel]);
    expect(rig.adapter.confirmations).toHaveLength(0);
    cleanup();
}

describe("dialog copy rendering", () => {
    test("Feature: confirmation-dialog-copy, Property 4: Dialog copy is rendered safely and degrades to a valid fallback state", async () => {
        // Valid copy, including markup-, script-, URL-, style- and handler-like text.
        await fc.assert(
            fc.asyncProperty(currentWire, async (wire) => {
                await checkRenderedCopy(wire);
            }),
            { numRuns: 100 },
        );

        // A refreshed valid result replaces identity and copy before confirmation-ready.
        await fc.assert(
            fc.asyncProperty(
                currentWire,
                currentWire,
                fc.constantFrom<"refreshing" | "expired">(
                    "refreshing",
                    "expired",
                ),
                async (first, second, resolveWhile) => {
                    await checkRefreshReplacesCopy(first, second, resolveWhile);
                },
            ),
            { numRuns: 100 },
        );

        // Missing, extra, wrong-type, out-of-range and legacy results degrade safely.
        await fc.assert(
            fc.asyncProperty(
                badWire,
                fc.integer({ min: 1, max: 3 }),
                currentWire,
                async (bad, freshCount, finalWire) => {
                    await checkFallbackRendering(bad, freshCount, finalWire);
                },
            ),
            { numRuns: 120 },
        );
    }, 240_000);

    test("every mutation in the generator really is refused by the decoder", () => {
        fc.assert(
            fc.property(badWire, ({ name, wire }) => {
                const decoded = decodeConfirmableResult(wire);
                expect(decoded.kind, name).toBe("protocol_error");
            }),
            { numRuns: 200 },
        );
    });
});
