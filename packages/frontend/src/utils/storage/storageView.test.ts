import { describe, expect, test } from "bun:test";
import {
    canonicalStorageViewPath,
    DEFAULT_STORAGE_VIEW,
    persistedStorageView,
    readStorageViewQuery,
    resolveStorageView,
} from "./storageView.ts";

const preference = "detailed" as const;

describe("drive storage view query", () => {
    test("accepts one canonical value and rejects everything else", () => {
        expect(readStorageViewQuery(new URLSearchParams())).toEqual({
            kind: "missing",
        });
        expect(
            readStorageViewQuery(new URLSearchParams("view=tiles")),
        ).toEqual({ kind: "chosen", view: "tiles" });
        expect(
            readStorageViewQuery(new URLSearchParams("view=detailed")),
        ).toEqual({ kind: "chosen", view: "detailed" });
        for (const search of [
            "view=",
            "view=Detalied",
            "view=tiles ",
            "view=TILES",
            "view=grid",
            "view=tiles&view=tiles",
            "view=tiles&view=detailed",
        ]) {
            expect(readStorageViewQuery(new URLSearchParams(search))).toEqual({
                kind: "unusable",
            });
        }
    });

    test("configurable tabs let one valid query win, then the saved preference", () => {
        expect(
            resolveStorageView({
                tab: "mine",
                params: new URLSearchParams("view=tiles"),
                preference,
            }),
        ).toEqual({ view: "tiles", rewrite: "keep" });
        expect(
            resolveStorageView({
                tab: "shared_with_me",
                params: new URLSearchParams("owner=kept"),
                preference,
            }),
        ).toEqual({ view: "detailed", rewrite: "canonicalize" });
        expect(
            resolveStorageView({
                tab: "mine",
                params: new URLSearchParams("view=nope&view=tiles"),
                preference,
            }),
        ).toEqual({ view: "detailed", rewrite: "canonicalize" });
    });

    test("public is always tiles and drops any view query", () => {
        expect(
            resolveStorageView({
                tab: "public",
                params: new URLSearchParams("owner=kept"),
                preference,
            }),
        ).toEqual({ view: "tiles", rewrite: "keep" });
        expect(
            resolveStorageView({
                tab: "public",
                params: new URLSearchParams("view=detailed&owner=kept"),
                preference,
            }),
        ).toEqual({ view: "tiles", rewrite: "canonicalize" });
        expect(
            resolveStorageView({
                tab: "public",
                params: new URLSearchParams("view=tiles"),
                preference,
            }),
        ).toEqual({ view: "tiles", rewrite: "canonicalize" });
    });

    test("canonical paths preserve unrelated parameters and the fragment", () => {
        const location = {
            pathname: "/drive/mine",
            search: "?owner=kept&view=nope",
            hash: "#files",
        };
        expect(
            canonicalStorageViewPath(location, {
                tab: "mine",
                view: "tiles",
            }),
        ).toBe("/drive/mine?owner=kept&view=tiles#files");
        expect(
            canonicalStorageViewPath(
                {
                    pathname: "/drive/public",
                    search: "?view=detailed&owner=kept",
                    hash: "",
                },
                { tab: "public", view: "tiles" },
            ),
        ).toBe("/drive/public?owner=kept");
    });

    test("a missing or unusable saved preference falls back to tiles", () => {
        expect(DEFAULT_STORAGE_VIEW).toBe("tiles");
        expect(persistedStorageView(undefined)).toBe("tiles");
        expect(persistedStorageView("detailed")).toBe("detailed");
        expect(persistedStorageView("tiles")).toBe("tiles");
        expect(persistedStorageView("grid")).toBe("tiles");
        expect(persistedStorageView("Detailed")).toBe("tiles");
    });
});
