/**
 * Feature: confirmation-dialog-copy, Property 5: Durable guidance matches authored sources.
 *
 * A bounded repository check, not a randomized one. It reads the three guidance
 * files and the authored sources they cite, and fails when a durable fact drifts:
 *
 *   - AGENTS.md                                    (only the "Confirmable operations" section)
 *   - packages/agent-skills/skills/confirmable-operations/SKILL.md   (whole file)
 *   - packages/agent-skills/skills/understanding-sqldev/references/project-knowledge.md
 *                                                   (only the "Confirmable operations" row)
 *
 * For each of those scopes it requires, per fact (registry identity, the
 * `operation_kind` binding, copy ownership, the wire form, the adapter role and the
 * safe fallback), the fact's terms and a citation of the authored source. Every
 * backticked path in the scope must exist, and each fact must agree with the
 * authored source (migration, api.yaml, protocol.ts, dialogMachine.ts, the adapter).
 * It also rejects the known stale claims, generated-source citations, and
 * secret-like or environment-specific values.
 *
 * MANUAL STEP (not automated, on purpose): a reviewer must still read the guidance
 * for (a) transient observations, such as the state of a particular local or staging
 * database, a running service, or a one-off command result, and (b) unverified or
 * guessed implementation claims that this check has no source assertion for. A
 * regex cannot tell a durable fact from a stale observation. Review those by hand
 * whenever any of the three scopes changes.
 *
 * Paths: a backticked token that starts with a repository root (`packages/`,
 * `.kiro/`, `infra/`, `agent/`) must exist exactly. Shorthand such as
 * `RACCRUDTable/confirmation/ConfirmationDialogHost.tsx`, `api/submit.go` or
 * `.../storage/StorageThumbnail.tsx` must be the tail of an existing repository
 * file. Tokens with wildcards, spaces, URLs or other punctuation are not paths.
 * `.kiro/` is gitignored, so `.kiro/` paths and the spec document names
 * (`requirements.md`, `design.md`, `tasks.md`) are not existence-checked: a clean
 * clone does not have them.
 *
 * The repository root is five directories above this file.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../../../..");

// ---------------------------------------------------------------------------
// Authored sources
// ---------------------------------------------------------------------------

// The registry identity and dialog copy are defined in the migrations that declare the
// objects; there is no separate registry migration.
const PROTOCOL_MIGRATION =
    "packages/backend/supabase/migrations/20261101090100_create_app_confirmation_protocol.sql";
const VISIBILITY_MIGRATION =
    "packages/backend/supabase/migrations/20261101090200_create_d_storage_visibility_functions.sql";
const API_YAML = "packages/functions/cmd/goapi/api.yaml";
const PROTOCOL = "packages/frontend/src/utils/confirmation/protocol.ts";
const DIALOG_MACHINE =
    "packages/frontend/src/utils/confirmation/dialogMachine.ts";
const DECODE_RESULT =
    "packages/frontend/src/utils/confirmation/decodeResult.ts";
const ADAPTER =
    "packages/frontend/src/pages/drive/[driveTab]/_components/react/RACCRUDTable/storage/visibility/storageMakePublicAdapter.ts";
const HOST =
    "packages/frontend/src/pages/drive/[driveTab]/_components/react/RACCRUDTable/confirmation/ConfirmationDialogHost.tsx";

function read(rel: string): string {
    return readFileSync(join(ROOT, rel), "utf8");
}

// ---------------------------------------------------------------------------
// Guidance scopes
// ---------------------------------------------------------------------------

type Scope = {
    /** Label used in failure messages. */
    name: string;
    /** The confirmation-related text: paths, facts, secrets are checked here. */
    text: string;
    /** The whole file: stale claims are rejected anywhere in it. */
    whole: string;
};

/** From `## <heading>` up to the next level-2 heading. */
function section(markdown: string, heading: string): string {
    const start = markdown.indexOf(`\n## ${heading}`);
    if (start < 0) throw new Error(`Section "${heading}" not found`);
    const rest = markdown.slice(start + 1);
    const next = rest.indexOf("\n## ", 1);
    return next < 0 ? rest : rest.slice(0, next);
}

