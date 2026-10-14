// Pure assembly of the Cypress environment used for a run. It starts from every
// entry returned by Clerk clerkSetup, then adds only the harness-owned keys.
// A reserved-key collision is rejected rather than silently overwriting a Clerk
// value, so unrelated Clerk output is always preserved.

import type { RuntimeConfig } from "./runtime.js";

// Keys the harness owns. clerkSetup must not return these; a collision is a bug.
export const HARNESS_KEYS = [
  "test_users",
  "E2E_RUN_ID",
  "E2E_STAGE",
  "E2E_EXPECTED_ORIGIN",
] as const;

export class HarnessEnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarnessEnvironmentError";
  }
}

/**
 * Merges Clerk setup output with the validated harness runtime. Returns a new
 * object; inputs are not mutated. Throws if clerkSetup already defined a
 * reserved harness key.
 */
export function mergeHarnessEnvironment(
  clerkEnv: Readonly<Record<string, unknown>>,
  runtime: RuntimeConfig,
  runId: string,
): Record<string, unknown> {
  for (const key of HARNESS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(clerkEnv, key)) {
      throw new HarnessEnvironmentError(
        `clerk setup unexpectedly defined reserved key ${key}`,
      );
    }
  }

  return {
    ...clerkEnv,
    test_users: runtime.testUsers,
    E2E_RUN_ID: runId,
    E2E_STAGE: runtime.stage,
    E2E_EXPECTED_ORIGIN: runtime.expectedOrigin,
  };
}
