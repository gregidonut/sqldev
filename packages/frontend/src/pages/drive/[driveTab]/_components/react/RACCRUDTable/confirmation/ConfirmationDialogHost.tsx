import React, { useEffect, useId, useRef, useState } from "react";
import type { StoreApi, UseBoundStore } from "zustand";
import { useStore } from "zustand";
import { cy } from "@/utils/cy";
import {
    controlsFor,
    presentationFor,
    registryIdFor,
    statusText,
} from "@/utils/confirmation/dialogMachine";
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

/**
 * The one confirmation dialog for every backend-requested confirmation. It knows
 * nothing about storage: the text is the validated copy PostgreSQL returned (via
 * `presentationFor(state)`), rendered only as React text children, and every
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
    const freshInitiation = useStore(store, (s) => s.freshInitiation);

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
    const presentation = presentationFor(view);
    const registryId = registryIdFor(view);
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
                aria-describedby={
                    presentation.description === null
                        ? undefined
                        : descriptionId
                }
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
                        {presentation.title}
                    </Heading>
                    {presentation.description !== null && (
                        <p
                            id={descriptionId}
                            className="mt-3 text-drac-comment"
                        >
                            {presentation.description}
                        </p>
                    )}
                    {registryId !== null && (
                        <p
                            className="mt-2 text-xs text-drac-comment"
                            {...cy("confirm_dialog_registry_id")}
                        >
                            Operation ID: {registryId}
                        </p>
                    )}
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
                        {controls.confirm.visible &&
                            presentation.confirmLabel !== null && (
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
                                    {presentation.confirmLabel}
                                </Button>
                            )}
                        {controls.freshInitiation.visible && (
                            <Button
                                variant="primary"
                                isDisabled={!controls.freshInitiation.enabled}
                                onPress={freshInitiation}
                                {...cy("confirm_dialog_fresh_initiation")}
                            >
                                Get new confirmation
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
