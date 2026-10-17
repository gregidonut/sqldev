/**
 * Pure accounting for the confirmation-dialog-copy validation runner.
 *
 * Nothing here spawns a process, reads a file or touches the clock, so the runner's
 * pass/fail decision can be unit tested without running any command. The runner
 * (`verify-confirmation-dialog-copy.ts`) feeds it command results and the property
 * observations parsed from `go test -json` and `bun test` output.
 */

export const FEATURE = "confirmation-dialog-copy";
export const PROPERTY_COUNT = 5;

export type Binding = "go" | "ts";

/**
 * Distinct tagged tests required per property and binding. Property 3 is one contract
 * with two bindings (Go and TypeScript). Property 2 has two Go halves, the database half
 * in `internal/sqldb` and the production-path replay half in `cmd/supabaseworker`.
 */
export type RequiredTests = Readonly<
    Record<number, Readonly<Partial<Record<Binding, number>>>>
>;

export const REQUIRED_TESTS: RequiredTests = {
    1: { go: 1 },
    2: { go: 2 },
    3: { go: 1, ts: 1 },
    4: { ts: 1 },
    5: { ts: 1 },
};

/** Files whose type errors predate this feature (same set as `verify-visibility.ts`). */
export const TSC_BASELINE_FILES: ReadonlySet<string> = new Set([
    "src/components/react/MdxEditor/queryOptions/igPostQueryOptions.test.ts",
    "src/components/react/MdxEditor/queryOptions/queryOptions.property.test.ts",
    "src/components/ui/Tree.tsx",
    "src/server/requestJob.ts",
    "src/utils/cy/index.ts",
]);

export type TestStatus = "pass" | "fail" | "skip";

/** One tagged test as seen in one command's output. */
export interface Observation {
    property: number;
    binding: Binding;
    /** Stable identity of the test (package or file plus test path). */
    id: string;
    status: TestStatus;
}

export type CommandStatus = "pass" | "fail" | "skipped" | "not-run";

export interface CommandResult {
    name: string;
    status: CommandStatus;
    detail?: string;
}

// Go replaces spaces in subtest names with underscores; bun keeps them.
const GO_TAG = /^Feature:[ _]confirmation-dialog-copy,[ _]Property[ _](\d+):/;
const TS_TAG = /(?:^|> )Feature: confirmation-dialog-copy, Property (\d+):/;

/**
 * Tagged tests from `go test -json` output. Only the leaf of a test path counts, so a
 * sub-test nested below a tagged test (whose name repeats the tag as a prefix) is not
 * counted as another property execution.
 */
export function parseGoJson(output: string): Observation[] {
    const found: Observation[] = [];
    for (const line of output.split("\n")) {
        if (!line.startsWith("{")) continue;
        let event: { Action?: string; Package?: string; Test?: string };
        try {
            event = JSON.parse(line) as typeof event;
        } catch {
            continue;
        }
        if (event.Test === undefined || event.Action === undefined) continue;
        const status: TestStatus | undefined =
            event.Action === "pass" ? "pass"
                : event.Action === "fail" ? "fail"
                    : event.Action === "skip" ? "skip"
                        : undefined;
        if (status === undefined) continue;
        const leaf = event.Test.slice(event.Test.lastIndexOf("/") + 1);
        const match = GO_TAG.exec(leaf);
        if (match === null) continue;
        found.push({
            property: Number(match[1]),
            binding: "go",
            id: `${event.Package ?? ""}::${event.Test}`,
            status,
        });
    }
    return found;
}

/** Plain text of `go test -json` output, for logs and failure excerpts. */
export function goJsonToText(output: string): string {
    const text: string[] = [];
    for (const line of output.split("\n")) {
        if (!line.startsWith("{")) {
            if (line !== "") text.push(line);
            continue;
        }
        try {
            const event = JSON.parse(line) as { Output?: string };
            if (event.Output !== undefined) text.push(event.Output.replace(/\n$/, ""));
        } catch {
            text.push(line);
        }
    }
    return text.join("\n");
}

