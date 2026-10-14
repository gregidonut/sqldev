// Pure suite-initialization planning. Given the stage and whether a full local
// reset was requested, it selects exactly one initialization action. Staging
// never selects a local reset, and never allows the local-only full reset.

import type { SupportedStage } from "../config/runtime.js";

export type SuitePlan =
  | Readonly<{ kind: "local-truncate" }>
  | Readonly<{ kind: "local-full-reset" }>
  | Readonly<{ kind: "staging-reset" }>;

export class SuitePlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SuitePlanError";
  }
}

/**
 * Selects the single initialization plan for a run.
 * - dev: local truncate, or the local full reset when explicitly requested.
 * - staging: coordinated staging reset; a requested full reset is refused
 *   because E2E_FULL_DB_RESET is a local-only Supabase operation.
 */
export function planSuiteInitialization(
  stage: SupportedStage,
  fullResetRequested: boolean,
): SuitePlan {
  if (stage === "dev") {
    return fullResetRequested
      ? { kind: "local-full-reset" }
      : { kind: "local-truncate" };
  }
  if (stage === "staging") {
    if (fullResetRequested) {
      throw new SuitePlanError(
        "E2E_FULL_DB_RESET is local-only and is refused for staging",
      );
    }
    return { kind: "staging-reset" };
  }
  // SupportedStage is exhaustively dev|staging; this guards against widening.
  throw new SuitePlanError(`unsupported stage for suite initialization`);
}
