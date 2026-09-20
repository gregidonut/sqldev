import React from "react";
import { DialogTrigger } from "react-aria-components/Modal";
import { Modal, type ModalOverlayProps } from "@/components/ui/Modal";
import { Dialog, Heading } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import FormSection from "./FormSection";
import { cy } from "@/utils/cy";
import "./new-todo.css";

const newTodoButtonClassName =
    "scheme-dark bg-drac-purple hover:bg-drac-pink pressed:bg-drac-comment text-drac-background outline-drac-cyan dark:outline-drac-cyan border-drac-selection dark:border-drac-selection";

type ExtendedModalOverlayProps = ModalOverlayProps & {
    tdsTodoSpaceId: string;
};

export default function NewTodoButton(props: ExtendedModalOverlayProps) {
    return (
        <DialogTrigger>
            <Button
                {...cy("new_tds_todo_button")}
                className={newTodoButtonClassName}
            >
                new
            </Button>
            <Modal {...props} data-drac-todo="">
                <Dialog className="scheme-dark text-drac-foreground">
                    {({ close }) => (
                        <>
                            <header>
                                <Heading
                                    slot="title"
                                    className="text-xl mt-0 text-drac-foreground"
                                >
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
