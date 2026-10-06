import { revokeCachedClerkSessions } from "./clerk.js";
import {
  assertLocalDevStage,
  truncateLocalTestData,
} from "./localDbReset.js";
import { deleteRegisteredObjects } from "./preparedObjects.js";
import { acquireRunLock, releaseRunLock } from "./runLock.js";
import { supabaseDbReset } from "./supabaseDbReset.js";

export function assertSerialRun(details: { parallel?: boolean }): void {
  if (details.parallel) {
    throw new Error(
      "Refusing the shared local reset while Cypress parallel mode is enabled. Give each worker an isolated Supabase project and bucket before running in parallel.",
    );
  }
}

export async function initializeSuite(
  details: { parallel?: boolean },
  runId: string,
): Promise<void> {
  assertSerialRun(details);
  assertLocalDevStage();
  acquireRunLock(runId);
  try {
    if (process.env.E2E_FULL_DB_RESET === "1") {
      await supabaseDbReset();
      return;
    }
    await truncateLocalTestData();
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
