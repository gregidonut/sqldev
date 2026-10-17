/**
 * Example tests for the confirmation-dialog-copy runner accounting (Requirement 10).
 * Pure: no command is spawned and no file is read.
 */
import { describe, expect, test } from "bun:test";

import {
    account,
    categorySummary,
    exitCodeFor,
    formatReport,
    knownTypeErrorCount,
    parseBunVerbose,
    parseGoJson,
    PROPERTY_COUNT,
    TSC_BASELINE_FILES,
    unexpectedTypeErrorFiles,
    type AccountingInput,
    type CommandResult,
    type CommandStatus,
    type Observation,
} from "./verifyCopyAccounting";

const REQUIRED_COMMANDS = ["go-test", "go-integration", "tsc", "frontend-test"];
const PRODUCERS = ["go-test", "go-integration", "frontend-test"];

const obs = (
    property: number,
    binding: "go" | "ts",
    id: string,
    status: Observation["status"] = "pass",
): Observation => ({ property, binding, id, status });

/** One passing test per required slot: 1 Go, 2 Go, 3 Go + TS, 4 TS, 5 TS. */
const fullObservations = (): Observation[] => [
    obs(1, "go", "api::P1"),
    obs(2, "go", "sqldb::P2"),
    obs(2, "go", "worker::P2"),
    obs(3, "go", "api::P3"),
    obs(3, "ts", "decode.test.ts::P3"),
    obs(4, "ts", "copy.test.tsx::P4"),
    obs(5, "ts", "guidance.test.ts::P5"),
];

const commandsWith = (
    overrides: Record<string, CommandStatus> = {},
): CommandResult[] =>
    REQUIRED_COMMANDS.map((name) => ({
        name,
        status: overrides[name] ?? "pass",
    }));

const run = (
    observations: readonly Observation[],
    overrides: Record<string, CommandStatus> = {},
    commands: readonly CommandResult[] = commandsWith(overrides),
) => {
    const input: AccountingInput = {
        commands,
        requiredCommands: REQUIRED_COMMANDS,
        propertyProducers: PRODUCERS,
        observations,
    };
    const accounting = account(input);
    return { accounting, report: formatReport(accounting).join("\n") };
};

const without = (predicate: (o: Observation) => boolean) =>
    fullObservations().filter((o) => !predicate(o));

