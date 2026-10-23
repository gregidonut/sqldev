import { describe, expect, test } from "bun:test";
import { dStorageThumbnailQueryKey } from "./createThumbnailGet.ts";
import { parseStorageReference } from "./storageReference.ts";
import { splitStorageHtml } from "./splitStorageHtml.ts";
import { useThumbnailRailStore } from "./thumbnailRailStore.ts";

const objectId = "22222222-2222-4222-8222-222222222222";
const revisionId = "33333333-3333-4333-8333-333333333333";

describe("splitStorageHtml", () => {
    test("keeps ordinary markup and reads the label as text", () => {
        const parts = splitStorageHtml(
            `<p>Hi</p><span data-sqldev-storage-object="${objectId}">Cape &amp; Co</span>`,
        );
        expect(parts).toContainEqual({
            kind: "reference",
            storageObjectId: objectId,
            label: "Cape & Co",
        });
        expect(parts.some((part) => part.kind === "html" && part.html.includes("<p>Hi</p>"))).toBe(true);
    });

    test("does not treat a malformed or decorated span as a reference", () => {
        const html = [
            `<span data-sqldev-storage-object="not-a-uuid">x</span>`,
            `<span data-sqldev-storage-object="${objectId}" onclick="evil()">x</span>`,
            `<span data-sqldev-storage-object="${objectId}">![x](uploads://${objectId})</span>`,
        ].join("");
        const references = splitStorageHtml(html).filter(
            (part) => part.kind === "reference",
        );
        expect(references).toHaveLength(1);
        expect(references[0]).toMatchObject({ storageObjectId: objectId });
    });

    test("duplicate references stay separate parts", () => {
        const span = `<span data-sqldev-storage-object="${objectId}">a</span>`;
        const references = splitStorageHtml(span + span).filter(
            (part) => part.kind === "reference",
        );
        expect(references).toHaveLength(2);
    });
});

describe("parseStorageReference", () => {
    test("accepts unavailable and a ready preview, and rejects a storage key", () => {
        expect(parseStorageReference({ kind: "unavailable" })).toEqual({
            kind: "unavailable",
        });
        expect(
            parseStorageReference({
                kind: "ready",
                fileName: "clip.mp4",
                revisionId,
            }),
        ).toEqual({ kind: "ready", fileName: "clip.mp4", revisionId });
        expect(() =>
            parseStorageReference({
                kind: "ready",
                fileName: "clip.mp4",
                revisionId,
                sourceKey: "owner/object/revision/clip.mp4",
            }),
        ).toThrow();
    });
});

describe("thumbnail query identity", () => {
    test("changes with the viewer and stays shared for one revision", () => {
        const resource = {
            kind: "object" as const,
            storageObjectId: objectId,
            revisionId,
        };
        const first = dStorageThumbnailQueryKey(resource, "user-a", "animation");
        const second = dStorageThumbnailQueryKey(resource, "user-b", "animation");
        const repeat = dStorageThumbnailQueryKey(resource, "user-a", "animation");
        expect(first).not.toEqual(second);
        expect(first).toEqual(repeat);
    });
});

describe("thumbnail rail instances", () => {
    test("a stale failure does not reset another instance", () => {
        const store = useThumbnailRailStore.getState();
        store.beginAttempt("tile-a");
        const firstAttempt = store.getTile("tile-a").attempt;
        store.beginAttempt("tile-a");
        const currentAttempt = store.getTile("tile-a").attempt;
        store.beginAttempt("tile-b");
        store.failAttempt("tile-a", firstAttempt, "server");
        expect(store.getTile("tile-a").attempt).toBe(currentAttempt);
        expect(store.getTile("tile-a").lifecycle.state).toBe("initial-wait");
        expect(store.getTile("tile-b").lifecycle.state).toBe("initial-wait");
        store.endAttempt("tile-a");
        store.endAttempt("tile-b");
    });
});
