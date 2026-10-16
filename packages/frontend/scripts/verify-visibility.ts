/**
 * Validation runner for the storage-visibility-confirmation feature.
 *
 *   bun run packages/frontend/scripts/verify-visibility.ts [--only a,b] [--skip a,b] [--with-db-reset]
 *
 * Runs each named command from the workspace root in order, prints pass/fail
 * per command, collects the `Property N` tags from passing test output, and
 * fails when any of properties 1–15 did not execute.
 *
 * Needs the local Supabase stack (port 54322) and, for `sqldev` commands,
 * AWS_PROFILE / AWS_REGION in the environment. `db-reset` wipes local app data,
 * so it only runs with --with-db-reset.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const FRONTEND = resolve(ROOT, "packages/frontend");
const GOAPI = resolve(ROOT, "packages/functions/cmd/goapi");
const GEN = resolve(GOAPI, "api/api.gen.go");
const MODELS = resolve(FRONTEND, "src/utils/supabase/models/index.ts");
const DB_URL =
    process.env.SQLDEV_TEST_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const LOG_DIR = "/tmp/verify-visibility";
const PROPERTY_COUNT = 15;
const TAG = /storage-visibility-confirmation,[ _]Property[ _](\d+)/;

/** Files whose type errors predate this feature; any other file is a failure. */
const TSC_BASELINE_FILES = new Set([
    "src/components/react/MdxEditor/queryOptions/igPostQueryOptions.test.ts",
    "src/components/react/MdxEditor/queryOptions/queryOptions.property.test.ts",
    "src/components/ui/Tree.tsx",
    "src/server/requestJob.ts",
    "src/utils/cy/index.ts",
]);

interface Outcome {
    ok: boolean;
    output: string;
    detail?: string;
}

interface Step {
    name: string;
    optIn?: boolean;
    run: () => Promise<Outcome>;
}