function tableRow(markdown: string, firstCell: string): string {
    const prefix = `| ${firstCell} |`;
    const rows = markdown.split("\n").filter((l) => l.startsWith(prefix));
    if (rows.length !== 1) {
        throw new Error(
            `Expected one "${firstCell}" row, found ${rows.length}`,
        );
    }
    return rows[0] ?? "";
}

function loadScopes(): Scope[] {
    const agents = read("AGENTS.md");
    const skill = read(
        "packages/agent-skills/skills/confirmable-operations/SKILL.md",
    );
    const knowledge = read(
        "packages/agent-skills/skills/understanding-sqldev/references/project-knowledge.md",
    );
    return [
        {
            name: "AGENTS.md (Confirmable operations)",
            text: section(
                agents,
                "Confirmable operations (storage object visibility)",
            ),
            whole: agents,
        },
        {
            name: "confirmable-operations/SKILL.md",
            text: skill,
            whole: skill,
        },
        {
            name: "project-knowledge.md (Confirmable operations row)",
            text: tableRow(knowledge, "Confirmable operations"),
            whole: knowledge,
        },
    ];
}

// ---------------------------------------------------------------------------
// Path citations
// ---------------------------------------------------------------------------

const REPO_ROOTS = ["packages/", ".kiro/", "infra/", "agent/"];
const PATH_EXTENSION = /\.(?:ts|tsx|go|sql|md|json|yaml|yml|toml|sh)$/;

function backtickTokens(text: string): string[] {
    return [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] ?? "");
}

