import React from "react";
import {
    useMutation,
    QueryClientProvider,
} from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Form } from "@/components/ui/Form.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { mutationFn } from "./mutationFn.ts";
import type { Database } from "@/utils/supabase/models";
import { FormSectionContext } from "./FormSectionContext.ts";
import NameField from "./Fields/NameField.tsx";
import { listQueryClient } from "@/components/react/DDrvList/queryClient.ts";
import { cy } from "@/utils/cy";

function FormSection() {
    const { handleSubmit, control, reset } = useForm<
        Database["public"]["Functions"]["create_tds_todo_space"]["Args"]
    >({
        defaultValues: {
            p_name: "",
        } satisfies Database["public"]["Functions"]["create_tds_todo_space"]["Args"],
    });

    const { mutate } = useMutation({
        mutationFn,
        onSuccess: () => {
            reset();
            void listQueryClient.invalidateQueries({
                queryKey: ["get", "tdsTodoSpaces", "list"],
            });
        },
        onError: (error) => console.log(error),
    });

    let onSubmit = (
        data: Database["public"]["Functions"]["create_tds_todo_space"]["Args"],
    ) => {
        mutate(data);
    };

    return (
        <Form onSubmit={handleSubmit(onSubmit)} className="flex-1">
            <FormSectionContext.Provider value={control}>
                <NameField />
            </FormSectionContext.Provider>
            <Button type="submit" {...cy("create_tds_todo_space_submit")}>
                Submit
            </Button>
        </Form>
    );
}

export default function FormSectionWrapper({
    onSuccess,
}: {
    onSuccess?: () => void;
}) {
    return (
        <QueryClientProvider client={listQueryClient}>
            <FormSection />
        </QueryClientProvider>
    );
}
