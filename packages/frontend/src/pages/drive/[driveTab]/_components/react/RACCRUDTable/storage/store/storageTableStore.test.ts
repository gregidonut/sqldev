import { beforeEach, describe, expect, test } from "bun:test";
import {
    STORAGE_TABLE_STORAGE_KEY,
    useStorageTableStore,
} from "./storageTableStore.ts";

function saved(view: unknown) {
    return JSON.stringify({
        state: {
            view,
            visibleColumns: ["file_name", "public"],
            sort: { column: "updated_at", direction: "descending" },
        },
        version: 1,
    });
}

describe("storage table preference", () => {
    beforeEach(() => {
        localStorage.removeItem(STORAGE_TABLE_STORAGE_KEY);
    });

    test("keeps a saved detailed layout and replaces an unusable one with tiles", async () => {
        localStorage.setItem(STORAGE_TABLE_STORAGE_KEY, saved("detailed"));
        await useStorageTableStore.persist.rehydrate();
        expect(useStorageTableStore.getState().view).toBe("detailed");

        localStorage.setItem(STORAGE_TABLE_STORAGE_KEY, saved("grid"));
        await useStorageTableStore.persist.rehydrate();
        expect(useStorageTableStore.getState().view).toBe("tiles");

        localStorage.setItem(STORAGE_TABLE_STORAGE_KEY, saved("detailed"));
        await useStorageTableStore.persist.rehydrate();
        expect(useStorageTableStore.getState().view).toBe("detailed");
    });
});
