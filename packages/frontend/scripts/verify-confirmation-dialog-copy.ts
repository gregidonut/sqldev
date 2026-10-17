/**
 * Validation runner for the confirmation-dialog-copy feature.
 *
 *   bun run packages/frontend/scripts/verify-confirmation-dialog-copy.ts \
 *       [--only a,b] [--skip a,b] [--with-build] [--with-cypress]
 *
 * Runs each named command from the workspace root in order, prints pass/fail per
 * command and per category, collects the `Feature: confirmation-dialog-copy,
 * Property N` tags from test output, and requires properties 1-5 (Property 3 in both
 * its Go and TypeScript bindings). The decision lives in `verifyCopyAccounting.ts`.
 *
 * Exit status: 0 pass, 1 fail (a failed or missing command or property), 2 incomplete
 * (nothing failed, but a command was skipped). A skipped command is never a pass.
 *
 * Needs the local Supabase stack (port 54322). `migration-apply` and `cypress-visibility`
 * go through `sqldev`; AWS_PROFILE / AWS_REGION default to the documented dev profile. Nothing here resets a database.
 * `astro-build` (--with-build) rewrites node_modules/.vite, which a running `astro dev`
 * shares, so it is skipped by default; the runner touches astro.config.mjs afterwards.
 * `cypress-visibility` (--with-cypress) truncates local application data, so it is
 * skipped by default as well.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
    account,
    categorySummary,
    type CommandResult,
    exitCodeFor,
    formatReport,
    goJsonToText,
    knownTypeErrorCount,
    type Observation,
    parseBunVerbose,
    parseGoJson,
    PROPERTY_COUNT,
    unexpectedTypeErrorFiles,
} from "./verifyCopyAccounting";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const FRONTEND = resolve(ROOT, "packages/frontend");
const GOAPI = resolve(ROOT, "packages/functions/cmd/goapi");
const GEN = resolve(GOAPI, "api/api.gen.go");
const DB_URL =
    process.env.SQLDEV_TEST_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const LOG_DIR = "/tmp/verify-confirmation-dialog-copy";
const BASELINE_SPEC = ".kiro/specs/storage-visibility-confirmation";

interface Outcome {
    ok: boolean;
    output: string;
    detail?: string;
    observations?: Observation[];
}

type OptIn = "--with-build" | "--with-cypress";

interface Step {
    name: string;
    category: string;
    optIn?: OptIn;
    run: () => Promise<Outcome>;
}

async function exec(
    cmd: string[],
    cwd: string,
    env: Record<string, string> = {},
): Promise<{ code: number; output: string; stdout: string; stderr: string }> {
    try {
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
        return { code, output: `${out}\n${err}`, stdout: out, stderr: err };
    } catch (error) {
        // A missing executable is a command that did not run, reported as a failure.
        const output = `could not run ${cmd[0]}: ${String(error)}`;
        return { code: 127, output, stdout: "", stderr: output };
    }
}

const sha = (path: string) =>
    createHash("sha256").update(readFileSync(path)).digest("hex");

const goEnv = { CGO_ENABLED: "0" };
// `sqldev` re-executes through `sst shell`, which needs the documented AWS profile.
const sqldevEnv = {
    AWS_PROFILE: process.env.AWS_PROFILE ?? "folio_api_admin",
    AWS_REGION: process.env.AWS_REGION ?? "ap-east-1",
};

const steps: Step[] = [
    {
        name: "migration-apply",
        category: "database",
        run: async () => {
            const r = await exec(
                ["sqldev", "--stage", "dev", "supabase", "migration", "up", "--local"],
                ROOT,
                sqldevEnv,
            );
            return { ok: r.code === 0, output: r.output };
        },
    },
    {
        name: "go-generate-clean",
        category: "go",
        run: async () => {
            const before = sha(GEN);
            const r = await exec(["go", "generate", "./..."], GOAPI, goEnv);
            // api.gen.go is compared with its own pre-generate bytes so the check also
            // holds while the change is still uncommitted.
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
        category: "go",
        run: async () => {
            const r = await exec(
                ["go", "-C", "packages/functions", "test", "-json", "-count=1", "./..."],
                ROOT,
                goEnv,
            );
            return {
                ok: r.code === 0,
                output: `${goJsonToText(r.stdout)}\n${r.stderr}`,
                observations: parseGoJson(r.stdout),
            };
        },
    },
    {
        name: "go-integration",
        category: "database",
        run: async () => {
            const r = await exec(
                [
                    "go", "-C", "packages/functions", "test", "-json", "-tags", "integration",
                    "-count=1", "-p", "1", "./internal/sqldb/", "./cmd/supabaseworker/",
                ],
                ROOT,
                { ...goEnv, SQLDEV_TEST_DATABASE_URL: DB_URL },
            );
            return {
                ok: r.code === 0,
                output: `${goJsonToText(r.stdout)}\n${r.stderr}`,
                observations: parseGoJson(r.stdout),
            };
        },
    },
    {
        name: "frontend-typecheck",
        category: "frontend",
        run: async () => {
            const r = await exec(["bunx", "tsc", "--noEmit", "-p", "tsconfig.json"], FRONTEND);
            const offenders = unexpectedTypeErrorFiles(r.output);
            const known = knownTypeErrorCount(r.output);
            const notes = [
                offenders.length ? `new type errors in: ${offenders.join(", ")}` : "",
                known ? `${known} known unrelated type errors reported, not counted` : "",
            ].filter(Boolean);
            return {
                ok: offenders.length === 0 && (r.code === 0 || known > 0),
                output: r.output,
                detail: notes.length ? notes.join("; ") : undefined,
            };
        },
    },
    {
        name: "frontend-test",
        category: "frontend",
        run: async () => {
            const r = await exec(["bun", "test"], FRONTEND);
            return { ok: r.code === 0, output: r.output, observations: parseBunVerbose(r.output) };
        },
    },
    {
        name: "astro-build",
        category: "frontend",
        optIn: "--with-build",
        run: async () => {
            const r = await exec(["bun", "run", "build"], FRONTEND);
            // `astro build` rewrites node_modules/.vite, which a running `astro dev`
            // shares; touching the config makes dev restart and re-optimize.
            await exec(["touch", "astro.config.mjs"], FRONTEND);
            await Bun.sleep(15_000);
            return { ok: r.code === 0, output: r.output };
        },
    },
    {
        name: "cypress-visibility",
        category: "e2e",
        optIn: "--with-cypress",
        run: async () => {
            const r = await exec(
                [
                    "sqldev", "--stage", "dev", "cypress", "run", "--headless", "--browser",
                    "chrome", "--spec", "cypress/e2e/driveVisibility.cy.ts",
                ],
                ROOT,
                sqldevEnv,
            );
            return { ok: r.code === 0, output: r.output };
        },
    },
    {
        name: "baseline-unmodified",
        category: "spec",
        run: async () => {
            // Against HEAD so staged and unstaged edits both count.
            const r = await exec(["git", "diff", "--exit-code", "HEAD", "--", BASELINE_SPEC], ROOT);
            return { ok: r.code === 0, output: r.output };
        },
    },
];

const REQUIRED_COMMANDS = steps.map((s) => s.name);
const PROPERTY_PRODUCERS = ["go-test", "go-integration", "frontend-test"];
const CATEGORY = new Map(steps.map((s) => [s.name, s.category]));
const categoryOf = (name: string) => CATEGORY.get(name) ?? "spec";

function flag(name: string): string[] {
    const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
    const idx = process.argv.indexOf(`--${name}`);
    const raw = arg?.split("=")[1] ?? (idx >= 0 ? process.argv[idx + 1] : undefined);
    return raw ? raw.split(",") : [];
}

function excerpt(output: string): string {
    const lines = output.split("\n");
    const failing = lines.filter((l) =>
        /--- FAIL|^FAIL|panic:|\(fail\)|error TS|✖|^\s+\d+\) |^diff --git/.test(l),
    );
    return (failing.length ? failing.slice(0, 30) : lines.slice(-30)).join("\n");
}

async function main(): Promise<number> {
    const only = flag("only");
    const skip = new Set(flag("skip"));
    const results: CommandResult[] = [];
    const observations: Observation[] = [];
    mkdirSync(LOG_DIR, { recursive: true });

    for (const step of steps) {
        const optedOut = step.optIn !== undefined && !process.argv.includes(step.optIn);
        if ((only.length && !only.includes(step.name)) || skip.has(step.name) || optedOut) {
            const why = optedOut ? `needs ${step.optIn}` : "excluded by --only/--skip";
            console.log(`skipped  ${step.name} (${why}) — not verified`);
            results.push({ name: step.name, status: "skipped", detail: why });
            continue;
        }
        const started = Date.now();
        let outcome: Outcome;
        try {
            outcome = await step.run();
        } catch (error) {
            outcome = { ok: false, output: String(error), detail: "command could not be run" };
        }
        observations.push(...(outcome.observations ?? []));
        writeFileSync(`${LOG_DIR}/${step.name}.log`, outcome.output);
        const secs = ((Date.now() - started) / 1000).toFixed(1);
        console.log(
            `${outcome.ok ? "pass" : "FAIL"}  ${step.name} (${secs}s)${outcome.detail ? ` — ${outcome.detail}` : ""}`,
        );
        results.push({ name: step.name, status: outcome.ok ? "pass" : "fail", detail: outcome.detail });
        if (!outcome.ok) {
            console.log(excerpt(outcome.output));
            console.log(`      full output: ${LOG_DIR}/${step.name}.log`);
        }
    }

    const accounting = account({
        commands: results,
        requiredCommands: REQUIRED_COMMANDS,
        propertyProducers: PROPERTY_PRODUCERS,
        observations,
    });

    console.log("");
    for (let n = 1; n <= PROPERTY_COUNT; n++) {
        const seen = accounting.executed[n] ?? {};
        const bindings = Object.entries(seen).map(([b, c]) => `${b}:${c}`).join(" ") || "none";
        const bad =
            accounting.failedProperties.includes(n) ? "FAIL"
                : accounting.duplicateProperties.includes(n) ? "DUP "
                    : accounting.missingProperties.includes(n) ? "MISS"
                        : accounting.unverifiedProperties.includes(n) ? "----"
                            : "pass";
        console.log(`${bad}  property ${n} (${bindings})`);
    }

    // The feature validation itself: property accounting, independent of the commands.
    const propertyProblem =
        accounting.failedProperties.length + accounting.duplicateProperties.length +
        accounting.missingProperties.length > 0;
    const feature: CommandResult = {
        name: "feature-validation",
        status: propertyProblem ? "fail"
            : accounting.unverifiedProperties.length ? "skipped" : "pass",
    };
    console.log(`${feature.status === "pass" ? "pass" : feature.status === "fail" ? "FAIL" : "skipped"}  feature-validation (properties 1-${PROPERTY_COUNT})`);

    console.log("");
    for (const [category, status] of categorySummary([...results, feature], categoryOf)) {
        console.log(`${status === "pass" ? "pass" : status === "fail" ? "FAIL" : status}  category ${category}`);
    }
    console.log("");
    for (const line of formatReport(accounting)) console.log(line);
    console.log(`logs: ${LOG_DIR}/`);
    return exitCodeFor(accounting.verdict);
}

if (import.meta.main) process.exit(await main());
