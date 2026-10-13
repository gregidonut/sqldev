import { describe, expect, test } from "bun:test";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";

/**
 * Property 18: Todo Independence.
 *
 * No Todo module may import, directly or transitively, from the reusable MDX
 * editor query option library. This guards the design boundary that the editor
 * owns Instagram query factories while Todo keeps its own in a neutral place.
 */

const FRONTEND_SRC = resolve(import.meta.dir, "../../../..");
const EDITOR_QUERY_DIR = resolve(import.meta.dir);

const TODO_ENTRY_POINTS = [
    "pages/todos/_components/react/FormSection/FormSection.tsx",
    "pages/todos/space/_components/react/NewTodoButton/FormSection/index.tsx",
].map((p) => join(FRONTEND_SRC, p));

const IMPORT_RE = /(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g;
const BARE_IMPORT_RE = /import\s*["']([^"']+)["']/g;

async function fileExists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

async function resolveModule(
    specifier: string,
    fromFile: string,
): Promise<string | null> {
    let base: string | null = null;
    if (specifier.startsWith("@/")) {
        base = join(FRONTEND_SRC, specifier.slice(2));
    } else if (specifier.startsWith(".")) {
        base = resolve(dirname(fromFile), specifier);
    } else {
        return null; // external package
    }

    const candidates = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        join(base, "index.ts"),
        join(base, "index.tsx"),
    ];
    for (const candidate of candidates) {
        if (extname(candidate) && (await fileExists(candidate))) {
            try {
                const s = await stat(candidate);
                if (s.isFile()) return candidate;
            } catch {
                /* ignore */
            }
        }
    }
    return null;
}

async function collectImports(file: string): Promise<string[]> {
    const source = await readFile(file, "utf8");
    const specifiers: string[] = [];
    for (const match of source.matchAll(IMPORT_RE)) {
        specifiers.push(match[1]);
    }
    for (const match of source.matchAll(BARE_IMPORT_RE)) {
        specifiers.push(match[1]);
    }
    return specifiers;
}

async function transitiveFiles(entryPoints: string[]): Promise<Set<string>> {
    const seen = new Set<string>();
    const queue = [...entryPoints];
    while (queue.length > 0) {
        const current = queue.pop()!;
        if (seen.has(current)) continue;
        seen.add(current);
        let specifiers: string[];
        try {
            specifiers = await collectImports(current);
        } catch {
            continue;
        }
        for (const specifier of specifiers) {
            const resolved = await resolveModule(specifier, current);
            if (resolved && !seen.has(resolved)) {
                queue.push(resolved);
            }
        }
    }
    return seen;
}

describe("Property 18: Todo independence", () => {
    test("Todo entry points exist", async () => {
        for (const entry of TODO_ENTRY_POINTS) {
            expect(await fileExists(entry)).toBe(true);
        }
    });

    test("no Todo module transitively imports the editor query library", async () => {
        const reached = await transitiveFiles(TODO_ENTRY_POINTS);
        const offenders = [...reached].filter((file) =>
            file.startsWith(EDITOR_QUERY_DIR),
        );
        expect(offenders).toEqual([]);
    });
});