/** Tagged tests from `bun test` output (it prints `(pass)`/`(fail)`/`(skip)` per test). */
export function parseBunVerbose(output: string): Observation[] {
    const found: Observation[] = [];
    let file = "";
    for (const line of output.split("\n")) {
        const header = /^(\S+\.(?:ts|tsx)):$/.exec(line);
        if (header !== null) {
            file = header[1] ?? "";
            continue;
        }
        const result = /^\((pass|fail|skip|todo)\) (.*?)(?: \[[\d.]+m?s\])?$/.exec(line);
        if (result === null) continue;
        const name = result[2] ?? "";
        const match = TS_TAG.exec(name);
        if (match === null) continue;
        found.push({
            property: Number(match[1]),
            binding: "ts",
            id: `${file}::${name}`,
            status: result[1] === "pass" ? "pass" : result[1] === "fail" ? "fail" : "skip",
        });
    }
    return found;
}

/** Files reported by `tsc` that are not in the known-failing baseline. */
export function unexpectedTypeErrorFiles(
    output: string,
    baseline: ReadonlySet<string> = TSC_BASELINE_FILES,
): string[] {
    const files = output
        .split("\n")
        .filter((line) => /error TS\d+/.test(line))
        .map((line) => line.split("(")[0] ?? line)
        .filter((file) => !baseline.has(file));
    return [...new Set(files)];
}

/** Type errors in the known-failing baseline files; reported, never counted. */
export function knownTypeErrorCount(
    output: string,
    baseline: ReadonlySet<string> = TSC_BASELINE_FILES,
): number {
    return output
        .split("\n")
        .filter((line) => /error TS\d+/.test(line) && baseline.has(line.split("(")[0] ?? ""))
        .length;
}

export interface Shortfall {
    property: number;
    binding: Binding;
    found: number;
    expected: number;
}

export interface AccountingInput {
    /** Results by command name, in any order. */
    commands: readonly CommandResult[];
    /** Every command that must pass, in run order. */
    requiredCommands: readonly string[];
    /** Commands whose output yields property observations. */
    propertyProducers: readonly string[];
    observations: readonly Observation[];
    required?: RequiredTests;
    propertyCount?: number;
}

export type Verdict = "pass" | "fail" | "incomplete";

export interface Accounting {
    verdict: Verdict;
    failedCommands: string[];
    /** Commands with no result, or reported `not-run`. */
    missingCommands: string[];
    /** Commands deliberately skipped (opt-in flags, --skip, --only). */
    skippedCommands: string[];
    failedProperties: number[];
    duplicateProperties: number[];
    /** Properties with at least one required binding or test absent. */
    missingProperties: number[];
    shortfalls: Shortfall[];
    /** Missing properties that cannot be judged because a producing command was skipped. */
    unverifiedProperties: number[];
    /** Per property: distinct passing tests by binding. */
    executed: Record<number, Partial<Record<Binding, number>>>;
}

const unique = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);

/**
 * Decides the verdict. `pass` needs every command to pass and every property to run with
 * zero failures, each in its required bindings, with no duplicated test. A command that
 * failed or did not execute is `fail`. A command that was skipped on purpose is never
 * reported as passed: it makes the verdict `incomplete` at best.
 */
