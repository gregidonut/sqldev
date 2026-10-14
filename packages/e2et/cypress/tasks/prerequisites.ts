// Bounded staging runtime prerequisite checks. Each probe runs under a total
// budget and returns only a fixed category on failure. Tokens and JWTs are
// used in memory and discarded; no sensitive value is ever returned or logged.

export type PrerequisiteName =
  | "clerk-testing-token"
  | "clerk-dev-browser"
  | "actor-0-supabase-jwt"
  | "actor-1-supabase-jwt"
  | "frontend-reachability"
  | "go-api-reachability"
  | "supabase-reachability";

export type FailureCategory =
  | "missing-configuration"
  | "denied-permission"
  | "unreachable-endpoint"
  | "timeout"
  | "invalid-response";

export class PrerequisiteError extends Error {
  readonly prerequisite: PrerequisiteName;
  readonly category: FailureCategory;
  constructor(prerequisite: PrerequisiteName, category: FailureCategory) {
    super(`prerequisite ${prerequisite} failed: ${category}`);
    this.name = "PrerequisiteError";
    this.prerequisite = prerequisite;
    this.category = category;
  }
}

export type ProbeBudget = Readonly<{
  perAttemptMs: number;
  attempts: number;
}>;

export type Probe = (signal: AbortSignal) => Promise<void>;

/**
 * Runs probe up to budget.attempts times, each attempt bounded by
 * perAttemptMs. Returns on first success. Throws a PrerequisiteError whose
 * message contains only the name and category. Never includes probe output.
 */
export async function runBoundedProbe(
  name: PrerequisiteName,
  budget: ProbeBudget,
  probe: Probe,
  categorize: (err: unknown) => FailureCategory = defaultCategorize,
): Promise<void> {
  let lastCategory: FailureCategory = "unreachable-endpoint";
  for (let attempt = 0; attempt < budget.attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budget.perAttemptMs);
    try {
      await probe(controller.signal);
      return;
    } catch (err) {
      lastCategory = controller.signal.aborted ? "timeout" : categorize(err);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new PrerequisiteError(name, lastCategory);
}

function defaultCategorize(err: unknown): FailureCategory {
  if (err instanceof PrerequisiteError) {
    return err.category;
  }
  const message =
    err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (message.includes("abort") || message.includes("timeout")) {
    return "timeout";
  }
  if (message.includes("denied") || message.includes("forbidden") || message.includes("401") || message.includes("403")) {
    return "denied-permission";
  }
  if (message.includes("missing") || message.includes("not configured")) {
    return "missing-configuration";
  }
  if (message.includes("parse") || message.includes("invalid")) {
    return "invalid-response";
  }
  return "unreachable-endpoint";
}

// Default budgets per the design table.
export const BUDGETS: Record<PrerequisiteName, ProbeBudget> = {
  "clerk-testing-token": { perAttemptMs: 10_000, attempts: 3 },
  "clerk-dev-browser": { perAttemptMs: 10_000, attempts: 3 },
  "actor-0-supabase-jwt": { perAttemptMs: 10_000, attempts: 3 },
  "actor-1-supabase-jwt": { perAttemptMs: 10_000, attempts: 3 },
  "frontend-reachability": { perAttemptMs: 5_000, attempts: 3 },
  "go-api-reachability": { perAttemptMs: 5_000, attempts: 3 },
  "supabase-reachability": { perAttemptMs: 5_000, attempts: 3 },
};