describe("account: properties", () => {
    test("all commands pass and properties 1-5 executed is pass with exit code 0", () => {
        const { accounting, report } = run(fullObservations());
        expect(accounting.verdict).toBe("pass");
        expect(exitCodeFor(accounting.verdict)).toBe(0);
        expect(accounting.failedCommands).toEqual([]);
        expect(accounting.missingProperties).toEqual([]);
        expect(accounting.duplicateProperties).toEqual([]);
        expect(accounting.failedProperties).toEqual([]);
        expect(accounting.executed[2]).toEqual({ go: 2 });
        expect(accounting.executed[3]).toEqual({ go: 1, ts: 1 });
        expect(report).toContain("pass");
        expect(report).not.toContain("FAIL");
        expect(PROPERTY_COUNT).toBe(5);
    });

    test("a property that never ran is missing, named, and fails with exit code 1", () => {
        const { accounting, report } = run(without((o) => o.property === 4));
        expect(accounting.verdict).toBe("fail");
        expect(exitCodeFor(accounting.verdict)).toBe(1);
        expect(accounting.missingProperties).toEqual([4]);
        expect(report).toContain("missing properties: 4");
        expect(report).toContain("4 (TypeScript binding: 0 of 1)");
    });

    test("Property 2 with only one of its two Go halves is missing, naming 1 of 2", () => {
        const { accounting, report } = run(
            without((o) => o.id === "worker::P2"),
        );
        expect(accounting.verdict).toBe("fail");
        expect(accounting.missingProperties).toEqual([2]);
        expect(report).toContain("2 (Go binding: 1 of 2)");
    });

    test("a duplicated property is named and fails", () => {
        const { accounting, report } = run([
            ...fullObservations(),
            obs(5, "ts", "other.test.ts::P5"),
        ]);
        expect(accounting.verdict).toBe("fail");
        expect(accounting.duplicateProperties).toEqual([5]);
        expect(accounting.missingProperties).toEqual([]);
        expect(report).toContain("duplicate properties: 5");
    });

    test("a failed assertion fails the verdict and is named as failed, not also missing", () => {
        const observations = fullObservations().map((o) =>
            o.id === "sqldb::P2" ? { ...o, status: "fail" as const } : o,
        );
        const { accounting, report } = run(observations);
        expect(accounting.verdict).toBe("fail");
        expect(accounting.failedProperties).toEqual([2]);
        expect(accounting.missingProperties).toEqual([]);
        expect(report).toContain("failed properties: 2");
        expect(report).not.toContain("missing properties");
    });

    test("a missing Go binding of Property 3 is named", () => {
        const { accounting, report } = run(
            without((o) => o.property === 3 && o.binding === "go"),
        );
        expect(accounting.verdict).toBe("fail");
        expect(accounting.missingProperties).toEqual([3]);
        expect(accounting.shortfalls).toEqual([
            { property: 3, binding: "go", found: 0, expected: 1 },
        ]);
        expect(report).toContain("3 (Go binding: 0 of 1)");
        expect(report).not.toContain("TypeScript binding");
    });

    test("a missing TypeScript binding of Property 3 is named", () => {
        const { accounting, report } = run(
            without((o) => o.property === 3 && o.binding === "ts"),
        );
        expect(accounting.verdict).toBe("fail");
        expect(accounting.missingProperties).toEqual([3]);
        expect(report).toContain("3 (TypeScript binding: 0 of 1)");
        expect(report).not.toContain("Go binding");
    });

    test("a skipped test does not count as executed", () => {
        const observations = fullObservations().map((o) =>
            o.property === 5 ? { ...o, status: "skip" as const } : o,
        );
        const { accounting, report } = run(observations);
        expect(accounting.verdict).toBe("fail");
        expect(accounting.missingProperties).toEqual([5]);
        expect(report).toContain("5 (TypeScript binding: 0 of 1)");
    });

    test("the same test seen by two commands counts once", () => {
        const { accounting } = run([
            ...fullObservations(),
            obs(1, "go", "api::P1"),
        ]);
        expect(accounting.verdict).toBe("pass");
        expect(accounting.duplicateProperties).toEqual([]);
        expect(accounting.executed[1]).toEqual({ go: 1 });
    });

    test("the same test seen as pass by one command and fail by another is a failure", () => {
        const passFirst = run([
            ...fullObservations(),
            obs(1, "go", "api::P1", "fail"),
        ]);
        expect(passFirst.accounting.verdict).toBe("fail");
        expect(passFirst.accounting.failedProperties).toEqual([1]);

        const failFirst = run([
            obs(1, "go", "api::P1", "fail"),
            ...fullObservations(),
        ]);
        expect(failFirst.accounting.verdict).toBe("fail");
        expect(failFirst.accounting.failedProperties).toEqual([1]);
        expect(failFirst.accounting.duplicateProperties).toEqual([]);
    });
});

