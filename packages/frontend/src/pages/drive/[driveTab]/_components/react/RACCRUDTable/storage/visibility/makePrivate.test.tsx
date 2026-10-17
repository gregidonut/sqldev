import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useConfirmationStore } from "@/utils/confirmation/confirmationStore";
import type { StorageRow } from "../../queryOptions/types.ts";

// The hook submits through requestJob; replace it so no network is used.
type Call = { config: { url?: string; data?: unknown; headers?: unknown } };
const calls: Call[] = [];
let responder: (call: Call) => unknown = () => ({});

mock.module("@/server/requestJob", () => ({
    requestJob: async (config: Call["config"]) => {
        const call = { config };
        calls.push(call);
        return responder(call);
    },
}));

const { useStorageVisibility } = await import("./useStorageVisibility.ts");

const OBJECT = "5b1f7f0e-0c4a-4f7e-9a63-2f4f6a1d9b11";

function row(isPublic: boolean): StorageRow {
    return {
        storage_object_id: OBJECT,
        user_id: "11111111-1111-4111-8111-111111111111",
        clerk_user_id: "user_1",
        created_at: "2026-10-14T00:00:00Z",
        updated_at: "2026-10-14T00:00:00Z",
        s3_object_key: "u/o/d/report.pdf",
        file_name: "report.pdf",
        public: isPublic,
        config_version: 4,
    };
}

function setup(tab: "mine" | "public" = "mine") {
    const client = new QueryClient({
        defaultOptions: { mutations: { retry: false } },
    });
    const invalidations: unknown[] = [];
    client.invalidateQueries = (async (filters?: unknown) => {
        invalidations.push(filters);
    }) as typeof client.invalidateQueries;
    const errors: (string | null)[] = [];
    const view = renderHook(
        () =>
            useStorageVisibility({
                tab,
                bucketName: "bucket",
                userId: "user_1",
                onError: (message) => errors.push(message),
            }),
        {
            wrapper: ({ children }: { children: React.ReactNode }) => (
                <QueryClientProvider client={client}>
                    {children}
                </QueryClientProvider>
            ),
        },
    );
    return { view, invalidations, errors };
}

const changedResult = {
    kind: "visibility_changed",
    target: { type: "storage_object", id: OBJECT },
    visibility: "private",
    revision: 5,
};

beforeEach(() => {
    calls.length = 0;
    responder = () => changedResult;
    useConfirmationStore.getState().close();
});
afterEach(() => cleanup());

describe("making an object private", () => {
    test("sends one request, opens no dialog, and refreshes the lists once", async () => {
        const { view, invalidations, errors } = setup();
        act(() => view.result.current.invoke(row(true), null));
        await waitFor(() => expect(invalidations).toHaveLength(1));

        expect(calls).toHaveLength(1);
        expect(calls[0]!.config.url).toBe(
            "/api/storage/buckets/bucket/objects/visibility",
        );
        expect(calls[0]!.config.data).toEqual({
            target: { type: "storage_object", id: OBJECT },
            expectedRevision: 4,
            visibility: "private",
        });
        expect(useConfirmationStore.getState().state.tag).toBe("closed");
        expect(errors.filter((e) => e !== null)).toHaveLength(0);
    });

    test("each invocation gets its own idempotency key", async () => {
        const { view, invalidations } = setup();
        act(() => view.result.current.invoke(row(true), null));
        await waitFor(() => expect(invalidations).toHaveLength(1));
        act(() => view.result.current.invoke(row(true), null));
        await waitFor(() => expect(invalidations).toHaveLength(2));
        const keys = calls.map(
            (c) =>
                (c.config.headers as Record<string, string>)["Idempotency-Key"],
        );
        expect(keys).toHaveLength(2);
        expect(new Set(keys).size).toBe(2);
    });

    test("a rejection shows advice and refreshes nothing", async () => {
        responder = () => ({ kind: "rejected", reason: "stale_revision" });
        const { view, invalidations, errors } = setup();
        act(() => view.result.current.invoke(row(true), null));
        await waitFor(() =>
            expect(errors.some((e) => e?.includes("changed since"))).toBe(true),
        );
        expect(invalidations).toHaveLength(0);
    });

    test("a forbidden rejection says so and refreshes nothing", async () => {
        responder = () => ({ kind: "rejected", reason: "forbidden" });
        const { view, invalidations, errors } = setup();
        act(() => view.result.current.invoke(row(true), null));
        await waitFor(() =>
            expect(errors.some((e) => e?.includes("can't change"))).toBe(true),
        );
        expect(invalidations).toHaveLength(0);
    });

    test("a failed request shows an error and refreshes nothing", async () => {
        responder = () => {
            throw new Error("network");
        };
        const { view, invalidations, errors } = setup();
        act(() => view.result.current.invoke(row(true), null));
        await waitFor(() =>
            expect(errors.some((e) => e?.includes("Could not"))).toBe(true),
        );
        expect(invalidations).toHaveLength(0);
    });

    test("a malformed result is an error, never a success", async () => {
        responder = () => ({ kind: "visibility_changed" });
        const { view, invalidations, errors } = setup();
        act(() => view.result.current.invoke(row(true), null));
        await waitFor(() =>
            expect(errors.some((e) => e?.includes("Could not"))).toBe(true),
        );
        expect(invalidations).toHaveLength(0);
    });

    test("making public opens the dialog and sends only the initiation, never a confirmation", async () => {
        const { view } = setup();
        // The registered adapter will answer the initiation with a challenge.
        responder = () => ({
            kind: "confirmation_required",
            registryId: "1000",
            operationKind: "storage.visibility.make_public",
            target: { type: "storage_object", id: OBJECT },
            expectedRevision: 4,
            challengeId: "0d7e1c52-8b0e-4a53-b3a4-1c9d2a6f7e90",
            proof: "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCde",
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
            dialogCopy: {
                title: "Make “report.pdf” public?",
                description: "Anyone signed in will be able to see this file.",
                confirmLabel: "Make public",
            },
        });
        act(() => view.result.current.invoke(row(false), null));
        expect(useConfirmationStore.getState().state.tag).toBe("requesting");
        await waitFor(() =>
            expect(useConfirmationStore.getState().state.tag).toBe(
                "confirmation-ready",
            ),
        );

        // One request so far: the initiation, asking for "public". No confirmation yet,
        // and the dialog is now waiting on the person with nothing held on the server.
        expect(calls).toHaveLength(1);
        expect(calls[0]!.config.url).toBe(
            "/api/storage/buckets/bucket/objects/visibility",
        );
        expect(
            (calls[0]!.config.data as { visibility: string }).visibility,
        ).toBe("public");
        expect(calls.some((c) => c.config.url === "/api/confirmations")).toBe(
            false,
        );
    });

    test("nothing happens off the owner's tab", () => {
        const { view } = setup("public");
        expect(view.result.current.actionFor(row(false))).toBeNull();
        act(() => view.result.current.invoke(row(false), null));
        expect(calls).toHaveLength(0);
        expect(useConfirmationStore.getState().state.tag).toBe("closed");
    });

    test("a row with an invalid revision is refused, not guessed", () => {
        const { view, errors } = setup();
        act(() =>
            view.result.current.invoke(
                { ...row(true), config_version: 0 },
                null,
            ),
        );
        expect(calls).toHaveLength(0);
        expect(errors.some((e) => e?.includes("Could not"))).toBe(true);
    });
});
