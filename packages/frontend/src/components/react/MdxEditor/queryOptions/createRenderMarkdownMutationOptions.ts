import { mutationOptions } from "@tanstack/react-query";
import {
    renderMarkdown,
    type RenderMarkdownData,
    type RenderMarkdownError,
    type RenderMarkdownVariables,
} from "./renderMarkdownClient.ts";

/**
 * Pure mutation-option factory for the Markdown render request.
 *
 * It performs no React hook calls and no Zustand reads, so it can be evaluated
 * anywhere and reused. The render request has no cache side effect, so this
 * factory does not invalidate any query. The caller owns `onSuccess`/`onError`
 * so the component demo can commit its atomic last-success snapshot.
 */
export default function createRenderMarkdownMutationOptions() {
    return mutationOptions<
        RenderMarkdownData,
        RenderMarkdownError,
        RenderMarkdownVariables
    >({
        mutationFn: (variables) => renderMarkdown(variables),
    });
}
