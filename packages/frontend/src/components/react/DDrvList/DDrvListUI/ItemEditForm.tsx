import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@nanostores/react";
import { $authStore } from "@clerk/astro/client";
import { Button } from "@/components/ui/Button.tsx";
import { useListStore } from "@/components/react/DDrvList/store/store.ts";
import { listQueryClient } from "@/components/react/DDrvList/queryClient.ts";
import { MutationForm, SubmitButton } from "@/components/react/MutationForm";
import {
    MdxEditorField,
    getIgPostQueryOptions,
    updateIgPostMutationOptions,
    type EditorSizing,
} from "@/components/react/MdxEditor";
import type { UpdateIgPostArgs } from "@/utils/supabase/models/aliases.ts";
import { cy } from "@/utils/cy";

type UpdateIgPostFormValues = Pick<UpdateIgPostArgs, "p_text_content">;

// Content-growing editor with a four-row minimum and a full-width wrapping
// toolbar, matching the create form.
const EDIT_SIZING = { mode: "content", minRows: 4 } satisfies EditorSizing;

function LoadingFallback() {
    return (
        <div className="p-4 border border-drac-comment rounded-lg bg-drac-background/50">
            <p className="text-drac-comment italic">Loading post content...</p>
        </div>
    );
}

export default function ItemEditForm({ postId }: { postId: string }) {
    const { userId } = useStore($authStore);
    const { currentView: view, setIsEditing } = useListStore();
    const resolvedUserId = userId ?? "";
    const oneGetOptions = getIgPostQueryOptions({
        view: "igPosts",
        userId: resolvedUserId,
        itemId: postId,
    });
    const { data, isLoading, error } = useQuery({
        ...oneGetOptions,
        enabled: view === "igPosts",
    });
    const mutationOptions = updateIgPostMutationOptions({
        queryClient: listQueryClient,
        view: "igPosts",
        userId: resolvedUserId,
    });

    function toVariables(values: UpdateIgPostFormValues) {
        const formData = new FormData();
        formData.append("p_post_id", postId);
        formData.append("p_text_content", values.p_text_content);
        return formData;
    }

    if (view !== "igPosts") {
        return null;
    }

    if (isLoading) {
        return <LoadingFallback />;
    }

    if (error) {
        return (
            <div className="p-4 border border-drac-red rounded-lg bg-drac-red/10">
                <p className="text-drac-red">Error: {error.message}</p>
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

    const textContent = data?.text_content ?? "";

    return (
        <MutationForm
            formOptions={{
                defaultValues: {
                    p_text_content: "",
                } satisfies UpdateIgPostFormValues,
                values: {
                    p_text_content: textContent,
                },
            }}
            mutationOptions={mutationOptions}
            toVariables={toVariables}
            onSuccess={() => setIsEditing(false)}
            pendingFallback={<LoadingFallback />}
            className="w-full p-4"
            {...cy("edit_ig_post_form")}
        >
            <MdxEditorField<UpdateIgPostFormValues>
                name="p_text_content"
                rules={{ required: "Post content cannot be empty." }}
                isRequired
                autoFocus
                stopArrowKeyPropagation
                sizing={EDIT_SIZING}
                toolbarWidth="100%"
                ariaLabel="Post content"
                label="Edit post"
                onCloseRequest={() => setIsEditing(false)}
                className="w-full flex-col-start-start gap-1"
                dataCy="edit_p_text_content_field"
            />
            <div className="flex gap-3 mt-4 justify-end">
                <Button variant="secondary" onPress={() => setIsEditing(false)}>
                    Cancel
                </Button>
                <SubmitButton dataCy="edit_ig_post_submit">
                    Save Changes
                </SubmitButton>
            </div>
        </MutationForm>
    );
}
