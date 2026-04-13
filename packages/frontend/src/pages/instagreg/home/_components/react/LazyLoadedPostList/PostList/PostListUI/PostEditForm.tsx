import React, { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { Form } from "@/components/ui/Form";
import { TextField } from "@/components/ui/TextField";
import { Button } from "@/components/ui/Button";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import type { Database } from "@/utils/supabase/models";
import { useStore } from "@nanostores/react";
import { $authStore } from "@clerk/astro/client";

type PostViewRow = Database["public"]["Views"]["ig_posts_view"]["Row"];

interface PostEditFormProps {
    postId: string;
    onCancel: () => void;
    onSuccess?: () => void;
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

    const { handleSubmit, control, reset } = useForm<{ text_content: string }>({
        defaultValues: {
            text_content: "",
        },
    });

    useEffect(() => {
        if (data) {
            reset({ text_content: (data.text_content as string) || "" });
        }
    }, [data, reset]);

    const onSubmit = async (formData: { text_content: string }) => {
        console.log("Submitting updated post:", postId, formData);
        // For now, just call onSuccess and onCancel as there's no update API provided in the prompt.
        if (onSuccess) onSuccess();
        onCancel();
    };

    if (isLoading) {
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
        <Form
            onSubmit={handleSubmit(onSubmit)}
            className="w-full p-4 border border-drac-purple rounded-lg bg-drac-background/50 shadow-lg"
        >
            <Controller
                control={control}
                name="text_content"
                rules={{ required: "Post content cannot be empty." }}
                render={({
                    field: { name, value, onChange, onBlur, ref },
                    fieldState: { invalid, error: fieldError },
                }) => (
                    <TextField
                        label={name}
                        name={name}
                        value={value}
                        onChange={onChange}
                        onBlur={onBlur}
                        ref={ref}
                        isRequired
                        autoFocus
                        validationBehavior="aria"
                        isInvalid={invalid}
                        errorMessage={fieldError?.message}
                        className="w-full"
                    />
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
