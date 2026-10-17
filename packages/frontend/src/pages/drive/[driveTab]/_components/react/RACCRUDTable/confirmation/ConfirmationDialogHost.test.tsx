import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import React, { act } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ConfirmationDialogHost } from "./ConfirmationDialogHost";
import {
    challenge,
    changed,
    createRig,
    flush,
    openRequest,
    type Rig,
} from "@/utils/confirmation/testRig";

afterEach(() => cleanup());

/** Resolves once pending effects and React updates have settled. */
async function settle() {
    await act(async () => {
        await flush();
    });
}

function mount(rig: Rig) {
    return render(<ConfirmationDialogHost store={rig.store} />);
}

function dialog(): HTMLElement | null {
    return document.body.querySelector<HTMLElement>('[role="alertdialog"]');
}

function button(name: string): HTMLButtonElement | null {
    const buttons = Array.from(
        dialog()?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    return buttons.find((b) => b.textContent?.trim() === name) ?? null;
}

async function openToReady(rig: Rig, over = {}) {
    act(() => {
        rig.store.getState().open(openRequest());
    });
    await settle();
    act(() => rig.adapter.initiations[0]!.result.resolve(challenge(over)));
    await settle();
}

describe("ConfirmationDialogHost", () => {
    test("renders nothing while closed", () => {
        const rig = createRig();
        mount(rig);
        expect(dialog()).toBeNull();
    });

    test("requesting is a busy alertdialog with generic text and no confirm button", async () => {
        const rig = createRig();
        mount(rig);
        act(() => {
            rig.store.getState().open(openRequest());
        });
        await settle();

        const root = dialog();
        expect(root).not.toBeNull();
        expect(root!.getAttribute("aria-busy")).toBe("true");

        const labelledBy = root!.getAttribute("aria-labelledby");
        expect(labelledBy).toBeTruthy();
        expect(document.getElementById(labelledBy!)?.textContent).toBe(
            "Confirmation",
        );
        // No authoritative description exists yet, so nothing is referenced.
        expect(root!.hasAttribute("aria-describedby")).toBe(false);
        expect(root!.querySelectorAll("p").length).toBe(1);

        expect(button("Make public")).toBeNull();
        expect(button("Cancel")?.disabled).toBe(false);
        expect(button("Refresh confirmation")).toBeNull();
        expect(button("Get new confirmation")).toBeNull();
        expect(root!.querySelector('[role="status"]')?.textContent).toBe(
            "Preparing confirmation…",
        );
    });

    test("shows the registry id PostgreSQL returned once a validated result exists, and not before", async () => {
        const rig = createRig();
        mount(rig);
        act(() => {
            rig.store.getState().open(openRequest());
        });
        await settle();
        const idLine = () =>
            dialog()!.querySelector<HTMLElement>("p.text-xs") ?? null;
        // Nothing validated yet: no id is shown.
        expect(idLine()).toBeNull();

        await act(async () => {
            rig.adapter.initiations[0]!.result.resolve(challenge());
            await flush();
        });
        await settle();
        expect(idLine()?.textContent).toBe("Operation ID: 1000");
        // It is plain text beside the message, not part of the description.
        const describedBy = dialog()!.getAttribute("aria-describedby");
        expect(
            document.getElementById(describedBy!)?.textContent,
        ).not.toContain("1000");
    });

    test("when ready: Make public is enabled, Cancel is focused first, not busy", async () => {
        const rig = createRig();
        mount(rig);
        await openToReady(rig);

        expect(dialog()!.getAttribute("aria-busy")).toBe("false");
        expect(button("Make public")?.disabled).toBe(false);
        expect(document.activeElement).toBe(button("Cancel"));
    });

    test("confirming disables dismissal and shows a pending Make public", async () => {
        const rig = createRig();
        mount(rig);
        await openToReady(rig);
        act(() => fireEvent.click(button("Make public")!));
        await settle();

        expect(rig.store.getState().state.tag).toBe("confirming");
        expect(dialog()!.getAttribute("aria-busy")).toBe("true");
        expect(button("Cancel")?.disabled).toBe(true);
        // Escape must not close a dialog whose job is already submitted.
        act(() => {
            fireEvent.keyDown(dialog()!, { key: "Escape" });
        });
        await settle();
        expect(rig.store.getState().state.tag).toBe("confirming");

        act(() => rig.adapter.confirmations[0]!.result.resolve(changed()));
        await settle();
        expect(rig.store.getState().state.tag).toBe("closed");
        expect(rig.adapter.finalSuccesses).toHaveLength(1);
    });

    test("expiry keeps the dialog open: Make public disabled, Refresh enabled, no countdown", async () => {
        const rig = createRig();
        mount(rig);
        await openToReady(rig, { expiresInMs: 90_000 });

        act(() => rig.clock.advance(90_000));
        await settle();

        expect(dialog()).not.toBeNull();
        expect(rig.store.getState().state.tag).toBe("expired");
        expect(button("Make public")?.disabled).toBe(true);
        expect(button("Refresh confirmation")?.disabled).toBe(false);
        const text = dialog()!.textContent ?? "";
        expect(text).toContain("expired");
        expect(text).not.toMatch(
            /\b\d+\s*(seconds?|secs?|minutes?|mins?|ms)\b|remaining|countdown|time left|expires in/i,
        );
    });

    test("Refresh confirmation requests a new challenge in place", async () => {
        const rig = createRig();
        mount(rig);
        await openToReady(rig, { expiresInMs: 1_000 });
        act(() => rig.clock.advance(1_000));
        await settle();

        act(() => fireEvent.click(button("Refresh confirmation")!));
        await settle();
        expect(rig.store.getState().state.tag).toBe("refreshing");
        expect(dialog()!.getAttribute("aria-busy")).toBe("true");

        act(() => rig.adapter.initiations[1]!.result.resolve(challenge()));
        await settle();
        expect(rig.store.getState().state.tag).toBe("confirmation-ready");
        expect(button("Make public")?.disabled).toBe(false);
        expect(button("Refresh confirmation")).toBeNull();
    });

    test("Cancel closes without submitting a confirmation", async () => {
        const rig = createRig();
        mount(rig);
        await openToReady(rig);
        act(() => fireEvent.click(button("Cancel")!));
        await settle();
        expect(rig.store.getState().state.tag).toBe("closed");
        expect(rig.adapter.confirmations).toHaveLength(0);
        expect(rig.focusRestored).toHaveLength(1);
    });

    test("never writes a challenge to browser storage", async () => {
        const local = spyOn(Storage.prototype, "setItem");
        const rig = createRig();
        mount(rig);
        await openToReady(rig);
        act(() => fireEvent.click(button("Make public")!));
        await settle();
        act(() => rig.adapter.confirmations[0]!.result.resolve(changed()));
        await settle();
        expect(local).not.toHaveBeenCalled();
        local.mockRestore();
    });

    test("a protocol error shows a Close button and never a Make public", async () => {
        const rig = createRig();
        mount(rig);
        act(() => {
            rig.store.getState().open(openRequest());
        });
        await settle();
        act(() =>
            rig.adapter.initiations[0]!.result.resolve({
                kind: "protocol_error",
                scope: "payload",
            }),
        );
        await settle();
        expect(button("Make public")).toBeNull();
        expect(button("Close")).not.toBeNull();
        expect(
            dialog()!.querySelector('[role="status"]')?.textContent,
        ).toContain("unexpected response");
    });
});

const LEGACY = {
    kind: "protocol_error",
    scope: "copy",
    shape: "legacy",
} as const;

/** Copy that would do something if it were ever interpreted as HTML, a URL or CSS. */
const HOSTILE_COPY = [
    {
        title: "<script>window.__pwned = 1</script>",
        description: '<img src=x onerror="window.__pwned = 2">',
        confirmLabel: "<b>Make public</b>",
    },
    {
        title: '<a href="https://example.com">Make public</a>',
        description: "javascript:window.__pwned = 3",
        confirmLabel: "https://example.com/go",
    },
    {
        title: "<style>body{display:none}</style>",
        description: 'style="color:red" onclick="x()"',
        confirmLabel: "&amp; &lt;b&gt; {{targetLabel}}",
    },
    {
        title: "Make “\u202Eexe.pdf\u202C” 📄 e\u0301 public?",
        description: "  leading and trailing  \n  newline kept as text  ",
        confirmLabel: "Go ✔",
    },
] as const;

function allElements(root: HTMLElement): HTMLElement[] {
    return [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];
}

describe("ConfirmationDialogHost: authoritative copy", () => {
    test("exposes exactly one name and one description equal to the copy", async () => {
        const rig = createRig();
        mount(rig);
        await openToReady(rig);
        const copy = challenge().dialogCopy;
        const root = dialog()!;

        const labelledBy = root.getAttribute("aria-labelledby");
        expect(labelledBy).toBeTruthy();
        expect(labelledBy!.trim().split(/\s+/)).toHaveLength(1);
        expect(document.getElementById(labelledBy!)?.textContent).toBe(
            copy.title,
        );
        expect(
            root.querySelectorAll("h1,h2,h3,h4,[role='heading']"),
        ).toHaveLength(1);

        const describedBy = root.getAttribute("aria-describedby");
        expect(describedBy).toBeTruthy();
        expect(describedBy!.trim().split(/\s+/)).toHaveLength(1);
        expect(document.getElementById(describedBy!)?.textContent).toBe(
            copy.description,
        );

        const enabled = Array.from(
            root.querySelectorAll<HTMLButtonElement>("button"),
        ).filter((b) => !b.disabled);
        expect(enabled.map((b) => b.textContent)).toEqual([
            "Cancel",
            copy.confirmLabel,
        ]);
    });

    test("takes its text from the result, not from the adapter or the host", async () => {
        const rig = createRig();
        mount(rig);
        await openToReady(rig, {
            dialogCopy: {
                title: "Some other title",
                description: "Some other description",
                confirmLabel: "Proceed",
            },
        });
        const root = dialog()!;
        expect(root.textContent).toContain("Some other title");
        expect(root.textContent).toContain("Some other description");
        expect(root.textContent).not.toContain("report.pdf");
        expect(button("Proceed")?.disabled).toBe(false);
        expect(button("Make public")).toBeNull();
    });

    for (const [index, copy] of HOSTILE_COPY.entries()) {
        test(`renders hostile copy #${index + 1} as literal text only`, async () => {
            const rig = createRig();
            mount(rig);
            (window as unknown as { __pwned?: number }).__pwned = 0;
            await openToReady(rig, { dialogCopy: copy });
            const root = dialog()!;

            const name = document.getElementById(
                root.getAttribute("aria-labelledby")!,
            )!;
            const description = document.getElementById(
                root.getAttribute("aria-describedby")!,
            )!;
            const primary = button(copy.confirmLabel)!;

            for (const [element, text] of [
                [name, copy.title],
                [description, copy.description],
                [primary, copy.confirmLabel],
            ] as const) {
                expect(element.textContent).toBe(text);
                // The copy never becomes elements.
                expect(element.children).toHaveLength(0);
            }

            // Nothing the copy contains became markup, a link, a style or a handler.
            for (const element of allElements(root)) {
                expect(["SCRIPT", "STYLE", "A", "IMG", "IFRAME"]).not.toContain(
                    element.tagName,
                );
                for (const attribute of Array.from(element.attributes)) {
                    expect(attribute.name.startsWith("on")).toBe(false);
                    expect(["href", "src", "style", "srcdoc"]).not.toContain(
                        attribute.name,
                    );
                    for (const field of Object.values(copy)) {
                        expect(attribute.value).not.toBe(field);
                    }
                }
            }
            expect((window as unknown as { __pwned?: number }).__pwned).toBe(0);
        });
    }

    test("no countdown or remaining-time text in any state", async () => {
        const rig = createRig();
        mount(rig);
        await openToReady(rig, { expiresInMs: 61_000 });
        const pattern =
            /\b\d+\s*(seconds?|secs?|minutes?|mins?|ms)\b|remaining|countdown|time left|expires in/i;
        expect(dialog()!.textContent).not.toMatch(pattern);
        act(() => rig.clock.advance(61_000));
        await settle();
        expect(dialog()!.textContent).not.toMatch(pattern);
    });

    test("expired and refreshing keep the prior copy visible with confirm disabled", async () => {
        const rig = createRig();
        mount(rig);
        await openToReady(rig, { expiresInMs: 1_000 });
        const first = challenge().dialogCopy;
        act(() => rig.clock.advance(1_000));
        await settle();
        expect(dialog()!.textContent).toContain(first.title);
        expect(button(first.confirmLabel)?.disabled).toBe(true);

        act(() => fireEvent.click(button("Refresh confirmation")!));
        await settle();
        expect(dialog()!.getAttribute("aria-busy")).toBe("true");
        expect(dialog()!.textContent).toContain(first.title);
        expect(button(first.confirmLabel)?.disabled).toBe(true);

        const next = {
            title: "Replacement title",
            description: "Replacement description",
            confirmLabel: "Replacement label",
        };
        act(() =>
            rig.adapter.initiations[1]!.result.resolve(
                challenge({ dialogCopy: next }),
            ),
        );
        await settle();
        const root = dialog()!;
        expect(root.textContent).not.toContain(first.title);
        expect(
            document.getElementById(root.getAttribute("aria-labelledby")!)
                ?.textContent,
        ).toBe(next.title);
        expect(button(next.confirmLabel)?.disabled).toBe(false);
    });
});

describe("ConfirmationDialogHost: focus and busy state", () => {
    test("Tab and Shift+Tab keep focus inside the dialog", async () => {
        const rig = createRig();
        render(
            <>
                <button type="button">Outside</button>
                <ConfirmationDialogHost store={rig.store} />
            </>,
        );
        await openToReady(rig);
        const root = dialog()!;
        expect(root.contains(document.activeElement)).toBe(true);

        for (const shiftKey of [false, false, false, true, true, true]) {
            act(() => {
                fireEvent.keyDown(document.activeElement ?? document.body, {
                    key: "Tab",
                    shiftKey,
                });
            });
            await settle();
            expect(root.contains(document.activeElement)).toBe(true);
            expect(document.activeElement).not.toBe(
                document.body.querySelector("button[type='button']"),
            );
        }
    });

    test("aria-busy is true exactly while requesting, confirming and refreshing", async () => {
        const rig = createRig();
        mount(rig);
        act(() => {
            rig.store.getState().open(openRequest());
        });
        await settle();
        expect(dialog()!.getAttribute("aria-busy")).toBe("true");

        act(() => rig.adapter.initiations[0]!.result.resolve(challenge()));
        await settle();
        expect(dialog()!.getAttribute("aria-busy")).toBe("false");

        act(() => fireEvent.click(button("Make public")!));
        await settle();
        expect(dialog()!.getAttribute("aria-busy")).toBe("true");

        act(() =>
            rig.adapter.confirmations[0]!.result.resolve({
                kind: "rejected",
                reason: "expired_challenge",
            }),
        );
        await settle();
        expect(rig.store.getState().state.tag).toBe("expired");
        expect(dialog()!.getAttribute("aria-busy")).toBe("false");

        act(() => fireEvent.click(button("Refresh confirmation")!));
        await settle();
        expect(dialog()!.getAttribute("aria-busy")).toBe("true");
    });

    test("Escape closes a ready dialog but not a confirming one", async () => {
        const rig = createRig();
        mount(rig);
        await openToReady(rig);
        act(() => fireEvent.click(button("Make public")!));
        await settle();
        act(() => {
            fireEvent.keyDown(dialog()!, { key: "Escape" });
        });
        await settle();
        expect(rig.store.getState().state.tag).toBe("confirming");
        expect(button("Cancel")?.disabled).toBe(true);
    });
});

describe("ConfirmationDialogHost: safe copy fallback", () => {
    async function openToFallback(rig: Rig) {
        act(() => {
            rig.store.getState().open(openRequest());
        });
        await settle();
        act(() => rig.adapter.initiations[0]!.result.resolve(LEGACY));
        await settle();
    }

    test("offers exactly Close and Get new confirmation, with fixed generic text", async () => {
        const rig = createRig();
        mount(rig);
        await openToFallback(rig);
        const root = dialog()!;

        const labels = Array.from(
            root.querySelectorAll<HTMLButtonElement>("button"),
        ).map((b) => [b.textContent, b.disabled] as const);
        expect(labels).toEqual([
            ["Close", false],
            ["Get new confirmation", false],
        ]);
        expect(root.hasAttribute("aria-describedby")).toBe(false);
        expect(
            document.getElementById(root.getAttribute("aria-labelledby")!)
                ?.textContent,
        ).toBe("Confirmation details unavailable");
        expect(root.querySelector('[role="status"]')?.textContent).toContain(
            "We couldn't show what this confirmation would do",
        );
        expect(button("Make public")).toBeNull();
        expect(button("Refresh confirmation")).toBeNull();
    });

    test("Get new confirmation submits a new initiation with a new key and never the malformed challenge", async () => {
        const rig = createRig();
        mount(rig);
        await openToFallback(rig);
        act(() => fireEvent.click(button("Get new confirmation")!));
        await settle();

        expect(rig.adapter.initiations).toHaveLength(2);
        expect(rig.adapter.initiations[1]!.key).not.toBe(
            rig.adapter.initiations[0]!.key,
        );
        expect(rig.adapter.confirmations).toHaveLength(0);
        expect(rig.store.getState().state.tag).toBe("requesting");
        expect(button("Get new confirmation")).toBeNull();
        // Focus never falls out of the dialog when the pressed button goes away.
        expect(dialog()!.contains(document.activeElement)).toBe(true);

        act(() => rig.adapter.initiations[1]!.result.resolve(challenge()));
        await settle();
        expect(button("Make public")?.disabled).toBe(false);
    });

    test("Close ends the fallback and restores focus", async () => {
        const rig = createRig();
        mount(rig);
        await openToFallback(rig);
        act(() => fireEvent.click(button("Close")!));
        await settle();
        expect(rig.store.getState().state.tag).toBe("closed");
        expect(rig.focusRestored).toHaveLength(1);
        expect(rig.adapter.confirmations).toHaveLength(0);
    });
});

describe("operation-specific text lives only in PostgreSQL", () => {
    const here = import.meta.dir;
    const confirmationDir = join(
        here,
        "../../../../../../../utils/confirmation",
    );
    const sources = [
        join(here, "ConfirmationDialogHost.tsx"),
        ...readdirSync(confirmationDir)
            .filter(
                (name) =>
                    name.endsWith(".ts") &&
                    !name.endsWith(".test.ts") &&
                    !name.endsWith(".typecheck.ts") &&
                    name !== "testRig.ts",
            )
            .map((name) => join(confirmationDir, name)),
    ];

    test("the fresh-initiation control is tagged for Cypress through the cy helper", () => {
        const host = readFileSync(sources[0]!, "utf8");
        expect(host).toContain('cy("confirm_dialog_fresh_initiation")');
        expect(host).not.toContain("dangerouslySetInnerHTML");
    });

    test("the host and the generic protocol files carry none of the make-public literals", () => {
        expect(sources.length).toBeGreaterThan(5);
        const literals = [
            "Make public",
            "Make “",
            'Make "',
            "Making public",
            "Anyone signed in",
            "see and download",
            "{{targetLabel}}",
        ];
        for (const file of sources) {
            const text = readFileSync(file, "utf8");
            for (const literal of literals) {
                expect(text.includes(literal), `${file}: ${literal}`).toBe(
                    false,
                );
            }
        }
    });
});
