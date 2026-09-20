import React from "react";
import {
    useMutation,
    QueryClient,
    QueryClientProvider,
} from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Form } from "@/components/ui/Form";
import { Button } from "@/components/ui/Button";
import { mutationFn } from "./mutationFn.ts";
import type { Database } from "@/utils/supabase/models";
import { FormSectionContext } from "./FormSectionContext.ts";
import TitleField from "./Fields/TitleField.tsx";
import DescriptionTextArea from "./Fields/DescriptionTextArea.tsx";
import { cy } from "@/utils/cy";

const submitButtonClassName =
    "scheme-dark bg-drac-purple hover:bg-drac-pink pressed:bg-drac-comment text-drac-background outline-drac-cyan dark:outline-drac-cyan border-drac-selection dark:border-drac-selection";

function FormSection({
    onSuccess,
    tdsTodoSpaceId,
}: {
    tdsTodoSpaceId: string;
    onSuccess?: () => void;
}) {
    const { handleSubmit, control, reset } = useForm<
        Database["public"]["Functions"]["create_tds_todo"]["Args"]
    >({
        defaultValues: {
            p_title: "",
            p_description: "",
            p_todo_space_id: tdsTodoSpaceId,
        } satisfies Database["public"]["Functions"]["create_tds_todo"]["Args"],
        values: {
            p_title: "",
            p_description: "",
            p_todo_space_id: tdsTodoSpaceId,
        },
    });

    const { mutate } = useMutation({
        mutationFn,
        onSuccess: () => {
            reset();
            onSuccess?.();
        },
        onError: (error) => console.log(error),
    });

    let onSubmit = (
        data: Database["public"]["Functions"]["create_tds_todo"]["Args"],
    ) => {
        mutate({ ...data, p_todo_space_id: tdsTodoSpaceId });
    };

    return (
        <Form
            onSubmit={handleSubmit(onSubmit)}
            className="flex-1 scheme-dark text-drac-foreground"
        >
            <FormSectionContext.Provider value={control}>
                <TitleField />
                <DescriptionTextArea />
            </FormSectionContext.Provider>
            <Button
                type="submit"
                {...cy("create_tds_todo_submit")}
                className={submitButtonClassName}
            >
                Submit
            </Button>
        </Form>
    );
}

export default function FormSectionWrapper({
    onSuccess,
    tdsTodoSpaceId,
}: {
    tdsTodoSpaceId: string;
    onSuccess?: () => void;
}) {
    const queryClient = new QueryClient();
    return (
        <QueryClientProvider client={queryClient}>
            <FormSection
                onSuccess={onSuccess}
                tdsTodoSpaceId={tdsTodoSpaceId}
            />
        </QueryClientProvider>
    );
}
