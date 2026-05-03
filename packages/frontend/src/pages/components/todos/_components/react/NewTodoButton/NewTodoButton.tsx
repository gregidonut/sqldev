import React from "react";
import { DialogTrigger } from "react-aria-components/Modal";
import { Modal, type ModalOverlayProps } from "@/components/ui/Modal";
import { Dialog, Heading } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import FormSection from "./FormSection";

export default function NewTodoButton(props: ModalOverlayProps) {
    return (
        <DialogTrigger>
            <Button>new</Button>
            <Modal {...props}>
                <Dialog>
                    {({ close }) => (
                        <>
                            <header>
                                <Heading slot="title" className="text-xl mt-0">
                                    New Todo
                                </Heading>
                            </header>
                            <main>
                                <FormSection onSuccess={close} />
                            </main>
                        </>
                    )}
                </Dialog>
            </Modal>
        </DialogTrigger>
    );
}
