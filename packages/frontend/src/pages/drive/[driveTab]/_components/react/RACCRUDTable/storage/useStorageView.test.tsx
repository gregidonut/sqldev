import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useStorageView } from "./useStorageView.ts";
import {
    STORAGE_TABLE_STORAGE_KEY,
    useStorageTableStore,
} from "./store/storageTableStore.ts";

function saved(view: "detailed" | "tiles") {
    return JSON.stringify({
        state: {
            view,
            visibleColumns: ["file_name"],
            sort: { column: "updated_at", direction: "descending" },
        },
        version: 1,
    });
}

type HappyDOM = {
    setURL: (url: string) => void;
    waitUntilComplete: () => Promise<void>;
};

function happyDOM(): HappyDOM {
    return (window as unknown as { happyDOM: HappyDOM }).happyDOM;
}

async function preference(view: "detailed" | "tiles") {
    localStorage.setItem(STORAGE_TABLE_STORAGE_KEY, saved(view));
    await useStorageTableStore.persist.rehydrate();
}

function visit(path: string) {
    happyDOM().setURL(`http://localhost:4321${path}`);
    window.history.replaceState(null, "", path);
}

beforeEach(async () => {
    localStorage.removeItem(STORAGE_TABLE_STORAGE_KEY);
    await preference("tiles");
    visit("/drive/mine?view=tiles");
});

afterEach(() => {
    cleanup();
});

describe("drive view address state", () => {
    test("a valid query wins without replacing the saved preference", async () => {
        await preference("tiles");
        visit("/drive/mine?view=detailed");
        const { result } = renderHook(() => useStorageView("mine"));

        expect(result.current.view).toBe("detailed");
        expect(result.current.showViewOptions).toBe(true);
        await act(async () => {});
        expect(window.location.search).toBe("?view=detailed");
        expect(useStorageTableStore.getState().view).toBe("tiles");
    });

    test("a missing query adopts the saved preference and rewrites the address", async () => {
        await preference("detailed");
        visit("/drive/shared_with_me?owner=kept");
        const { result } = renderHook(() => useStorageView("shared_with_me"));

        await act(async () => {});
        expect(result.current.view).toBe("detailed");
        expect(window.location.pathname).toBe("/drive/shared_with_me");
        expect(window.location.search).toBe("?owner=kept&view=detailed");
    });

    test("an unusable query is replaced from the saved preference", async () => {
        await preference("tiles");
        visit("/drive/mine?view=detailed&view=tiles#files");
        const { result } = renderHook(() => useStorageView("mine"));

        await act(async () => {});
        expect(result.current.view).toBe("tiles");
        expect(window.location.pathname + window.location.search + window.location.hash).toBe(
            "/drive/mine?view=tiles#files",
        );
    });

    test("choosing a view saves it and adds a history entry that back restores", async () => {
        visit("/drive/mine?view=tiles");
        const { result } = renderHook(() => useStorageView("mine"));
        const before = window.history.length;

        await act(async () => {
            result.current.selectView("detailed");
        });
        expect(window.location.search).toBe("?view=detailed");
        expect(useStorageTableStore.getState().view).toBe("detailed");
        expect(window.history.length).toBe(before + 1);

        await act(async () => {
            window.history.back();
            await happyDOM().waitUntilComplete();
        });
        expect(window.location.search).toBe("?view=tiles");
        expect(result.current.view).toBe("tiles");
        expect(useStorageTableStore.getState().view).toBe("detailed");

        await act(async () => {
            window.history.forward();
            await happyDOM().waitUntilComplete();
        });
        expect(result.current.view).toBe("detailed");
    });

    test("public forces tiles, removes the query, and leaves the preference untouched", async () => {
        await preference("detailed");
        visit("/drive/public?view=detailed&owner=kept");
        const { result } = renderHook(() => useStorageView("public"));

        expect(result.current.view).toBe("tiles");
        expect(result.current.showViewOptions).toBe(false);
        await act(async () => {
            result.current.selectView("detailed");
        });
        expect(window.location.pathname + window.location.search).toBe(
            "/drive/public?owner=kept",
        );
        expect(useStorageTableStore.getState().view).toBe("detailed");
    });
});
