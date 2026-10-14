import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { fcParams } from "./proptest.js";
import {
  consumeRuntimeEnvironment,
  ENV_EXPECTED_ORIGIN,
  ENV_STAGE,
  ENV_TEST_USERS_JSON,
  parseTestUsers,
  RuntimeConfigError,
} from "./runtime.js";

const VALID = `[{"user_id":"user_a"},{"user_id":"user_b"}]`;

describe("parseTestUsers", () => {
  test("accepts exactly two distinct ordered users", () => {
    const users = parseTestUsers(VALID);
    expect(users).toHaveLength(2);
    expect(users[0].user_id).toBe("user_a");
    expect(users[1].user_id).toBe("user_b");
  });

  test("accepts the legacy { test_users: [...] } wrapper object", () => {
    const users = parseTestUsers(
      `{"test_users":[{"user_id":"user_a"},{"user_id":"user_b"}]}`,
    );
    expect(users).toHaveLength(2);
    expect(users[0].user_id).toBe("user_a");
    expect(users[1].user_id).toBe("user_b");
  });

  test("rejects a wrapper object with extra keys", () => {
    expect(() =>
      parseTestUsers(
        `{"test_users":[{"user_id":"a"},{"user_id":"b"}],"x":1}`,
      ),
    ).toThrow(RuntimeConfigError);
  });

  test("preserves source order", () => {
    const users = parseTestUsers(`[{"user_id":"second"},{"user_id":"first"}]`);
    expect(users[0].user_id).toBe("second");
    expect(users[1].user_id).toBe("first");
  });

  test.each<[string, string]>([
    ["not json", "{"],
    ["not an array", `{"user_id":"a"}`],
    ["one entry", `[{"user_id":"a"}]`],
    ["three entries", `[{"user_id":"a"},{"user_id":"b"},{"user_id":"c"}]`],
    ["non-object entry", `["a","b"]`],
    ["extra property", `[{"user_id":"a","x":1},{"user_id":"b"}]`],
    ["missing user_id", `[{"id":"a"},{"user_id":"b"}]`],
    ["blank user_id", `[{"user_id":"  "},{"user_id":"b"}]`],
    ["non-string user_id", `[{"user_id":5},{"user_id":"b"}]`],
    ["duplicate identifiers", `[{"user_id":"a"},{"user_id":"a"}]`],
  ])("rejects %s", (_label, raw) => {
    expect(() => parseTestUsers(raw)).toThrow(RuntimeConfigError);
  });

  test("error messages never contain the identifier", () => {
    try {
      parseTestUsers(`[{"user_id":"a"},{"user_id":"a"}]`);
      throw new Error("expected rejection");
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeConfigError);
      expect((err as Error).message).not.toContain("user_id");
      // category message does not echo the identifier value
      expect((err as Error).message).toContain("distinct");
    }
  });
});

describe("consumeRuntimeEnvironment", () => {
  test("parses dev runtime and deletes the raw secret key", () => {
    const env: NodeJS.ProcessEnv = {
      [ENV_STAGE]: "dev",
      [ENV_EXPECTED_ORIGIN]: "http://localhost:4321",
      [ENV_TEST_USERS_JSON]: VALID,
    };
    const runtime = consumeRuntimeEnvironment(env);
    expect(runtime.stage).toBe("dev");
    expect(runtime.expectedOrigin).toBe("http://localhost:4321");
    expect(runtime.testUsers).toHaveLength(2);
    expect(env[ENV_TEST_USERS_JSON]).toBeUndefined();
  });

  test("deletes the raw secret key even when parsing fails", () => {
    const env: NodeJS.ProcessEnv = {
      [ENV_STAGE]: "staging",
      [ENV_EXPECTED_ORIGIN]: "https://dev.sqldev.gregosilaja.cc",
      [ENV_TEST_USERS_JSON]: "not-json",
    };
    expect(() => consumeRuntimeEnvironment(env)).toThrow(RuntimeConfigError);
    expect(env[ENV_TEST_USERS_JSON]).toBeUndefined();
  });

  test("rejects unsupported stage", () => {
    const env: NodeJS.ProcessEnv = {
      [ENV_STAGE]: "prod",
      [ENV_EXPECTED_ORIGIN]: "https://x",
      [ENV_TEST_USERS_JSON]: VALID,
    };
    expect(() => consumeRuntimeEnvironment(env)).toThrow(RuntimeConfigError);
  });
});

// Property 4: Test-User Validation Is Exact and Ordered.
// Feature: stage-aware-cypress-harness, Property 4: Test-User Validation Is Exact and Ordered
describe("Property 4: Test-User Validation Is Exact and Ordered", () => {
  const { numRuns, seed } = fcParams();

  test("acceptance iff two ordered distinct sole-key user_id objects", () => {
    const anyJsonValue = fc.jsonValue();
    fc.assert(
      fc.property(anyJsonValue, (value) => {
        const raw = JSON.stringify(value);
        let accepted = true;
        let result: readonly { user_id: string }[] | undefined;
        try {
          result = parseTestUsers(raw);
        } catch {
          accepted = false;
        }

        const expectedValid = isTwoDistinctUsers(value);

        if (accepted !== expectedValid) {
          return false;
        }
        if (accepted && result) {
          const list = unwrapForOracle(value);
          const first = list[0] as Record<string, string>;
          const second = list[1] as Record<string, string>;
          return (
            result[0]!.user_id === first.user_id &&
            result[1]!.user_id === second.user_id
          );
        }
        return true;
      }),
      { numRuns, seed },
    );
  });
});

/** Unwraps the legacy wrapper for the order-preservation oracle. */
function unwrapForOracle(value: unknown): unknown[] {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray((value as Record<string, unknown>).test_users)
  ) {
    return (value as Record<string, unknown>).test_users as unknown[];
  }
  return value as unknown[];
}

/** Mirror of the parser's acceptance rule, for property cross-checking. */
function isTwoDistinctUsers(value: unknown): boolean {
  // Accept the legacy { test_users: [...] } wrapper exactly as the parser does.
  let list: unknown = value;
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as object).length === 1 &&
    Array.isArray((value as Record<string, unknown>).test_users)
  ) {
    list = (value as Record<string, unknown>).test_users;
  }
  if (!Array.isArray(list) || list.length !== 2) {
    return false;
  }
  const valid = (e: unknown): e is { user_id: string } => {
    if (e === null || typeof e !== "object" || Array.isArray(e)) {
      return false;
    }
    const keys = Object.keys(e as object);
    if (keys.length !== 1 || keys[0] !== "user_id") {
      return false;
    }
    const id = (e as { user_id?: unknown }).user_id;
    return typeof id === "string" && id.trim().length > 0;
  };
  const first = list[0];
  const second = list[1];
  if (!valid(first) || !valid(second)) {
    return false;
  }
  return first.user_id !== second.user_id;
}
