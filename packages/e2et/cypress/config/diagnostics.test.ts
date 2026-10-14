import { describe, test } from "bun:test";
import fc from "fast-check";
import { fcParams } from "./proptest.js";
import { parseTestUsers } from "./runtime.js";
import {
  PrerequisiteError,
  runBoundedProbe,
} from "../tasks/prerequisites.js";

// Property 5: Cypress Diagnostics Exclude Sensitive Values.
// Feature: stage-aware-cypress-harness, Property 5: Cypress Diagnostics Exclude Sensitive Values
describe("Property 5: Cypress Diagnostics Exclude Sensitive Values", () => {
  const { numRuns, seed } = fcParams();

  test("parser errors never echo the raw payload or identifiers", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.string({ minLength: 1, maxLength: 40 }),
        (idA, idB) => {
          // Build an invalid payload (duplicate identifiers) from secret-like
          // identifiers and assert the thrown message contains neither.
          const raw = JSON.stringify([{ user_id: idA }, { user_id: idA }]);
          try {
            parseTestUsers(raw);
            return false; // duplicates must be rejected
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // The identifier value must not appear in the error.
            if (idA.length >= 3 && message.includes(idA)) {
              return false;
            }
            // And an unrelated identifier obviously should not appear.
            if (idB.length >= 3 && message.includes(idB) && idB !== idA) {
              return false;
            }
            return true;
          }
        },
      ),
      { numRuns, seed },
    );
  });

  test("prerequisite errors never echo probe failure text", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 60 }), async (secret) => {
        try {
          await runBoundedProbe(
            "clerk-testing-token",
            { perAttemptMs: 10, attempts: 1 },
            async () => {
              throw new Error(`denied: ${secret}`);
            },
          );
          return false;
        } catch (err) {
          if (!(err instanceof PrerequisiteError)) {
            return false;
          }
          // the probe's secret-bearing text must not leak
          return secret.length < 3 || !err.message.includes(secret);
        }
      }),
      { numRuns, seed },
    );
  });
});
