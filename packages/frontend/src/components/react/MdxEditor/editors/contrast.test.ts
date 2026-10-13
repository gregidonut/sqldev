import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Requirement 4: the editable surface is darker than its surrounding chrome,
 * using only Dracula tokens.
 *
 * `--color-drac-background` (#282a36) is the darkest surface token; the editable
 * region keeps it while the chrome moves to `--color-drac-selection` (#44475a).
 * These assertions pin the token choices in both the CodeMirror theme (Vim
 * adapter) and the scoped CSS (visual adapter), guarding against regressions.
 * Live computed-style verification of the real editors stays in Cypress.
 */
const BACKGROUND = "#282a36";
const SELECTION = "#44475a";

function readRelative(relative: string): string {
    const url = new URL(relative, import.meta.url);
    return readFileSync(fileURLToPath(url), "utf8");
}

describe("Requirement 4: Vim adapter contrast tokens (codeMirrorTheme.ts)", () => {
    const theme = readRelative("./codeMirrorTheme.ts");

    test("the content/scroller typing area uses the darkest background token", () => {
        // Both .cm-content and .cm-scroller carry the darker inset background.
        const contentBlock = theme.slice(theme.indexOf('".cm-content"'));
        expect(contentBlock).toContain("backgroundColor: drac.background");
        const scrollerBlock = theme.slice(theme.indexOf('".cm-scroller"'));
        expect(scrollerBlock).toContain("backgroundColor: drac.background");
    });

    test("the editor chrome and gutters use the lighter selection token", () => {
        // The outer "&" frame uses selection; gutters use selection.
        const guttersBlock = theme.slice(theme.indexOf('".cm-gutters"'));
        expect(guttersBlock).toContain("backgroundColor: drac.selection");
    });

    test("the token values resolve to the expected Dracula hexes", () => {
        expect(theme).toContain(`background: "${BACKGROUND}"`);
        expect(theme).toContain(`selection: "${SELECTION}"`);
    });
});

describe("Requirement 4: visual adapter contrast tokens (mdxEditor.css)", () => {
    const css = readRelative("../mdxEditor.css");

    test("the editable content region uses the darkest background token", () => {
        const contentBlock = css.slice(
            css.indexOf("The editable typing area is the darkest token"),
        );
        expect(contentBlock).toContain(
            "background-color: var(--color-drac-background)",
        );
    });

    test("the surrounding visual-editor chrome uses the selection token", () => {
        // Target the theming block (identified by its unique comment), not the
        // sizing rules that also match ".mdx-visual-editor".
        const themingStart = css.indexOf("Chrome band around the editable");
        expect(themingStart).toBeGreaterThan(-1);
        const chromeBlock = css.slice(
            themingStart,
            css.indexOf("The editable typing area is the darkest token"),
        );
        expect(chromeBlock).toContain(
            "background-color: var(--color-drac-selection)",
        );
    });
});
