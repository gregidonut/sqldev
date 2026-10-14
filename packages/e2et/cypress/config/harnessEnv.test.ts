import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { fcParams } from "./proptest.js";
import {
  HarnessEnvironmentError,
  HARNESS_KEYS,
  mergeHarnessEnvironment,
} from "./harnessEnv.js";
import type { RuntimeConfig } from "./runtime.js";

const runtime: RuntimeConfig = Object.freeze({
  stage: "staging",
  expectedOrigin: "https://dev.sqldev.gregosilaja.cc",
  testUsers: Object.freeze([
    Object.freeze({ user_id: "a" }),
    Object.freeze({ user_id: "b" }),
  ]) as RuntimeConfig["testUsers"],
});

describe("mergeHarnessEnvironment", () => {
  test("preserves unrelated clerk entries and adds harness keys", () => {
    const clerkEnv = { CLERK_FAPI: "clerk.example.com", CLERK_TESTING_TOKEN: "t" };
    const merged = mergeHarnessEnvironment(clerkEnv, runtime, "run-123");
    expect(merged.CLERK_FAPI).toBe("clerk.example.com");
    expect(merged.CLERK_TESTING_TOKEN).toBe("t");
    expect(merged.test_users).toBe(runtime.testUsers);
    expect(merged.E2E_RUN_ID).toBe("run-123");
    expect(merged.E2E_STAGE).toBe("staging");
    expect(merged.E2E_EXPECTED_ORIGIN).toBe(runtime.expectedOrigin);
  });

  test("does not mutate the clerk input", () => {
    const clerkEnv = { CLERK_FAPI: "x" };
    mergeHarnessEnvironment(clerkEnv, runtime, "run-1");
    expect(Object.keys(clerkEnv)).toEqual(["CLERK_FAPI"]);
  });

  test.each([...HARNESS_KEYS])("rejects reserved-key collision %s", (key: string) => {
    const clerkEnv = { [key]: "collision" };
    expect(() => mergeHarnessEnvironment(clerkEnv, runtime, "r")).toThrow(
      HarnessEnvironmentError,
    );
  });
});

// Property 6: Harness Configuration Preserves Clerk Output.
// Feature: stage-aware-cypress-harness, Property 6: Harness Configuration Preserves Clerk Output
describe("Property 6: Harness Configuration Preserves Clerk Output", () => {
  const { numRuns, seed } = fcParams();

  test("unrelated clerk entries preserved; harness keys exact; collisions rejected", () => {
    const reserved = new Set<string>(HARNESS_KEYS);
    const nonReservedKey = fc
      .string({ minLength: 1, maxLength: 12 })
      .filter((k) => !reserved.has(k));

    fc.assert(
      fc.property(
        fc.dictionary(nonReservedKey, fc.string()),
        fc.string({ minLength: 1 }),
        (clerkEnv, runId) => {
          const merged = mergeHarnessEnvironment(clerkEnv, runtime, runId);
          for (const [k, v] of Object.entries(clerkEnv)) {
            if (merged[k] !== v) {
              return false;
            }
          }
          return (
            merged.E2E_RUN_ID === runId &&
            merged.E2E_STAGE === runtime.stage &&
            merged.E2E_EXPECTED_ORIGIN === runtime.expectedOrigin &&
            merged.test_users === runtime.testUsers
          );
        },
      ),
      { numRuns, seed },
    );

    // A reserved collision always throws.
    fc.assert(
      fc.property(fc.constantFrom(...HARNESS_KEYS), (key) => {
        try {
          mergeHarnessEnvironment({ [key]: "x" }, runtime, "r");
          return false;
        } catch (err) {
          return err instanceof HarnessEnvironmentError;
        }
      }),
      { numRuns, seed },
    );
  });
});