export function account(input: AccountingInput): Accounting {
    const required = input.required ?? REQUIRED_TESTS;
    const count = input.propertyCount ?? PROPERTY_COUNT;
    const byName = new Map(input.commands.map((c) => [c.name, c]));

    const failedCommands: string[] = [];
    const missingCommands: string[] = [];
    const skippedCommands: string[] = [];
    for (const name of input.requiredCommands) {
        const status = byName.get(name)?.status ?? "not-run";
        if (status === "fail") failedCommands.push(name);
        else if (status === "not-run") missingCommands.push(name);
        else if (status === "skipped") skippedCommands.push(name);
    }

    // A test seen by several commands is one test. Any failure wins over a pass.
    const status = new Map<string, { o: Observation; status: TestStatus }>();
    for (const o of input.observations) {
        const key = `${o.property}|${o.binding}|${o.id}`;
        const prior = status.get(key);
        const next: TestStatus =
            prior === undefined ? o.status
                : prior.status === "fail" || o.status === "fail" ? "fail"
                    : prior.status === "pass" || o.status === "pass" ? "pass"
                        : "skip";
        status.set(key, { o, status: next });
    }

    const failed: number[] = [];
    const duplicate: number[] = [];
    const missing: number[] = [];
    const shortfalls: Shortfall[] = [];
    const executed: Record<number, Partial<Record<Binding, number>>> = {};

    for (let n = 1; n <= count; n++) {
        const needs = required[n] ?? {};
        executed[n] = {};
        const tests = [...status.values()].filter((t) => t.o.property === n);
        if (tests.some((t) => t.status === "fail")) failed.push(n);
        for (const binding of ["go", "ts"] as const) {
            const passes = tests.filter((t) => t.o.binding === binding && t.status === "pass").length;
            if (passes > 0) executed[n]![binding] = passes;
            const expected = needs[binding];
            if (expected === undefined) continue;
            if (passes > expected) duplicate.push(n);
            // A failed property is reported as failed, not also as missing.
            if (passes < expected && !failed.includes(n)) {
                missing.push(n);
                shortfalls.push({ property: n, binding, found: passes, expected });
            }
        }
    }

    const producersRan = input.propertyProducers.every(
        (name) => byName.get(name)?.status !== "skipped",
    );
    // Missing numbers can only be called missing when every producing command ran.
    const unverified = producersRan ? [] : unique(missing);
    const missingProperties = producersRan ? unique(missing) : [];

    const propertyFail = failed.length > 0 || duplicate.length > 0 || missingProperties.length > 0;
    const verdict: Verdict =
        failedCommands.length > 0 || missingCommands.length > 0 || propertyFail ? "fail"
            : skippedCommands.length > 0 || unverified.length > 0 ? "incomplete"
                : "pass";

    return {
        verdict,
        failedCommands,
        missingCommands,
        skippedCommands,
        failedProperties: unique(failed),
        duplicateProperties: unique(duplicate),
        missingProperties,
        shortfalls: producersRan ? shortfalls : [],
        unverifiedProperties: unverified,
        executed,
    };
}

const list = (values: readonly (string | number)[]) => values.join(", ");

/** Human-readable report naming every failed, duplicate or missing command and property. */
export function formatReport(a: Accounting): string[] {
    const lines: string[] = [];
    if (a.failedCommands.length) lines.push(`failed commands: ${list(a.failedCommands)}`);
    if (a.missingCommands.length) lines.push(`missing commands (did not run): ${list(a.missingCommands)}`);
    if (a.skippedCommands.length) lines.push(`skipped commands (not verified): ${list(a.skippedCommands)}`);
    if (a.failedProperties.length) lines.push(`failed properties: ${list(a.failedProperties)}`);
    if (a.duplicateProperties.length) lines.push(`duplicate properties: ${list(a.duplicateProperties)}`);
    if (a.missingProperties.length) {
        const detail = a.shortfalls
            .map((s) => `${s.property} (${s.binding === "go" ? "Go" : "TypeScript"} binding: ${s.found} of ${s.expected})`)
            .join(", ");
        lines.push(`missing properties: ${list(a.missingProperties)} — ${detail}`);
    }
    if (a.unverifiedProperties.length) {
        lines.push(`properties not verified (a producing command was skipped): ${list(a.unverifiedProperties)}`);
    }
    lines.push(
        a.verdict === "pass" ? "pass  all commands passed and properties 1-5 executed"
            : a.verdict === "incomplete" ? "INCOMPLETE  nothing failed, but skipped work means this is not a pass"
                : "FAIL",
    );
    return lines;
}

/** `pass` only when no member failed, did not run or was skipped; otherwise the worst state. */
export function categorySummary(
    commands: readonly CommandResult[],
    categoryOf: (name: string) => string,
): Map<string, CommandStatus> {
    const rank: Record<CommandStatus, number> = { pass: 0, skipped: 1, "not-run": 2, fail: 3 };
    const out = new Map<string, CommandStatus>();
    for (const c of commands) {
        const key = categoryOf(c.name);
        const prior = out.get(key);
        if (prior === undefined || rank[c.status] > rank[prior]) out.set(key, c.status);
    }
    return out;
}

/** Process exit code for a verdict: 0 pass, 1 fail, 2 incomplete. */
export function exitCodeFor(verdict: Verdict): number {
    return verdict === "pass" ? 0 : verdict === "fail" ? 1 : 2;
}
