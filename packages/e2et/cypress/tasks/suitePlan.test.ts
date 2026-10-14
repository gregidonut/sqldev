import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { fcParams } from "../config/proptest.js";
import {
  planSuiteInitialization,
  SuitePlanError,
  type SuitePlan,
} from "./suitePlan.js";

describe("planSuiteInitialization", () => {
  test("dev without full reset -> local truncate", () => {
    expect(planSuiteInitialization("dev", false)).toEqual({
      kind: "local-truncate",
    });
  });

  test("dev with full reset -> local full reset", () => {
    expect(planSuiteInitialization("dev", true)).toEqual({
      kind: "local-full-reset",
    });
  });

  test("staging without full reset -> staging reset", () => {
    expect(planSuiteInitialization("staging", false)).toEqual({
      kind: "staging-reset",
    });
  });

  test("staging with full reset is refused", () => {
    expect(() => planSuiteInitialization("staging", true)).toThrow(
      SuitePlanError,
    );
  });
});

// Property 7: Cleanup Dispatch Cannot Cross Stage Boundaries.
// Feature: stage-aware-cypress-harness, Property 7: Cleanup Dispatch Cannot Cross Stage Boundaries
describe("Property 7: Cleanup Dispatch Cannot Cross Stage Boundaries", () => {
  const { numRuns, seed } = fcParams();

  test("exactly the approved plan is selected per stage", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<"dev" | "staging">("dev", "staging"),
        fc.boolean(),
        (stage, fullReset) => {
          let plan: SuitePlan | undefined;
          let threw = false;
          try {
            plan = planSuiteInitialization(stage, fullReset);
          } catch {
            threw = true;
          }

          if (stage === "staging" && fullReset) {
            // staging never performs a local full reset
            return threw && plan === undefined;
          }
          if (stage === "staging") {
            return !threw && plan!.kind === "staging-reset";
          }
          // dev
          const expected = fullReset ? "local-full-reset" : "local-truncate";
          return !threw && plan!.kind === expected;
        },
      ),
      { numRuns, seed },
    );
  });
});