async function exec(
    cmd: string[],
    cwd: string,
    env: Record<string, string> = {},
): Promise<{ code: number; output: string; stdout: string }> {
    const proc = Bun.spawn(cmd, {
        cwd,
        env: { ...process.env, ...env },
        stdout: "pipe",
        stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    return { code, output: `${out}\n${err}`, stdout: out };
}

const sha = (path: string) =>
    createHash("sha256").update(readFileSync(path)).digest("hex");

const goEnv = { CGO_ENABLED: "0" };

const steps: Step[] = [
    {
        name: "go-generate-clean",
        run: async () => {
            const before = sha(GEN);
            const r = await exec(["go", "generate", "./..."], GOAPI, goEnv);
            // api.gen.go is compared with its own pre-generate bytes so the check
            // also holds while the change is still uncommitted.
            const same = sha(GEN) === before;
            return {
                ok: r.code === 0 && same,
                output: r.output,
                detail: same ? undefined : "api.gen.go changed after generate",
            };
        },
    },
    {
        name: "go-test",
        run: async () => {
            const r = await exec(
                ["go", "-C", "packages/functions", "test", "-v", "-count=1", "./..."],
                ROOT,
                goEnv,
            );
            return { ok: r.code === 0, output: r.output };
        },
    },
    {
        name: "go-integration",
        run: async () => {
            const r = await exec(
                [
                    "go", "-C", "packages/functions", "test", "-v", "-tags", "integration",
                    "-count=1", "-p", "1",
                    "./internal/sqldb/", "./cmd/supabaseworker/", "./cmd/goapi/api/",
                ],
                ROOT,
                { ...goEnv, SQLDEV_TEST_DATABASE_URL: DB_URL },
            );
            return { ok: r.code === 0, output: r.output };
        },
    },
    {
        name: "db-reset",
        optIn: true,
        run: async () => {
            const r = await exec(
                ["sqldev", "--stage", "dev", "supabase", "db", "reset"],
                ROOT,
            );
            return { ok: r.code === 0, output: r.output };
        },
    },
    {
        name: "supabase-types-clean",
        run: async () => {
            const r = await exec(
                ["sqldev", "--stage", "dev", "supabase", "gen", "types", "typescript", "--local"],
                ROOT,
            );
            const same = r.stdout.trimEnd() === readFileSync(MODELS, "utf8").trimEnd();
            return {
                ok: r.code === 0 && same,
                output: r.output.slice(-2000),
                detail: same ? undefined : "generated types differ from models/index.ts",
            };
        },
    },
    {
        name: "frontend-typecheck",
        run: async () => {
            const r = await exec(["bunx", "tsc", "--noEmit", "-p", "tsconfig.json"], FRONTEND);
            const offenders = r.output
                .split("\n")
                .filter((line) => /error TS\d+/.test(line))
                .map((line) => line.split("(")[0])
                .filter((file) => !TSC_BASELINE_FILES.has(file));
            return {
                ok: offenders.length === 0,
                output: r.output,
                detail: offenders.length ? `new type errors in: ${[...new Set(offenders)].join(", ")}` : undefined,
            };
        },
    },
    {
        name: "frontend-test",
        run: async () => {
            const r = await exec(["bun", "test"], FRONTEND);
            return { ok: r.code === 0, output: r.output };
        },
    },
    {
        name: "astro-build",
        run: async () => {
            const r = await exec(["bun", "run", "build"], FRONTEND);
            // `astro build` rewrites node_modules/.vite, which a running
            // `astro dev` shares; touching the config makes dev restart and
            // re-optimize so the browser steps that follow stay healthy.
            await exec(["touch", "astro.config.mjs"], FRONTEND);
            await Bun.sleep(15_000);
            return { ok: r.code === 0, output: r.output };
        },
    },
    {
        name: "cypress-visibility",
        run: async () => {
            const r = await exec(
                [
                    "sqldev", "--stage", "dev", "cypress", "run", "--headless", "--browser",
                    "chrome", "--spec", "cypress/e2e/driveVisibility.cy.ts",
                ],
                ROOT,
            );
            return { ok: r.code === 0, output: r.output };
        },
    },
];

/** Property numbers whose tagged test reported a pass in `output`. */
export function passedProperties(output: string): Map<number, Set<string>> {
    const found = new Map<number, Set<string>>();
    for (const line of output.split("\n")) {
        const isPass = /--- PASS:|^\s*\(pass\)|^\s*✓/.test(line);
        const match = TAG.exec(line);
        if (!isPass || match === null) continue;
        const n = Number(match[1]);
        const bindings = found.get(n) ?? new Set<string>();
        if (/TypeScript[ _]binding/.test(line)) bindings.add("ts");
        else if (/Go[ _]binding/.test(line)) bindings.add("go");
        else bindings.add("single");
        found.set(n, bindings);
    }
    return found;
}

/** Numbers in 1..count that did not run; property 15 needs both bindings. */
export function missingProperties(
    found: Map<number, Set<string>>,
    count = PROPERTY_COUNT,
): number[] {
    const missing: number[] = [];
    for (let n = 1; n <= count; n++) {
        const bindings = found.get(n);
        const complete =
            n === 15 ? bindings?.has("ts") === true && bindings.has("go") : bindings !== undefined;
        if (!complete) missing.push(n);
    }
    return missing;
}

function flag(name: string): string[] {
    const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
    const idx = process.argv.indexOf(`--${name}`);
    const raw = arg?.split("=")[1] ?? (idx >= 0 ? process.argv[idx + 1] : undefined);
    return raw ? raw.split(",") : [];
}

async function main(): Promise<number> {
    const only = flag("only");
    const skip = new Set(flag("skip"));
    const withReset = process.argv.includes("--with-db-reset");
    const found = new Map<number, Set<string>>();
    let failed = false;
    let partial = false;

    for (const step of steps) {
        if ((only.length && !only.includes(step.name)) || skip.has(step.name) || (step.optIn && !withReset)) {
            console.log(`skip  ${step.name}${step.optIn ? " (needs --with-db-reset)" : ""}`);
            partial = true;
            continue;
        }
        const started = Date.now();
        const outcome = await step.run();
        for (const [n, bindings] of passedProperties(outcome.output)) {
            const merged = found.get(n) ?? new Set<string>();
            for (const b of bindings) merged.add(b);
            found.set(n, merged);
        }
        mkdirSync(LOG_DIR, { recursive: true });
        writeFileSync(`${LOG_DIR}/${step.name}.log`, outcome.output);
        const secs = ((Date.now() - started) / 1000).toFixed(1);
        console.log(`${outcome.ok ? "pass" : "FAIL"}  ${step.name} (${secs}s)${outcome.detail ? ` — ${outcome.detail}` : ""}`);
        if (!outcome.ok) {
            failed = true;
            const lines = outcome.output.split("\n");
            const failing = lines.filter((l) => /--- FAIL|^FAIL|panic:|\(fail\)|error TS|✖|^\s+\d+\) /.test(l));
            console.log((failing.length ? failing.slice(0, 30) : lines.slice(-30)).join("\n"));
            console.log(`      full output: ${LOG_DIR}/${step.name}.log`);
        }
    }

    for (let n = 1; n <= PROPERTY_COUNT; n++) {
        console.log(`${found.has(n) ? "pass" : "----"}  property ${n}`);
    }
    const missing = missingProperties(found);
    if (missing.length && !partial) {
        failed = true;
        console.log(`FAIL  properties that did not execute: ${missing.join(", ")}`);
    } else if (missing.length) {
        console.log(`note  properties not seen in this partial run: ${missing.join(", ")}`);
    }
    return failed ? 1 : 0;
}

if (import.meta.main) process.exit(await main());
