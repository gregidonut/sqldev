import React, { useEffect, useId, useRef, useState } from "react";
import type { StoreApi, UseBoundStore } from "zustand";
import { useStore } from "zustand";
import { cy } from "@/utils/cy";
import { controlsFor, statusText } from "@/utils/confirmation/dialogMachine";
import {
    useConfirmationStore,
    type ConfirmationStore,
} from "@/utils/confirmation/confirmationStore";
import type { DialogState } from "@/utils/confirmation/protocol";
import { Button } from "../Button";
import { Dialog, Heading } from "../Dialog";
import { Modal } from "../Modal";

export type ConfirmationDialogHostProps = {
    /** Defaults to the app-wide store; tests pass one built with fake time. */
    store?: UseBoundStore<StoreApi<ConfirmationStore>>;
};

const FALLBACK_COPY = {
    title: "Confirm this change?",
    description: "The server asked you to confirm this change.",
    confirmLabel: "Confirm",
};

/**
 * The one confirmation dialog for every backend-requested confirmation. It knows
 * nothing about storage: the text comes from the operation's adapter and every
 * control comes from `controlsFor(state)`.
 *
 * While it is open and waiting for the person, the backend is holding nothing.
 * The dialog never shows or announces remaining time; when a challenge expires it
 * stays open, disables the confirm button and offers to refresh.
 */
export function ConfirmationDialogHost({
    store = useConfirmationStore,
}: ConfirmationDialogHostProps): React.ReactNode {
    const state = useStore(store, (s) => s.state);
    // Each action is a stable function; selecting them one by one keeps every
    // selector's result referentially stable (an object literal would loop).
    const confirm = useStore(store, (s) => s.confirm);
    const refresh = useStore(store, (s) => s.refresh);
    const close = useStore(store, (s) => s.close);
    const adapterFor = useStore(store, (s) => s.adapterFor);

    // Keep rendering the last open state while the modal plays its exit animation,
    // after the store has already moved to "closed".
    const [shown, setShown] = useState<DialogState>(state);
    if (state.tag !== "closed" && shown !== state) {
        setShown(state);
    }
    const view = state.tag === "closed" ? shown : state;

    const descriptionId = useId();
    // The shared Dialog and Button wrappers do not take a ref, so the host owns a
    // plain wrapper element and finds the dialog and Cancel button from it.
    const contentRef = useRef<HTMLDivElement | null>(null);

    // If the focused button disappeared or became unavailable (for example the
    // Refresh button after it succeeded), put focus on Cancel, the safe choice.
    useEffect(() => {
        if (state.tag === "closed") {
            return;
        }
        const content = contentRef.current;
        const dialog =
            content?.closest<HTMLElement>('[role="alertdialog"]') ?? null;
        if (content === null || dialog === null) {
            return;
        }
        const active = document.activeElement;
        if (active !== null && dialog.contains(active) && active !== dialog) {
            return;
        }
        if (state.tag === "confirming") {
            dialog.focus();
            return;
        }
        (
            content.querySelector<HTMLElement>("[data-confirm-cancel]") ??
            dialog
        ).focus();
    }, [state.tag]);

    const isOpen = state.tag !== "closed";
    const controls = controlsFor(view);
    const subject = view.tag === "closed" ? null : view.subject;
    const adapter =
        subject === null ? undefined : adapterFor(subject.operationKind);
    const copy =
        subject !== null && adapter !== undefined
            ? adapter.copy(subject)
            : FALLBACK_COPY;
    const status = statusText(view);

    return (
        <Modal
            isOpen={isOpen}
            onOpenChange={(open) => {
                if (!open) {
                    close();
                }
            }}
            isDismissable={controls.dismissable}
            isKeyboardDismissDisabled={!controls.dismissable}
        >
            <Dialog
                role="alertdialog"
                aria-describedby={descriptionId}
                // Dialog does not forward aria-busy, so set it through `render`.
                render={(domProps) => (
                    <section {...domProps} aria-busy={controls.busy} />
                )}
                {...cy("confirm_dialog")}
            >
                <div ref={contentRef}>
                    <Heading
                        slot="title"
                        className="text-xl font-semibold leading-6 my-0 text-drac-foreground"
                    >
                        {copy.title}
                    </Heading>
                    <p id={descriptionId} className="mt-3 text-drac-comment">
                        {copy.description}
                    </p>
                    <p
                        role="status"
                        aria-live="polite"
                        className="mt-3 min-h-5 text-sm text-drac-comment"
                        {...cy("confirm_dialog_status")}
                    >
                        {status}
                    </p>
                    <div className="mt-6 flex flex-wrap justify-end gap-2">
                        {controls.cancel.visible && (
                            <Button
                                variant="secondary"
                                data-confirm-cancel=""
                                // Cancel is the safe default, so it takes focus first.
                                autoFocus
                                isDisabled={!controls.cancel.enabled}
                                onPress={close}
                                {...cy("confirm_dialog_cancel")}
                            >
                                {controls.cancel.label}
                            </Button>
                        )}
                        {controls.confirm.visible && (
                            <Button
                                variant="primary"
                                isDisabled={
                                    !controls.confirm.enabled &&
                                    view.tag !== "confirming"
                                }
                                isPending={view.tag === "confirming"}
                                onPress={confirm}
                                {...cy("confirm_dialog_confirm")}
                            >
                                {copy.confirmLabel}
                            </Button>
                        )}
                        {controls.refresh.visible && (
                            <Button
                                variant="primary"
                                isDisabled={
                                    !controls.refresh.enabled &&
                                    view.tag !== "refreshing"
                                }
                                isPending={view.tag === "refreshing"}
                                onPress={refresh}
                                {...cy("confirm_dialog_refresh")}
                            >
                                Refresh confirmation
                            </Button>
                        )}
                    </div>
                </div>
            </Dialog>
        </Modal>
    );
}
