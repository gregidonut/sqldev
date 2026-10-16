import { afterEach, describe, expect, spyOn, test } from "bun:test";
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

    test("opens as a busy alertdialog with one name and one description", async () => {
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
        const name = document.getElementById(labelledBy!)?.textContent ?? "";
        expect(name).toContain("Make");
        expect(name).toContain("report.pdf");

        const describedBy = root!.getAttribute("aria-describedby");
        expect(describedBy).toBeTruthy();
        expect(document.getElementById(describedBy!)?.textContent).toContain(
            "see and download",
        );

        expect(button("Make public")?.disabled).toBe(true);
        expect(button("Cancel")?.disabled).toBe(false);
        expect(button("Refresh confirmation")).toBeNull();
        expect(root!.querySelector('[role="status"]')?.textContent).toBe(
            "Preparing confirmation…",
        );
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