/** Whether a backticked token is meant as a repository path. */
function isPathToken(token: string): boolean {
    if (/[\s*<>{}()"'=:,;|$\\]/.test(token)) return false;
    if (token.startsWith("/") || token.includes("//")) return false;
    if (token.endsWith("/")) return token.includes("/", 0) && token.length > 1;
    return PATH_EXTENSION.test(token);
}

let fileList: string[] | null = null;

/** Every tracked or untracked-but-not-ignored file, repo-relative. */
function repoFiles(): string[] {
    if (fileList !== null) return fileList;
    const run = Bun.spawnSync(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        { cwd: ROOT },
    );
    if (run.exitCode !== 0) {
        throw new Error(`git ls-files failed: ${run.stderr.toString()}`);
    }
    fileList = run.stdout
        .toString()
        .split("\0")
        .filter((f) => f !== "");
    return fileList;
}

function cleanToken(token: string): string {
    return token.replace(/^\.\.\.\//, "");
}

function pathExists(token: string): boolean {
    const clean = cleanToken(token);
    const absolute = token.startsWith(".../")
        ? null
        : join(ROOT, clean.replace(/\/$/, ""));
    if (REPO_ROOTS.some((r) => clean.startsWith(r)) && absolute !== null) {
        return (
            existsSync(absolute) &&
            (clean.endsWith("/") ? statSync(absolute).isDirectory() : true)
        );
    }
    const tail = clean.replace(/\/$/, "");
    return repoFiles().some(
        (f) =>
            f === tail ||
            f.endsWith(`/${tail}`) ||
            (clean.endsWith("/") && f.includes(`/${clean}`)),
    );
}

/** Whether `token` names the authored file `authoritative` (exactly or as its tail). */
function citesFile(token: string, authoritative: string): boolean {
    if (!isPathToken(token) || token.endsWith("/")) return false;
    const clean = cleanToken(token);
    return authoritative === clean || authoritative.endsWith(`/${clean}`);
}

/**
 * `.kiro/` is gitignored, so spec paths and the spec documents named in the skill
 * exist only in a working copy that has them; a clean clone cannot verify them.
 */
function isLocalOnly(token: string): boolean {
    return (
        token.startsWith(".kiro/") ||
        ["requirements.md", "design.md", "tasks.md"].includes(token)
    );
}

function pathProblems(scope: Scope): string[] {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const token of backtickTokens(scope.text)) {
        if (!isPathToken(token) || seen.has(token) || isLocalOnly(token))
            continue;
        seen.add(token);
        if (!pathExists(token))
            problems.push(`cited path does not exist: ${token}`);
    }
    return problems;
}

// ---------------------------------------------------------------------------
// Rejected content
// ---------------------------------------------------------------------------

const STALE_CLAIMS: readonly { label: string; pattern: RegExp }[] = [
    {
        label: "a new operation only adds an adapter",
        pattern: /only adds an adapter/i,
    },
    {
        label: "dialog copy is moving into PostgreSQL",
        pattern: /dialog copy is moving into PostgreSQL/i,
    },
    {
        label: "may still build seven keys",
        pattern: /may still build seven keys/i,
    },
    {
        label: "adapter owns the dialog copy",
        pattern:
            /\badapters?\b[^.\n|]{0,80}?\b(?:owns?|supplies|provides?|defines?)\b[^.\n|]{0,40}?\b(?:title|copy|description|button label|dialog text)/i,
    },
    {
        label: "adapter-owned copy",
        pattern: /adapter[- ]owned (?:copy|text|title|description)/i,
    },
    {
        label: "dialog text comes from the adapter",
        pattern:
            /dialog (?:title|text|copy)\b[^.\n|]{0,40}?\b(?:lives?|comes?)\b[^.\n|]{0,20}?\b(?:in|from) the (?:storage |make-public )?adapter/i,
    },
    {
        label: "challenge bound to registry_id",
        pattern: /challenges?\s+(?:is\s+|are\s+)?bound\s+to\s+`?registry_id/i,
    },
];

const SECRET_LIKE: readonly { label: string; pattern: RegExp }[] = [
    {
        label: "AWS profile",
        pattern: /\bAWS_PROFILE\s*=\s*\S+|--profile[ =]\S+/,
    },
    { label: "AWS ARN", pattern: /\barn:aws[\w-]*:/ },
    { label: "12-digit account id", pattern: /(?<![\w.-])\d{12}(?![\w.-])/ },
    {
        label: "JWT-looking string",
        pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
    },
    {
        label: "API key or token",
        pattern:
            /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}|\bBearer\s+[A-Za-z0-9._~+/-]{20,}/,
    },
    {
        label: "URL with credentials",
        pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]*@/i,
    },
    {
        label: "absolute home path",
        pattern:
            /(?:^|[\s`(="'])(?:\/home|\/Users)\/[A-Za-z0-9._-]+|[A-Za-z]:\\Users\\/,
    },
];

const GENERATED_SOURCE = /\.gen\.(?:go|ts|tsx)\b/;

function matches(
    rules: readonly { label: string; pattern: RegExp }[],
    text: string,
): string[] {
    return rules.filter((r) => r.pattern.test(text)).map((r) => r.label);
}

function rejectedContent(scope: Scope): string[] {
    const problems: string[] = [];
    for (const label of matches(STALE_CLAIMS, scope.whole)) {
        problems.push(`stale claim: ${label}`);
    }
    for (const label of matches(SECRET_LIKE, scope.text)) {
        problems.push(`secret-like or environment-specific value: ${label}`);
    }
    if (GENERATED_SOURCE.test(scope.text)) {
        problems.push(
            "generated source cited where an authored source exists (api.yaml, not api.gen.go)",
        );
    }
    return problems;
}

// ---------------------------------------------------------------------------
// Facts: terms and citations required in the guidance
// ---------------------------------------------------------------------------

type Fact = {
    name: string;
    /** Every term must appear in the scope text. */
    terms: readonly RegExp[];
    /** Each entry: at least one backticked token must cite one of these files. */
    cites: readonly (readonly string[])[];
};

const FACTS: readonly Fact[] = [
    {
        name: "registry identity",
        terms: [
            /registry_id/,
            /app_confirmable_operations_registry_id_seq/,
            /\b1000\b/,
            /NO CYCLE/,
            /immutable/i,
        ],
        cites: [[PROTOCOL_MIGRATION]],
    },
    {
        name: "operation_kind binding",
        terms: [/operation_kind/, /primary key/i, /challenge/i],
        cites: [[PROTOCOL_MIGRATION]],
    },
    {
        name: "copy ownership",
        terms: [
            /dialog_title_template/,
            /dialog_description/,
            /dialog_confirm_label/,
            /app_confirmation_resolve_dialog_copy/,
            /begin_d_storage_make_public/,
        ],
        cites: [[PROTOCOL_MIGRATION], [VISIBILITY_MIGRATION]],
    },
    {
        name: "wire form",
        terms: [
            /RegistryIdentifier/,
            /AuthoritativeDialogCopy/,
            /decimal/i,
            /\bstring\b/i,
            /\bnine\b/i,
        ],
        cites: [[API_YAML]],
    },
    {
        name: "adapter role",
        terms: [/adapter/i, /transport/i, /final-success/i],
        cites: [[ADAPTER]],
    },
    {
        name: "safe fallback",
        terms: [
            /safe-copy-fallback/,
            /FRESH_INITIATION/,
            /legacy/i,
            /\bseven\b/i,
            /`Close`/,
            /Get new confirmation/,
        ],
        cites: [[DIALOG_MACHINE, PROTOCOL]],
    },
];

function factProblems(scope: Scope): string[] {
    const problems: string[] = [];
    const tokens = backtickTokens(scope.text);
    for (const fact of FACTS) {
        for (const term of fact.terms) {
            if (!term.test(scope.text)) {
                problems.push(`${fact.name}: missing term ${term}`);
            }
        }
        for (const anyOf of fact.cites) {
            const cited = tokens.some((t) =>
                anyOf.some((file) => citesFile(t, file)),
            );
            if (!cited) {
                problems.push(
                    `${fact.name}: no citation of ${anyOf.map((f) => f.split("/").pop()).join(" or ")}`,
                );
            }
        }
    }
    // Numeric claims about the first identifier must agree with the sequence.
    for (const m of scope.text.matchAll(
        /\b(?:starts?|starting)\s+at\s+(\d+)/gi,
    )) {
        if (m[1] !== "1000") {
            problems.push(
                `registry identity: states a sequence start of ${m[1]}, source says 1000`,
            );
        }
    }
    return problems;
}

// ---------------------------------------------------------------------------
// Facts: agreement with the authored sources (independent of the guidance text)
// ---------------------------------------------------------------------------

/** Top-level schema block of api.yaml (schemas are indented four spaces). */
function schemaBlock(yaml: string, name: string): string | null {
    const lines = yaml.split("\n");
    const start = lines.findIndex((l) => l === `    ${name}:`);
    if (start < 0) return null;
    let end = start + 1;
    while (end < lines.length && !/^ {0,4}\S/.test(lines[end] ?? "")) end += 1;
    return lines.slice(start, end).join("\n");
}

function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Body of `export <kind> Name<...> ... {` up to the closing brace at column 0. */
function declarationBody(source: string, header: RegExp): string | null {
    const match = header.exec(source);
    if (match === null) return null;
    const rest = source.slice(match.index + match[0].length);
    const end = rest.search(/^\}/m);
    return end < 0 ? null : rest.slice(0, end);
}

function sourceProblems(): string[] {
    const problems: string[] = [];
    const need = (ok: boolean, message: string) => {
        if (!ok) problems.push(message);
    };

    const migration = read(PROTOCOL_MIGRATION);
    const visibility = read(VISIBILITY_MIGRATION);
    const api = read(API_YAML);
    const protocol = read(PROTOCOL);
    const machine = read(DIALOG_MACHINE);
    const decoder = read(DECODE_RESULT);
    const adapter = read(ADAPTER);
    const host = read(HOST);

    // Registry identity: the sequence starts at 1000, never cycles, is bound and immutable.
    const sequence =
        /CREATE SEQUENCE public\.app_confirmable_operations_registry_id_seq[^;]*;/.exec(
            migration,
        )?.[0] ?? "";
    need(
        sequence !== "",
        "migration: sequence app_confirmable_operations_registry_id_seq is not created",
    );
    need(/\bAS BIGINT\b/.test(sequence), "migration: sequence is not BIGINT");
    need(
        /\bSTART WITH 1000\b/.test(sequence),
        "migration: sequence does not START WITH 1000",
    );
    need(
        /\bMINVALUE 1000\b/.test(sequence),
        "migration: sequence MINVALUE is not 1000",
    );
    need(
        /\bMAXVALUE 9223372036854775807\b/.test(sequence),
        "migration: sequence MAXVALUE is not the BIGINT maximum",
    );
    need(/\bNO CYCLE\b/.test(sequence), "migration: sequence is not NO CYCLE");
    need(
        /\bregistry_id\s+BIGINT\s+NOT NULL\s+DEFAULT nextval\(/.test(migration),
        "migration: registry_id is not a BIGINT column",
    );
    need(
        /CONSTRAINT app_confirmable_operations_registry_id_key UNIQUE \(registry_id\)/.test(
            migration,
        ),
        "migration: registry_id is not UNIQUE",
    );
    need(
        /CHECK \(registry_id >= 1000\)/.test(migration),
        "migration: registry_id has no >= 1000 check",
    );
    need(
        /CREATE TRIGGER app_confirmable_operations_registry_id_immutable/.test(
            migration,
        ),
        "migration: no immutability trigger for registry_id",
    );
    need(
        /OWNED BY public\.app_confirmable_operations\.registry_id/.test(
            migration,
        ),
        "migration: sequence is not owned by the column",
    );

    // operation_kind binding: still the registry primary key and the challenge foreign key.
    need(
        /operation_kind\s+TEXT PRIMARY KEY/.test(migration),
        "migration: operation_kind is not the registry PRIMARY KEY",
    );
    need(
        /operation_kind\s+TEXT\s+NOT NULL REFERENCES public\.app_confirmable_operations \(operation_kind\)/.test(
            migration,
        ),
        "migration: challenge operation_kind does not reference the registry",
    );
    need(
        !/PRIMARY KEY\s*\(\s*registry_id|ADD\s+PRIMARY\s+KEY|DROP\s+CONSTRAINT[^;]*pkey/i.test(
            migration,
        ),
        "migration: touches the registry primary key",
    );
    const challengeTable =
        /CREATE TABLE public\.app_confirmation_challenges[\s\S]*?\n\);/.exec(
            migration,
        )?.[0] ?? "";
    need(
        challengeTable !== "" && !/registry_id|dialog_/.test(challengeTable),
        "migration: the challenge table carries registry_id or copy (the binding must stay operation_kind)",
    );
    need(
        !/INSERT INTO public\.app_confirmation_challenges[^;]*registry_id/i.test(
            migration,
        ),
        "migration: a challenge insert carries registry_id",
    );

    // Copy ownership: registry columns, the resolver, and the resolving initiation function.
    for (const column of [
        "dialog_title_template",
        "dialog_description",
        "dialog_confirm_label",
    ]) {
        need(
            new RegExp(`${column}\\s+TEXT\\s+NOT NULL`).test(migration),
            `migration: ${column} is not a NOT NULL TEXT column`,
        );
    }
    need(
        /CREATE FUNCTION public\.app_confirmation_resolve_dialog_copy/.test(
            migration,
        ),
        "migration: resolver app_confirmation_resolve_dialog_copy is not defined",
    );
    need(
        /CREATE FUNCTION public\.begin_d_storage_make_public/.test(
            visibility,
        ),
        "visibility migration: begin_d_storage_make_public is not defined",
    );
    need(
        /\{\{targetLabel\}\}/.test(migration),
        "migration: no {{targetLabel}} token",
    );
    for (const bound of ["200", "2000", "80"]) {
        need(
            new RegExp(`\\b${bound}\\b`).test(migration),
            `migration: no ${bound} code point bound`,
        );
    }

    // Wire form: registryId is canonical decimal text, never a JSON number.
    const registryId = schemaBlock(api, "RegistryIdentifier");
    need(registryId !== null, "api.yaml: schema RegistryIdentifier not found");
    need(
        /^\s+type: string$/m.test(registryId ?? ""),
        "api.yaml: RegistryIdentifier is not type string",
    );
    need(
        !/type: (?:integer|number)/.test(registryId ?? ""),
        "api.yaml: RegistryIdentifier is numeric",
    );
    const copySchema = schemaBlock(api, "AuthoritativeDialogCopy");
    need(
        copySchema !== null,
        "api.yaml: schema AuthoritativeDialogCopy not found",
    );
    need(
        /required: \[title, description, confirmLabel\]/.test(copySchema ?? ""),
        "api.yaml: AuthoritativeDialogCopy required keys differ",
    );
    need(
        /additionalProperties: false/.test(copySchema ?? ""),
        "api.yaml: AuthoritativeDialogCopy allows extra keys",
    );
    for (const [key, max] of [
        ["title", 200],
        ["description", 2000],
        ["confirmLabel", 80],
    ] as const) {
        need(
            new RegExp(
                `${key}:\\s+type: string\\s+minLength: 1\\s+maxLength: ${max}\\b`,
            ).test(copySchema ?? ""),
            `api.yaml: ${key} is not 1-${max}`,
        );
    }
    const required = schemaBlock(api, "ConfirmationRequiredResult");
    need(
        required !== null,
        "api.yaml: schema ConfirmationRequiredResult not found",
    );
    const keys =
        /required: \[([^\]]*)\]/
            .exec(required ?? "")?.[1]
            ?.split(",")
            .map((k) => k.trim()) ?? [];
    need(
        keys.length === 9,
        `api.yaml: ConfirmationRequiredResult has ${keys.length} required keys, guidance says nine`,
    );
    need(
        keys.includes("registryId") && keys.includes("dialogCopy"),
        "api.yaml: ConfirmationRequiredResult lacks registryId or dialogCopy",
    );
    need(
        /additionalProperties: false/.test(required ?? ""),
        "api.yaml: ConfirmationRequiredResult allows extra keys",
    );
    need(
        /export type RegistryIdentifier = Brand<string, "RegistryIdentifier">/.test(
            protocol,
        ),
        "protocol.ts: RegistryIdentifier is not a branded string",
    );

    // Adapter role: the interface and the implementation carry no dialog text.
    const iface = declarationBody(
        stripComments(protocol),
        /export interface ConfirmableOperationAdapter<[^>]*> \{/,
    );
    need(iface !== null, "protocol.ts: ConfirmableOperationAdapter not found");
    const members = [
        ...(iface ?? "").matchAll(/^ {4}(?:readonly\s+)?(\w+)\s*[(:]/gm),
    ].map((m) => m[1]);
    need(
        JSON.stringify(members) ===
            JSON.stringify(["kind", "initiate", "confirm", "onFinalSuccess"]),
        `protocol.ts: ConfirmableOperationAdapter members are ${JSON.stringify(members)}, not kind/initiate/confirm/onFinalSuccess`,
    );
    need(
        !/\b(?:copy|dialogCopy|title|description|confirmLabel|label)\b/.test(
            iface ?? "",
        ),
        "protocol.ts: ConfirmableOperationAdapter mentions copy",
    );
    const subject = declarationBody(
        stripComments(protocol),
        /export type DialogSubject<[^\n]*> = \{/,
    );
    need(subject !== null, "protocol.ts: DialogSubject not found");
    need(
        !/^ {4}(?:readonly\s+)?label\b/m.test(subject ?? ""),
        "protocol.ts: DialogSubject has a label",
    );
    const adapterCode = stripComments(adapter);
    need(
        !/\b(?:title|description|confirmLabel|dialogCopy|label)\s*:/.test(
            adapterCode,
        ),
        "storageMakePublicAdapter.ts: holds dialog text",
    );
    need(
        /invalidateQueries/.test(adapterCode),
        "storageMakePublicAdapter.ts: does no final-success invalidation",
    );

    // Safe fallback.
    need(
        /mode: "safe-copy-fallback"/.test(protocol),
        "protocol.ts: no safe-copy-fallback mode",
    );
    need(
        /type: "FRESH_INITIATION"/.test(protocol),
        "protocol.ts: no FRESH_INITIATION event",
    );
    need(
        /event\.type === "FRESH_INITIATION"[\s\S]{0,80}state\.mode === "safe-copy-fallback"/.test(
            machine,
        ),
        "dialogMachine.ts: FRESH_INITIATION is not accepted only from safe-copy-fallback",
    );
    need(
        /shape: "legacy"|"legacy"/.test(decoder),
        "decodeResult.ts: no legacy shape",
    );
    need(
        /freshInitiation:\s*state\.mode === "safe-copy-fallback"\s*\? ENABLED : HIDDEN,\s*cancel: \{ \.\.\.ENABLED, label: "Close" \}/.test(
            machine,
        ),
        "dialogMachine.ts: the rejected state does not offer Close, and fresh initiation only in safe-copy-fallback",
    );
    need(
        /Get new confirmation/.test(host),
        "ConfirmationDialogHost.tsx: no Get new confirmation control",
    );

    return problems;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("Feature: confirmation-dialog-copy, Property 5: Durable guidance matches authored sources", () => {
    const problems: string[] = sourceProblems().map(
        (p) => `authored sources: ${p}`,
    );
    for (const scope of loadScopes()) {
        const found = [
            ...pathProblems(scope),
            ...factProblems(scope),
            ...rejectedContent(scope),
        ];
        problems.push(...found.map((p) => `${scope.name}: ${p}`));
    }
    expect(problems).toEqual([]);
});

// The detectors above must actually fire, or the property test would pass vacuously.
describe("guidance detectors", () => {
    const scopeOf = (text: string): Scope => ({
        name: "sample",
        text,
        whole: text,
    });

    test("known stale claims are rejected", () => {
        for (const sample of [
            "A new operation only adds an adapter.",
            "Dialog copy is moving into PostgreSQL.",
            "The result may still build seven keys.",
            "The adapter owns the dialog title.",
            "Adapter-owned copy stays in TypeScript.",
        ]) {
            expect(rejectedContent(scopeOf(sample))).not.toEqual([]);
        }
        expect(
            rejectedContent(
                scopeOf(
                    "The adapter holds no title, description or button label.",
                ),
            ),
        ).toEqual([]);
    });

    test("generated-source citations are rejected", () => {
        expect(
            rejectedContent(
                scopeOf("See `packages/functions/cmd/goapi/api/api.gen.go`."),
            ),
        ).not.toEqual([]);
    });

    test("secret-like and environment-specific values are rejected", () => {
        for (const sample of [
            "AWS_PROFILE=my-company-dev",
            "account 123456789012",
            "arn:aws:iam::1:role/x",
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk",
            "sk_live_abcdefghijkl",
            "postgresql://user:pass@host/db",
            "/home/someone/project",
        ]) {
            expect(rejectedContent(scopeOf(sample))).not.toEqual([]);
        }
        expect(
            rejectedContent(
                scopeOf("`20261102090100` and 9223372036854775807"),
            ),
        ).toEqual([]);
    });

    test("shorthand and missing paths are resolved against the repository", () => {
        expect(
            pathExists("RACCRUDTable/confirmation/ConfirmationDialogHost.tsx"),
        ).toBe(true);
        expect(pathExists(".../storage/StorageThumbnail.tsx")).toBe(true);
        expect(pathExists("packages/does/not/exist.ts")).toBe(false);
        expect(pathExists("nowhere/ghost.go")).toBe(false);
    });
});