describe("account: commands", () => {
    test("a failed command is named and fails even when every property passed", () => {
        const { accounting, report } = run(fullObservations(), { tsc: "fail" });
        expect(accounting.verdict).toBe("fail");
        expect(exitCodeFor(accounting.verdict)).toBe(1);
        expect(accounting.failedCommands).toEqual(["tsc"]);
        expect(report).toContain("failed commands: tsc");
    });

    test("every failed command is named", () => {
        const { accounting, report } = run(fullObservations(), {
            tsc: "fail",
            "go-test": "fail",
        });
        expect(accounting.failedCommands).toEqual(["go-test", "tsc"]);
        expect(report).toContain("failed commands: go-test, tsc");
    });

    test("a command reported not-run is missing, named, and fails", () => {
        const { accounting, report } = run(fullObservations(), {
            "go-integration": "not-run",
        });
        expect(accounting.verdict).toBe("fail");
        expect(accounting.missingCommands).toEqual(["go-integration"]);
        expect(report).toContain(
            "missing commands (did not run): go-integration",
        );
    });

    test("a required command with no result at all is treated as not run", () => {
        const partial = commandsWith().filter(
            (c) => c.name !== "frontend-test",
        );
        const { accounting, report } = run(fullObservations(), {}, partial);
        expect(accounting.verdict).toBe("fail");
        expect(accounting.missingCommands).toEqual(["frontend-test"]);
        expect(report).toContain("frontend-test");
    });

    test("a skipped non-producing command is incomplete with exit code 2, never pass", () => {
        const { accounting, report } = run(fullObservations(), {
            tsc: "skipped",
        });
        expect(accounting.verdict).toBe("incomplete");
        expect(exitCodeFor(accounting.verdict)).toBe(2);
        expect(accounting.skippedCommands).toEqual(["tsc"]);
        expect(report).toContain("skipped commands (not verified): tsc");
        expect(report).toContain("INCOMPLETE");
        expect(report).not.toMatch(/^pass /m);
    });

    test("a skipped producing command makes a missing property unverified, not missing", () => {
        const { accounting, report } = run(
            without((o) => o.property === 2),
            { "go-integration": "skipped" },
        );
        expect(accounting.verdict).toBe("incomplete");
        expect(accounting.missingProperties).toEqual([]);
        expect(accounting.shortfalls).toEqual([]);
        expect(accounting.unverifiedProperties).toEqual([2]);
        expect(report).toContain(
            "properties not verified (a producing command was skipped): 2",
        );
        expect(report).not.toContain("missing properties");
    });

    test("a skipped producer cannot hide a failed command or a failed assertion", () => {
        const failedCommand = run(fullObservations(), {
            "go-integration": "skipped",
            tsc: "fail",
        });
        expect(failedCommand.accounting.verdict).toBe("fail");

        const failedAssertion = run(
            [
                ...without((o) => o.property === 2),
                obs(4, "ts", "copy.test.tsx::P4", "fail"),
            ],
            { "go-integration": "skipped" },
        );
        expect(failedAssertion.accounting.verdict).toBe("fail");
        expect(failedAssertion.accounting.failedProperties).toEqual([4]);
    });

    test("a duplicate is still a failure when a producing command was skipped", () => {
        const { accounting } = run(
            [...fullObservations(), obs(5, "ts", "extra::P5")],
            {
                "go-integration": "skipped",
            },
        );
        expect(accounting.verdict).toBe("fail");
        expect(accounting.duplicateProperties).toEqual([5]);
    });
});

describe("exitCodeFor", () => {
    test("maps pass, fail and incomplete to 0, 1 and 2", () => {
        expect(exitCodeFor("pass")).toBe(0);
        expect(exitCodeFor("fail")).toBe(1);
        expect(exitCodeFor("incomplete")).toBe(2);
    });
});

