import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

type JobConfig = {
    method?: string;
    url?: string;
    data?: unknown;
    headers?: unknown;
};

// Shared recorder the mocked module writes into. `mock.module` replaces the
// real `requestJob` for every import in this test file, which is the supported
// way to stub an ESM dependency under Bun (export bindings are read-only).
const jobCalls: JobConfig[] = [];
let jobResult: unknown;

mock.module("@/server/requestJob", () => ({
    requestJob: async (config: JobConfig) => {
        jobCalls.push(config);
        return jobResult;
    },
}));

const { default: createIgPostMutationOptions } = await import(
    "./createIgPostMutationOptions.ts"
);
const { default: getIgPostQueryOptions } = await import(
    "./getIgPostQueryOptions.ts"
);
const { default: updateIgPostMutationOptions } = await import(
    "./updateIgPostMutationOptions.ts"
);
const { default: createRenderMarkdownMutationOptions } = await import(
    "./createRenderMarkdownMutationOptions.ts"
);

beforeEach(() => {
    jobCalls.length = 0;
    jobResult = undefined;
});

afterEach(() => {
    jobCalls.length = 0;
});

describe("getIgPostQueryOptions", () => {
    test("uses the exact fetch-one query key", () => {
        const options = getIgPostQueryOptions({
            view: "igPosts",
            userId: "user-1",
            itemId: "post-1",
        });
        expect(options.queryKey).toEqual([
            "get",
            "igPosts",
            "one",
            { userId: "user-1" },
            "post-1",
        ]);
    });

    test("equal dependencies produce structurally equal keys", () => {
        const a = getIgPostQueryOptions({
            view: "igPosts",
            userId: "u",
            itemId: "i",
        });
        const b = getIgPostQueryOptions({
            view: "igPosts",
            userId: "u",
            itemId: "i",
        });
        expect(a.queryKey).toEqual(b.queryKey);
    });

    test("queryFn issues GET /api/views/igPosts/one/get/{itemId} through requestJob", async () => {
        jobResult = { post_id: "post-1" };
        const options = getIgPostQueryOptions({
            view: "igPosts",
            userId: "user-1",
            itemId: "post-1",
        });
        await options.queryFn!({} as never);
        expect(jobCalls).toHaveLength(1);
        expect(jobCalls[0].method).toBe("GET");
        expect(jobCalls[0].url).toBe("/api/views/igPosts/one/get/post-1");
    });
});

describe("createIgPostMutationOptions", () => {
    test("mutationFn posts the create payload with multipart content type", async () => {
        const queryClient = new QueryClient();
        const options = createIgPostMutationOptions({
            queryClient,
            view: "igPosts",
        });
        await options.mutationFn!({ p_text_content: "hello" } as never);
        expect(jobCalls).toHaveLength(1);
        expect(String(jobCalls[0].method).toUpperCase()).toBe("POST");
        expect(jobCalls[0].url).toBe("/api/views/igPosts/new/item");
        expect(jobCalls[0].data).toEqual({ p_text_content: "hello" });
        expect(jobCalls[0].headers).toEqual({
            "Content-Type": "multipart/form-data",
        });
    });

    test("onSuccess invalidates the list prefix on the supplied client", () => {
        const queryClient = new QueryClient();
        const invalidate = mock(() => Promise.resolve());
        queryClient.invalidateQueries =
            invalidate as unknown as typeof queryClient.invalidateQueries;
        const options = createIgPostMutationOptions({
            queryClient,
            view: "igPosts",
        });
        options.onSuccess?.(
            undefined,
            { p_text_content: "x" } as never,
            undefined,
            {} as never,
        );
        expect(invalidate).toHaveBeenCalledTimes(1);
        expect(invalidate.mock.calls[0][0]).toEqual({
            queryKey: ["get", "igPosts", "list"],
        });
    });
});

describe("updateIgPostMutationOptions", () => {
    test("mutationFn patches FormData with multipart content type", async () => {
        const queryClient = new QueryClient();
        const options = updateIgPostMutationOptions({
            queryClient,
            view: "igPosts",
            userId: "user-1",
        });
        const data = new FormData();
        data.append("p_post_id", "post-1");
        data.append("p_text_content", "edited");
        await options.mutationFn!(data);
        expect(jobCalls).toHaveLength(1);
        expect(String(jobCalls[0].method).toUpperCase()).toBe("PATCH");
        expect(jobCalls[0].url).toBe("/api/views/igPosts/one/patch");
        expect(jobCalls[0].data).toBe(data);
        expect(jobCalls[0].headers).toEqual({
            "Content-Type": "multipart/form-data",
        });
    });

    test("onSuccess invalidates the owner list key on the supplied client", () => {
        const queryClient = new QueryClient();
        const invalidate = mock(() => Promise.resolve());
        queryClient.invalidateQueries =
            invalidate as unknown as typeof queryClient.invalidateQueries;
        const options = updateIgPostMutationOptions({
            queryClient,
            view: "igPosts",
            userId: "user-9",
        });
        options.onSuccess?.(undefined, new FormData(), undefined, {} as never);
        expect(invalidate).toHaveBeenCalledTimes(1);
        expect(invalidate.mock.calls[0][0]).toEqual({
            queryKey: ["get", "igPosts", "list", { userId: "user-9" }],
        });
    });
});

describe("createRenderMarkdownMutationOptions", () => {
    test("provides a mutationFn and no cache invalidation", () => {
        const options = createRenderMarkdownMutationOptions();
        expect(typeof options.mutationFn).toBe("function");
        expect(options.onSuccess).toBeUndefined();
    });
});
