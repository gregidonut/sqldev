import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
    MutationForm,
    TextInputField,
    SubmitButton,
    createViewItemMutationOptions,
} from "@/components/react/MutationForm";
import type { CreateIgPostArgs } from "@/utils/supabase/models/aliases.ts";
import { listQueryClient } from "@/components/react/DDrvList/queryClient.ts";

function PostArea() {
    const mutationOptions = createViewItemMutationOptions({ view: "igPosts" });

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
            <TextInputField<CreateIgPostArgs>
                name="p_text_content"
                rules={{ required: "post text is required." }}
                isRequired
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