describe("parseGoJson", () => {
    const event = (action: string, test: string, pkg = "example/api") =>
        JSON.stringify({ Action: action, Package: pkg, Test: test });

    test("does not count a top-level test whose name lacks the tag", () => {
        const name = "TestContractPropertyThree";
        const output = [
            event("run", name),
            JSON.stringify({
                Action: "output",
                Package: "example/api",
                Test: name,
                Output: "ok\n",
            }),
            event("pass", name),
        ].join("\n");
        // The tag is a Go subtest-name prefix, so a top-level name without it is not counted.
        expect(parseGoJson(output)).toEqual([]);
    });

    test("recognises the tag in a leaf subtest name with spaces rewritten to underscores", () => {
        const leaf =
            "Feature:_confirmation-dialog-copy,_Property_3:_Authoritative_copy_round_trips";
        const output = [
            event("run", `TestX/${leaf}`),
            event("pass", `TestX/${leaf}`),
        ].join("\n");
        expect(parseGoJson(output)).toEqual([
            {
                property: 3,
                binding: "go",
                id: `example/api::TestX/${leaf}`,
                status: "pass",
            },
        ]);
    });

    test("counts only the leaf of a test path, not a sub-test that repeats the tag as a prefix", () => {
        const parent = "Feature:_confirmation-dialog-copy,_Property_2:_Replay";
        const child = `${parent}/valid_case`;
        const output = [
            event("pass", `TestRoot/${parent}`),
            event("pass", `TestRoot/${child}`),
        ].join("\n");
        // `valid_case` is the leaf of the child and has no tag; only the parent is counted.
        const found = parseGoJson(output);
        expect(found).toHaveLength(1);
        expect(found[0]?.id).toBe(`example/api::TestRoot/${parent}`);
        expect(found[0]?.property).toBe(2);
    });

    test("accepts a tag written with spaces and reports fail and skip statuses", () => {
        const tag = (n: number) =>
            `Feature: confirmation-dialog-copy, Property ${n}: x`;
        const output = [
            event("fail", tag(1)),
            event("skip", tag(2)),
            event("pass", tag(3)),
            event("pass", "TestUnrelated"),
        ].join("\n");
        expect(parseGoJson(output).map((o) => [o.property, o.status])).toEqual([
            [1, "fail"],
            [2, "skip"],
            [3, "pass"],
        ]);
    });

    test("ignores run, output and pause actions, package events, and non-JSON lines", () => {
        const tag = "Feature:_confirmation-dialog-copy,_Property_1:_x";
        const output = [
            "go: downloading something",
            event("run", tag),
            event("output", tag),
            event("pause", tag),
            JSON.stringify({ Action: "pass", Package: "example/api" }),
            "{not json",
        ].join("\n");
        expect(parseGoJson(output)).toEqual([]);
    });

    test("keeps the package in the identity so same-named tests in two packages are two tests", () => {
        const tag = "Feature:_confirmation-dialog-copy,_Property_2:_x";
        const output = [
            event("pass", tag, "example/sqldb"),
            event("pass", tag, "example/worker"),
        ].join("\n");
        const { accounting } = run([
            ...fullObservations().filter((o) => o.property !== 2),
            ...parseGoJson(output),
        ]);
        expect(accounting.executed[2]).toEqual({ go: 2 });
        expect(accounting.verdict).toBe("pass");
    });
});

describe("parseBunVerbose", () => {
    test("reads (pass)/(fail)/(skip) lines under file headers with timings", () => {
        const output = [
            "src/utils/confirmation/dialogCopy.property.test.tsx:",
            "(pass) Feature: confirmation-dialog-copy, Property 4: Rendering [12.50ms]",
            "(pass) some other test [0.10ms]",
            "",
            "src/utils/confirmation/decodeResult.property.test.ts:",
            "(fail) Feature: confirmation-dialog-copy, Property 3: Contract [3.00ms]",
            "(skip) Feature: confirmation-dialog-copy, Property 5: Guidance",
            "(todo) Feature: confirmation-dialog-copy, Property 1: Later",
            "",
            " 3 pass",
            " 1 fail",
        ].join("\n");
        expect(parseBunVerbose(output)).toEqual([
            {
                property: 4,
                binding: "ts",
                id: "src/utils/confirmation/dialogCopy.property.test.tsx::Feature: confirmation-dialog-copy, Property 4: Rendering",
                status: "pass",
            },
            {
                property: 3,
                binding: "ts",
                id: "src/utils/confirmation/decodeResult.property.test.ts::Feature: confirmation-dialog-copy, Property 3: Contract",
                status: "fail",
            },
            {
                property: 5,
                binding: "ts",
                id: "src/utils/confirmation/decodeResult.property.test.ts::Feature: confirmation-dialog-copy, Property 5: Guidance",
                status: "skip",
            },
            {
                property: 1,
                binding: "ts",
                id: "src/utils/confirmation/decodeResult.property.test.ts::Feature: confirmation-dialog-copy, Property 1: Later",
                status: "skip",
            },
        ]);
    });

    test("finds the tag in a nested describe name and in a test of another file", () => {
        const output = [
            "a.test.ts:",
            "(pass) suite > Feature: confirmation-dialog-copy, Property 4: Rendering [1.00ms]",
            "b.test.ts:",
            "(pass) suite > Feature: confirmation-dialog-copy, Property 4: Rendering [1.00ms]",
        ].join("\n");
        const found = parseBunVerbose(output);
        expect(found.map((o) => o.id)).toEqual([
            "a.test.ts::suite > Feature: confirmation-dialog-copy, Property 4: Rendering",
            "b.test.ts::suite > Feature: confirmation-dialog-copy, Property 4: Rendering",
        ]);
        // Two files hold two distinct tests, so the accounting reports a duplicate.
        const { accounting } = run([
            ...fullObservations().filter((o) => o.property !== 4),
            ...found,
        ]);
        expect(accounting.duplicateProperties).toEqual([4]);
    });

    test("the same test printed by two runs counts once", () => {
        const output = [
            "a.test.ts:",
            "(pass) Feature: confirmation-dialog-copy, Property 4: Rendering [1.00ms]",
        ].join("\n");
        const twice = [...parseBunVerbose(output), ...parseBunVerbose(output)];
        const { accounting } = run([
            ...fullObservations().filter((o) => o.property !== 4),
            ...twice,
        ]);
        expect(accounting.executed[4]).toEqual({ ts: 1 });
        expect(accounting.verdict).toBe("pass");
    });

    test("ignores untagged tests and a tag that is not at the start of the name", () => {
        const output = [
            "a.test.ts:",
            "(pass) mentions Feature: confirmation-dialog-copy, Property 4: in the middle",
            "(pass) plain test",
        ].join("\n");
        expect(parseBunVerbose(output)).toEqual([]);
    });
});

