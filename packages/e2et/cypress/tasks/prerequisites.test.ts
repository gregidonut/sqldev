import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { fcParams } from "../config/proptest.js";
import {
  BUDGETS,
  PrerequisiteError,
  runBoundedProbe,
  type FailureCategory,
} from "./prerequisites.js";

const fastBudget = { perAttemptMs: 20, attempts: 2 };

describe("runBoundedProbe", () => {
  test("returns on first success", async () => {
    let calls = 0;
    await runBoundedProbe("frontend-reachability", fastBudget, async () => {
      calls += 1;
    });
    expect(calls).toBe(1);
  });

  test("retries then succeeds", async () => {
    let calls = 0;
    await runBoundedProbe("go-api-reachability", { perAttemptMs: 50, attempts: 3 }, async () => {
      calls += 1;
      if (calls < 2) {
        throw new Error("unreachable");
      }
    });
    expect(calls).toBe(2);
  });

  test("throws a category-only PrerequisiteError after exhausting attempts", async () => {
    try {
      await runBoundedProbe("clerk-testing-token", fastBudget, async () => {
        throw new Error("403 forbidden: secret-token-abc");
      });
      throw new Error("expected failure");
    } catch (err) {
      expect(err).toBeInstanceOf(PrerequisiteError);
      const pe = err as PrerequisiteError;
      expect(pe.category).toBe("denied-permission");
      // never leaks the probe error text
      expect(pe.message).not.toContain("secret-token-abc");
    }
  });

  test("timeout aborts the attempt and categorizes as timeout", async () => {
    try {
      await runBoundedProbe(
        "supabase-reachability",
        { perAttemptMs: 10, attempts: 1 },
        (signal) =>
          new Promise<void>((_, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      );
      throw new Error("expected failure");
    } catch (err) {
      expect((err as PrerequisiteError).category).toBe("timeout");
    }
  });
});

// Property 11: Runtime Probes Respect Their Budgets.
// Feature: stage-aware-cypress-harness, Property 11: Runtime Probes Respect Their Budgets
describe("Property 11: Runtime Probes Respect Their Budgets", () => {
  const { numRuns, seed } = fcParams();

  test("probe result/output is name + fixed category only, within attempts", async () => {
    const names = Object.keys(BUDGETS) as (keyof typeof BUDGETS)[];
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...names),
        fc.integer({ min: 0, max: 5 }),
        fc.boolean(),
        async (name, failUntil, eventuallySucceed) => {
          let calls = 0;
          const budget = { perAttemptMs: 30, attempts: 3 };
          let category: FailureCategory | "ok" = "ok";
          try {
            await runBoundedProbe(name, budget, async () => {
              calls += 1;
              if (eventuallySucceed && calls > failUntil) {
                return;
              }
              throw new Error("unreachable");
            });
          } catch (err) {
            if (!(err instanceof PrerequisiteError)) {
              return false;
            }
            category = err.category;
            // message contains the prerequisite name and category only; it must
            // not leak the raw probe error text.
            if (!err.message.includes(name) || err.message.includes("Error:")) {
              return false;
            }
          }
          // never exceeds the attempt budget
          return calls <= budget.attempts && category !== undefined;
        },
      ),
      { numRuns, seed },
    );
  });
});
