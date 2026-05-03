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

function FormSection({ onSuccess }: { onSuccess?: () => void }) {
    const { handleSubmit, control, reset } = useForm<
        Database["public"]["Functions"]["create_tds_todo"]["Args"]
    >({
        defaultValues: {
            p_title: "",
            p_description: "",
        } satisfies Database["public"]["Functions"]["create_tds_todo"]["Args"],
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
        mutate(data);
    };

    return (
        <Form onSubmit={handleSubmit(onSubmit)} className="flex-1">
            <FormSectionContext.Provider value={control}>
                <TitleField />
                <DescriptionTextArea />
            </FormSectionContext.Provider>
            <Button type="submit">Submit</Button>
        </Form>
    );
}

export default function FormSectionWrapper({
    onSuccess,
}: {
    onSuccess?: () => void;
}) {
    const queryClient = new QueryClient();
    return (
        <QueryClientProvider client={queryClient}>
            <FormSection onSuccess={onSuccess} />
        </QueryClientProvider>
    );
}
