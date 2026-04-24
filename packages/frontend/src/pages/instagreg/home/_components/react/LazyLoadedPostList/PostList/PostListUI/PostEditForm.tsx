import React, { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { Form } from "@/components/ui/Form";
// import { TextField } from "@/components/ui/TextField";
import { Button } from "@/components/ui/Button";
import { useQuery, useMutation } from "@tanstack/react-query";
import axios from "axios";
import type { Database } from "@/utils/supabase/models";
import { useStore } from "@nanostores/react";
import { $authStore } from "@clerk/astro/client";
import { FieldError, Label, TextArea, TextField } from "react-aria-components";

type PostViewRow = Database["public"]["Views"]["ig_posts_view"]["Row"];

interface PostEditFormProps {
    postId: string;
    onCancel: () => void;
    onSuccess?: () => void;
}

function submitForm(data: FormData) {
    return axios<Database["public"]["Functions"]["update_ig_post"]["Args"]>({
        method: "PATCH",
        url: "/api/igPosts/one/patch",
        data,
        headers: { "Content-Type": "multipart/form-data" },
    });
}

export default function PostEditForm({
    postId,
    onCancel,
    onSuccess,
}: PostEditFormProps) {
    const { userId } = useStore($authStore);
    const { data, isLoading, error } = useQuery<PostViewRow>({
        queryKey: [
            "get",
            "igPost",
            "one",
            {
                userId,
            },
            postId,
        ],
        queryFn: async () => {
            const { data } = await axios<PostViewRow>(
                `/api/igPosts/one/get/${postId}`,
                { method: "GET" },
            );
            return data;
        },
    });

    const { handleSubmit, control, reset } = useForm<
        Database["public"]["Functions"]["update_ig_post"]["Args"]
    >({
        defaultValues: {
            p_text_content: "",
        },
    });

    useEffect(() => {
        if (data) {
            reset({ p_text_content: (data.text_content as string) || "" });
        }
    }, [data, reset]);

    const { mutate, isPending } = useMutation({
        mutationFn: submitForm,
        onSuccess: () => {
            reset();
            if (onSuccess) onSuccess();
            onCancel();
        },
        onError: (error) => console.log(error),
    });

    const onSubmit = async (
        updateFormData: Database["public"]["Functions"]["update_ig_post"]["Args"],
    ) => {
        const formData = new FormData();
        formData.append("p_post_id", postId);
        formData.append("p_text_content", updateFormData.p_text_content ?? "");
        mutate(formData);
    };

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
                <Button variant="secondary" className="mt-2" onPress={onCancel}>
                    Cancel
                </Button>
            </div>
        );
    }

    return (
        <Form onSubmit={handleSubmit(onSubmit)} className="w-full p-4">
            <Controller
                control={control}
                name="p_text_content"
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
                <Button variant="secondary" onPress={onCancel}>
                    Cancel
                </Button>
                <Button type="submit">Save Changes</Button>
            </div>
        </Form>
    );
}
