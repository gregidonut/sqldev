import React from "react";
import { DialogTrigger } from "react-aria-components/Modal";
import { Modal, type ModalOverlayProps } from "@/components/ui/Modal";
import { Dialog, Heading } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import FormSection from "./FormSection";
import { cy } from "@/utils/cy";

type ExtendedModalOverlayProps = ModalOverlayProps & {
    tdsTodoSpaceId: string;
};

export default function NewTodoButton(props: ExtendedModalOverlayProps) {
    return (
        <DialogTrigger>
            <Button {...cy("new_tds_todo_button")}>new</Button>
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
                                <FormSection
                                    onSuccess={close}
                                    tdsTodoSpaceId={props.tdsTodoSpaceId}
                                />
                            </main>
                        </>
                    )}
                </Dialog>
            </Modal>
        </DialogTrigger>
    );
}
