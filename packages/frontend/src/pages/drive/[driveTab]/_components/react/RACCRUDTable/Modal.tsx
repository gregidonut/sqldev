import React from "react";
import {
    ModalOverlay,
    type ModalOverlayProps,
    Modal as RACModal,
} from "react-aria-components/Modal";
import { tv } from "tailwind-variants";

const overlayStyles = tv({
    base: "absolute top-0 left-0 w-full h-(--page-height) isolate z-20 bg-drac-background/70 text-center backdrop-blur-lg",
    variants: {
        isEntering: {
            true: "animate-in fade-in duration-200 ease-out",
        },
        isExiting: {
            true: "animate-out fade-out duration-200 ease-in",
        },
    },
});

const modalStyles = tv({
    base: "font-sans w-full max-w-[min(90vw,450px)] max-h-[calc(var(--visual-viewport-height)*.9)] rounded-2xl bg-drac-background backdrop-blur-2xl backdrop-saturate-200 forced-colors:bg-[Canvas] text-left align-middle text-drac-foreground shadow-2xl bg-clip-padding border border-drac-selection",
    variants: {
        isEntering: {
            true: "animate-in zoom-in-105 ease-out duration-200",
        },
        isExiting: {
            true: "animate-out zoom-out-95 ease-in duration-200",
        },
    },
});

export function Modal(props: ModalOverlayProps) {
    return (
        <ModalOverlay {...props} className={overlayStyles}>
            <div className="sticky top-0 left-0 w-full h-(--visual-viewport-height) flex items-center justify-center box-border">
                <RACModal {...props} className={modalStyles} />
            </div>
        </ModalOverlay>
    );
}
