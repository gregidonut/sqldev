import { beforeEach, describe, expect, mock, test } from "bun:test";
import fc from "fast-check";
import { QueryClient } from "@tanstack/react-query";

type JobConfig = {
    method?: string;
    url?: string;
    data?: unknown;
    headers?: unknown;
};

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

beforeEach(() => {
    jobCalls.length = 0;
    jobResult = undefined;
});

const RUNS = { numRuns: 100 } as const;

// Property 13: Pure Factories — equal dependencies produce equivalent query
// keys and request semantics, with no ambient React/Zustand access.
describe("Property 13: pure factories", () => {
    test("getIgPostQueryOptions is deterministic for equal dependencies", () => {
        fc.assert(
            fc.property(
                fc.string(),
                fc.string(),
                (userId, itemId) => {
                    const a = getIgPostQueryOptions({
                        view: "igPosts",
                        userId,
                        itemId,
                    });
                    const b = getIgPostQueryOptions({
                        view: "igPosts",
                        userId,
                        itemId,
                    });
                    expect(a.queryKey).toEqual(b.queryKey);
                    expect(a.queryKey).toEqual([
                        "get",
                        "igPosts",
                        "one",
                        { userId },
                        itemId,
                    ]);
                },
            ),
            RUNS,
        );
    });
});

// Property 14: Cache Continuity — success invalidates exactly the existing list
// scope on the supplied client; failure invalidates nothing.
describe("Property 14: cache continuity", () => {
    test("create success invalidates only the list prefix", () => {
        fc.assert(
            fc.property(fc.string(), (text) => {
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
                    { p_text_content: text } as never,
                    undefined,
                    {} as never,
                );
                expect(invalidate).toHaveBeenCalledTimes(1);
                expect(invalidate.mock.calls[0][0]).toEqual({
                    queryKey: ["get", "igPosts", "list"],
                });
            }),
            RUNS,
        );
    });

    test("update success invalidates only the owner list key", () => {
        fc.assert(
            fc.property(fc.string(), (userId) => {
                const queryClient = new QueryClient();
                const invalidate = mock(() => Promise.resolve());
                queryClient.invalidateQueries =
                    invalidate as unknown as typeof queryClient.invalidateQueries;
                const options = updateIgPostMutationOptions({
                    queryClient,
                    view: "igPosts",
                    userId,
                });
                options.onSuccess?.(
                    undefined,
                    new FormData(),
                    undefined,
                    {} as never,
                );
                expect(invalidate).toHaveBeenCalledTimes(1);
                expect(invalidate.mock.calls[0][0]).toEqual({
                    queryKey: ["get", "igPosts", "list", { userId }],
                });
            }),
            RUNS,
        );
    });
});

// Property 15: Request Continuity — create/update always use the preserved
// method, URL, payload, and multipart header.
describe("Property 15: request continuity", () => {
    test("create posts the exact payload and headers", async () => {
        await fc.assert(
            fc.asyncProperty(fc.string(), async (text) => {
                jobCalls.length = 0;
                const queryClient = new QueryClient();
                const options = createIgPostMutationOptions({
                    queryClient,
                    view: "igPosts",
                });
                await options.mutationFn!({ p_text_content: text } as never);
                expect(jobCalls).toHaveLength(1);
                expect(String(jobCalls[0].method).toUpperCase()).toBe("POST");
                expect(jobCalls[0].url).toBe("/api/views/igPosts/new/item");
                expect(jobCalls[0].data).toEqual({ p_text_content: text });
                expect(jobCalls[0].headers).toEqual({
                    "Content-Type": "multipart/form-data",
                });
            }),
            RUNS,
        );
    });

    test("update patches FormData with the exact entries and headers", async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string(),
                fc.string(),
                async (postId, text) => {
                    jobCalls.length = 0;
                    const queryClient = new QueryClient();
                    const options = updateIgPostMutationOptions({
                        queryClient,
                        view: "igPosts",
                        userId: "u",
                    });
                    const data = new FormData();
                    data.append("p_post_id", postId);
                    data.append("p_text_content", text);
                    await options.mutationFn!(data);
                    expect(jobCalls).toHaveLength(1);
                    expect(String(jobCalls[0].method).toUpperCase()).toBe(
                        "PATCH",
                    );
                    expect(jobCalls[0].url).toBe(
                        "/api/views/igPosts/one/patch",
                    );
                    const sent = jobCalls[0].data as FormData;
                    expect(sent.get("p_post_id")).toBe(postId);
                    expect(sent.get("p_text_content")).toBe(text);
                    expect(jobCalls[0].headers).toEqual({
                        "Content-Type": "multipart/form-data",
                    });
                },
            ),
            RUNS,
        );
    });
});