describe("tsc baseline classification", () => {
    const baselineFile = [...TSC_BASELINE_FILES][0] ?? "";
    const baselineLine = `${baselineFile}(10,5): error TS2322: Type 'x' is not assignable.`;
    const newLine =
        "src/utils/confirmation/protocol.ts(3,1): error TS2304: Cannot find name 'y'.";

    test("errors only in baseline files are expected and counted, not unexpected", () => {
        const output = [baselineLine, baselineLine, "Found 2 errors."].join(
            "\n",
        );
        expect(unexpectedTypeErrorFiles(output)).toEqual([]);
        expect(knownTypeErrorCount(output)).toBe(2);
    });

    test("an error in any other file is unexpected and named once", () => {
        const output = [baselineLine, newLine, newLine].join("\n");
        expect(unexpectedTypeErrorFiles(output)).toEqual([
            "src/utils/confirmation/protocol.ts",
        ]);
        expect(knownTypeErrorCount(output)).toBe(1);
    });

    test("clean output has no errors of either kind", () => {
        expect(unexpectedTypeErrorFiles("")).toEqual([]);
        expect(knownTypeErrorCount("")).toBe(0);
    });

    test("a custom baseline replaces the default one", () => {
        const custom = new Set(["src/utils/confirmation/protocol.ts"]);
        const output = [baselineLine, newLine].join("\n");
        expect(unexpectedTypeErrorFiles(output, custom)).toEqual([
            baselineFile,
        ]);
        expect(knownTypeErrorCount(output, custom)).toBe(1);
    });
});

describe("categorySummary", () => {
    const category = (name: string) =>
        name.startsWith("go-") ? "go" : "frontend";
    const summarize = (commands: CommandResult[]) =>
        Object.fromEntries(categorySummary(commands, category));

    test("a category is pass only when every member passed", () => {
        expect(
            summarize([
                { name: "go-test", status: "pass" },
                { name: "go-integration", status: "pass" },
                { name: "tsc", status: "pass" },
            ]),
        ).toEqual({ go: "pass", frontend: "pass" });
    });

    test("takes the worst state: fail over not-run over skipped over pass", () => {
        const ranked: [CommandStatus, CommandStatus][] = [
            ["pass", "skipped"],
            ["skipped", "not-run"],
            ["not-run", "fail"],
        ];
        for (const [better, worse] of ranked) {
            expect(
                summarize([
                    { name: "go-a", status: better },
                    { name: "go-b", status: worse },
                ]).go,
            ).toBe(worse);
            // Order of members does not matter.
            expect(
                summarize([
                    { name: "go-a", status: worse },
                    { name: "go-b", status: better },
                ]).go,
            ).toBe(worse);
        }
    });

    test("one failed member cannot be hidden by passing members", () => {
        expect(
            summarize([
                { name: "go-a", status: "pass" },
                { name: "go-b", status: "fail" },
                { name: "go-c", status: "skipped" },
                { name: "go-d", status: "pass" },
            ]).go,
        ).toBe("fail");
    });
});
