import { describe, expect, test } from "bun:test";
import { mapBrowserApiPath } from "./mapBrowserApiPath.ts";

describe("mapBrowserApiPath", () => {
    test("rewrites exactly /api/renderMd to /renderMd", () => {
        expect(mapBrowserApiPath("/api/renderMd")).toBe("/renderMd");
    });

    test("leaves non-matching paths unchanged", () => {
        for (const p of [
            "/api/renderMd/", // trailing slash
            "/api/rendermd", // case variant
            "/api/renderMdx", // sibling suffix
            "/api/renderMd/child", // child path
            "/api/jobs/123", // unrelated api route
            "/renderMd", // already upstream
            "/", // root
        ]) {
            expect(mapBrowserApiPath(p)).toBe(p);
        }
    });

    test("preserving a URL's query is the caller's job; mapping only touches the pathname", () => {
        // The function receives only a pathname, so a query cannot be altered.
        expect(mapBrowserApiPath("/api/renderMd")).toBe("/renderMd");
    });
});
