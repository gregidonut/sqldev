import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
    MutationForm,
    TextInputField,
    TextAreaField,
    SubmitButton,
    createTdsTodoMutationOptions,
} from "@/components/react/MutationForm";
import type { CreateTdsTodoArgs } from "@/utils/supabase/models/aliases.ts";

const submitButtonClassName =
    "scheme-dark bg-drac-purple hover:bg-drac-pink pressed:bg-drac-comment text-drac-background outline-drac-cyan dark:outline-drac-cyan border-drac-selection dark:border-drac-selection";

function FormSection({
    onSuccess,
    tdsTodoSpaceId,
}: {
    tdsTodoSpaceId: string;
    onSuccess?: () => void;
}) {
    const mutationOptions = createTdsTodoMutationOptions();

    return (
        <MutationForm
            formOptions={{
                defaultValues: {
                    p_title: "",
                    p_description: "",
                    p_todo_space_id: tdsTodoSpaceId,
                } satisfies CreateTdsTodoArgs,
                values: {
                    p_title: "",
                    p_description: "",
                    p_todo_space_id: tdsTodoSpaceId,
                },
            }}
            mutationOptions={mutationOptions}
            onSuccess={onSuccess}
            className="flex-1 scheme-dark text-drac-foreground"
        >
            <TextInputField<CreateTdsTodoArgs>
                name="p_title"
                rules={{ required: "Title is required." }}
                isRequired
                className="new-todo-field"
                dataCy="p_title_field"
            />
            <TextAreaField<CreateTdsTodoArgs>
                name="p_description"
                className="new-todo-field flex-col-start-start gap-1"
            />
            <SubmitButton
                dataCy="create_tds_todo_submit"
                className={submitButtonClassName}
            >
                Submit
            </SubmitButton>
        </MutationForm>
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
