import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { MutationForm, SubmitButton } from "@/components/react/MutationForm";
import {
    MdxEditorField,
    createIgPostMutationOptions,
    type EditorSizing,
} from "@/components/react/MdxEditor";
import type { CreateIgPostArgs } from "@/utils/supabase/models/aliases.ts";
import { listQueryClient } from "@/components/react/DDrvList/queryClient.ts";

// Compact, content-growing editor with a four-row minimum and a full-width
// wrapping toolbar. The page scrolls, not the editor.
const CREATE_SIZING = { mode: "content", minRows: 4 } satisfies EditorSizing;

function PostArea() {
    const mutationOptions = createIgPostMutationOptions({
        queryClient: listQueryClient,
        view: "igPosts",
    });

    return (
        <MutationForm
            formOptions={{
                defaultValues: {
                    p_text_content: "",
                } satisfies CreateIgPostArgs,
            }}
            mutationOptions={mutationOptions}
            className="flex-1"
        >
            <MdxEditorField<CreateIgPostArgs>
                name="p_text_content"
                rules={{ required: "post text is required." }}
                isRequired
                sizing={CREATE_SIZING}
                toolbarWidth="100%"
                ariaLabel="Post content"
                label="Create post"
                dataCy="p_text_content_field"
            />
            <SubmitButton dataCy="create_ig_post_submit">Submit</SubmitButton>
        </MutationForm>
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
