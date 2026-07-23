import React, { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { Form } from "@/components/ui/Form.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { Database } from "@/utils/supabase/models";
import { useStore } from "@nanostores/react";
import { $authStore } from "@clerk/astro/client";
import { FieldError, Label, TextArea, TextField } from "react-aria-components";
import { useListStore } from "@/components/react/DDrvList/store/store.ts";
import createOneGetQueryOptions from "@/components/react/DDrvList/queryOptions/createOneGet.ts";
import createOnePatchMutationOptions from "@/components/react/DDrvList/queryOptions/createOnePatch.ts";
import {
    type ViewMap,
    viewRPCMap,
} from "@/components/react/DDrvList/viewMap.ts";

export default function ItemEditForm({ postId }: { postId: string }) {
    const { userId } = useStore($authStore);
    const { currentView: view, setIsEditing } = useListStore();
    if (!view) return null;

    const updateFunctionName = viewRPCMap[view].update;
    type UpdateArgs =
        Database["public"]["Functions"][typeof updateFunctionName]["Args"];

    const { data, isLoading, error } = useQuery<ViewMap[typeof view]>(
        createOneGetQueryOptions(postId, userId ?? ""),
    );

    const { handleSubmit, control, reset } = useForm<UpdateArgs>(
        (function (): { defaultValues: UpdateArgs } {
            switch (view) {
                case "igPosts":
                    return {
                        defaultValues: {
                            p_text_content: "",
                        },
                    };
                case "tdsTodoSpaces":
                    return {
                        defaultValues: {
                            p_name: "",
                        },
                    };
            }
        })(),
    );

    useEffect(() => {
        if (data) {
            switch (view) {
                case "igPosts":
                    reset({
                        p_text_content:
                            ((data as ViewMap[typeof view])
                                .text_content as string) || "",
                    });
                    break;
            }
        }
    }, [data, reset, view]);

    const { mutate, isPending } = useMutation(
        createOnePatchMutationOptions(reset, userId!),
    );

    async function onSubmit(updateFormData: UpdateArgs) {
        const formData = new FormData();
        switch (view) {
            case "igPosts":
                formData.append("p_post_id", postId);
                formData.append(
                    "p_text_content",
                    (
                        updateFormData as Database["public"]["Functions"]["update_ig_post"]["Args"]
                    ).p_text_content ?? "",
                );
                break;
        }
        mutate(formData);
    }

    if (isLoading || isPending) {
        return (
            <div className="p-4 border border-drac-comment rounded-lg bg-drac-background/50">
                <p className="text-drac-comment italic">
                    Loading post content...
                </p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4 border border-drac-red rounded-lg bg-drac-red/10">
                <p className="text-drac-red">
                    Error: {(error as Error).message}
                </p>
                <Button
                    variant="secondary"
                    className="mt-2"
                    onPress={() => setIsEditing(false)}
                >
                    Cancel
                </Button>
            </div>
        );
    }

    return (
        <Form onSubmit={handleSubmit(onSubmit)} className="w-full p-4">
            <Controller
                control={control}
                name={(function () {
                    switch (view) {
                        case "igPosts":
                            return "p_text_content";
                        case "tdsTodoSpaces":
                            return "p_name";
                    }
                })()}
                rules={{ required: "Post content cannot be empty." }}
                render={({
                    field: { name, value, onChange, onBlur, ref },
                    fieldState: { invalid, error: fieldError },
                }) => (
                    <TextField
                        name={name}
                        value={value}
                        onChange={onChange}
                        onBlur={onBlur}
                        ref={ref}
                        isRequired
                        autoFocus
                        validationBehavior="aria"
                        isInvalid={invalid}
                        // errorMessage={fieldError?.message}
                        className="flex-col-start-start gap-1"
                    >
                        <Label>{name}</Label>
                        <TextArea
                            rows={4}
                            className="w-full resize-none rounded-sm border-drac-comment px-3 py-2 bg-drac-background field-sizing-content"
                            onKeyDown={(e) => {
                                if (e.key.startsWith("Arrow")) {
                                    e.stopPropagation();
                                }
                            }}
                        />
                        {fieldError && (
                            <FieldError className="text-drac-red">
                                {fieldError.message}
                            </FieldError>
                        )}
                    </TextField>
                )}
            />
            <div className="flex gap-3 mt-4 justify-end">
                <Button variant="secondary" onPress={() => setIsEditing(false)}>
                    Cancel
                </Button>
                <Button type="submit">Save Changes</Button>
            </div>
        </Form>
    );
}
