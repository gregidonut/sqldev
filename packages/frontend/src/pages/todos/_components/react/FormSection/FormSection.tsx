import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import {
    MutationForm,
    TextInputField,
    SubmitButton,
    createViewItemMutationOptions,
} from "@/components/react/MutationForm";
import type { CreateTdsTodoSpaceArgs } from "@/utils/supabase/models/aliases.ts";
import { listQueryClient } from "@/components/react/DDrvList/queryClient.ts";

function FormSection() {
    const mutationOptions = createViewItemMutationOptions({
        view: "tdsTodoSpaces",
    });

    return (
        <MutationForm
            formOptions={{
                defaultValues: {
                    p_name: "",
                } satisfies CreateTdsTodoSpaceArgs,
            }}
            mutationOptions={mutationOptions}
            className="flex-1"
        >
            <TextInputField<CreateTdsTodoSpaceArgs>
                name="p_name"
                rules={{ required: "Title is required." }}
                isRequired
                dataCy="p_name_field"
            />
            <SubmitButton dataCy="create_tds_todo_space_submit">
                Submit
            </SubmitButton>
        </MutationForm>
    );
}

export default function FormSectionWrapper({
    onSuccess: _onSuccess,
}: {
    onSuccess?: () => void;
}) {
    return (
        <QueryClientProvider client={listQueryClient}>
            <FormSection />
        </QueryClientProvider>
    );
}
