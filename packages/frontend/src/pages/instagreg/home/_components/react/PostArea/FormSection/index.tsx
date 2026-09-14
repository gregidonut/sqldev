import React from "react";
import { cy } from "@/utils/cy";
import {
    useMutation,
    QueryClientProvider,
} from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { Form } from "@/components/ui/Form";
import { TextField } from "@/components/ui/TextField";
import { Button } from "@/components/ui/Button";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { mutationFn } from "./mutationFn.ts";
import type { Database } from "@/utils/supabase/models";
import { listQueryClient } from "@/components/react/DDrvList/queryClient.ts";

function PostArea() {
    const { handleSubmit, control, reset } = useForm<
        Database["public"]["Functions"]["create_ig_post"]["Args"]
    >({
        defaultValues: {
            p_text_content: "",
        } satisfies Database["public"]["Functions"]["create_ig_post"]["Args"],
    });

    const { mutate, isPending } = useMutation({
        mutationFn,
        onSuccess: () => {
            reset();
            void listQueryClient.invalidateQueries({
                queryKey: ["get", "igPosts", "list"],
            });
        },
        onError: (error) => console.log(error),
    });

    let onSubmit = (
        data: Database["public"]["Functions"]["create_ig_post"]["Args"],
    ) => {
        mutate(data);
    };

    return (
        <Form onSubmit={handleSubmit(onSubmit)} className="flex-1">
            <Controller
                control={control}
                name="p_text_content"
                rules={{ required: "post text is required." }}
                render={({
                    field: { name, value, onChange, onBlur, ref },
                    fieldState: { invalid, error },
                }) => (
                    <TextField
                        {...cy("p_text_content_field")}
                        label={name}
                        name={name}
                        value={value}
                        onChange={onChange}
                        onBlur={onBlur}
                        ref={ref}
                        isRequired
                        // Let React Hook Form handle validation instead of the browser.
                        validationBehavior="aria"
                        isInvalid={invalid}
                        errorMessage={error?.message}
                        isDisabled={invalid || isPending}
                    />
                )}
            />
            <Button type="submit" {...cy("create_ig_post_submit")}>
                Submit
            </Button>
        </Form>
    );
}

export default function PostAreaWrapper() {
    return (
        <QueryClientProvider client={listQueryClient}>
            <ReactQueryDevtools initialIsOpen={false} />
            <PostArea />
        </QueryClientProvider>
    );
}
