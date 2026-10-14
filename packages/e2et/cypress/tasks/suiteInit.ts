import type { SupportedStage } from "../config/runtime.js";
import { revokeCachedClerkSessions } from "./clerk.js";
import { assertLocalDevStage, truncateLocalTestData } from "./localDbReset.js";
import { deleteRegisteredObjects } from "./preparedObjects.js";
import { acquireRunLock, releaseRunLock } from "./runLock.js";
import { stagingReset, stagingResetPreflight } from "./stagingReset.js";
import { supabaseDbReset } from "./supabaseDbReset.js";
import { planSuiteInitialization } from "./suitePlan.js";

export type SuiteRuntime = Readonly<{
  stage: SupportedStage;
  expectedOrigin: string;
}>;

export function assertSerialRun(details: { parallel?: boolean }): void {
  if (details.parallel) {
    throw new Error(
      "Refusing the shared reset while Cypress parallel mode is enabled. Give each worker an isolated backend before running in parallel.",
    );
  }
}

export async function initializeSuite(
  details: { parallel?: boolean },
  runId: string,
  runtime: SuiteRuntime,
): Promise<void> {
  assertSerialRun(details);
  acquireRunLock(runId);
  try {
    const fullResetRequested = process.env.E2E_FULL_DB_RESET === "1";
    const plan = planSuiteInitialization(runtime.stage, fullResetRequested);

    switch (plan.kind) {
      case "local-truncate":
        assertLocalDevStage();
        await truncateLocalTestData();
        break;
      case "local-full-reset":
        await supabaseDbReset();
        break;
      case "staging-reset":
        // The destructive reset and its guards live in the Go CLI, which only
        // authorizes the exact 'staging' stage. Preflight first for an early,
        // separately attributable failure, then run the coordinated reset.
        await stagingResetPreflight();
        await stagingReset();
        break;
    }
  } catch (err) {
    releaseRunLock();
    throw err;
  }
}

export async function finishSuite(): Promise<void> {
  try {
    await deleteRegisteredObjects();
    await revokeCachedClerkSessions();
  } finally {
    releaseRunLock();
  }
}
