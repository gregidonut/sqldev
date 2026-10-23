import { describe, expect, test } from "bun:test";
import { unescapeStorageImageSyntax } from "./storageImageSyntax.ts";

const id = "22222222-2222-4222-8222-222222222222";

describe("unescapeStorageImageSyntax", () => {
    test("restores a storage image the visual editor escaped", () => {
        const escaped = `hello\n\\![public clip](uploads://${id.toUpperCase()})`;
        expect(unescapeStorageImageSyntax(escaped)).toBe(
            `hello\n![public clip](uploads://${id})`,
        );
    });

    test("leaves ordinary markdown and code-looking text alone", () => {
        const markdown = "\\\\![x](https://example.com/a.png)\n`\\\\![x](uploads://not-a-uuid)`";
        expect(unescapeStorageImageSyntax(markdown)).toBe(markdown);
    });
});
