// Pure, side-effect-free parsing of the stage-aware runtime that the sqldev Go
// CLI injects into the Cypress config process. The raw CyTestUsersJson secret
// is validated here exactly once. Every failure is a constant-category message
// that contains no payload and no identifier.

export type SupportedStage = "dev" | "staging";

export type TestUser = Readonly<{ user_id: string }>;
export type TestUsers = readonly [TestUser, TestUser];

export type RuntimeConfig = Readonly<{
  stage: SupportedStage;
  expectedOrigin: string;
  testUsers: TestUsers;
}>;

// Internal env keys injected by the Go CLI (see internal/e2econfig).
export const ENV_STAGE = "SQLDEV_E2E_STAGE";
export const ENV_EXPECTED_ORIGIN = "SQLDEV_E2E_EXPECTED_ORIGIN";
export const ENV_TEST_USERS_JSON = "SQLDEV_E2E_TEST_USERS_JSON";

/** Thrown for any invalid runtime input. Messages never include secrets. */
export class RuntimeConfigError extends Error {
  constructor(category: string) {
    super(category);
    this.name = "RuntimeConfigError";
  }
}

function isSupportedStage(value: unknown): value is SupportedStage {
  return value === "dev" || value === "staging";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates the raw CyTestUsersJson payload. Accepts either a bare JSON array
 * of two users, or the historical `cypress.env.json` wrapper object
 * `{ "test_users": [...] }` (the shape produced by `cat cypress.env.json`).
 * Either way the inner value must be exactly two objects, each with only the
 * `user_id` key whose trimmed value is a non-empty string, with the two
 * identifiers distinct. Returns new frozen objects in source order.
 */
export function parseTestUsers(raw: string): TestUsers {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RuntimeConfigError("test users: payload is not valid JSON");
  }

  // Unwrap the legacy { test_users: [...] } object shape if present.
  const list = unwrapTestUsers(parsed);

  if (!Array.isArray(list)) {
    throw new RuntimeConfigError("test users: payload is not an array");
  }
  if (list.length !== 2) {
    throw new RuntimeConfigError("test users: expected exactly two entries");
  }

  const users = list.map((entry, index): TestUser => {
    if (!isRecord(entry)) {
      throw new RuntimeConfigError(
        `test users: entry ${index} is not an object`,
      );
    }
    const keys = Object.keys(entry);
    if (keys.length !== 1 || keys[0] !== "user_id") {
      throw new RuntimeConfigError(
        `test users: entry ${index} must contain only user_id`,
      );
    }
    const id = entry.user_id;
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new RuntimeConfigError(
        `test users: entry ${index} user_id must be a non-empty string`,
      );
    }
    return Object.freeze({ user_id: id });
  });

  if (users[0]!.user_id === users[1]!.user_id) {
    throw new RuntimeConfigError("test users: identifiers must be distinct");
  }

  return Object.freeze([users[0]!, users[1]!]) as TestUsers;
}

/**
 * Returns the user array from either a bare array payload or the legacy
 * `{ "test_users": [...] }` wrapper. Any other value is returned unchanged so
 * the array check rejects it with a clear category.
 */
function unwrapTestUsers(parsed: unknown): unknown {
  if (
    isRecord(parsed) &&
    Object.keys(parsed).length === 1 &&
    Array.isArray(parsed.test_users)
  ) {
    return parsed.test_users;
  }
  return parsed;
}

/**
 * Reads and validates the Go-provided runtime from the process environment.
 * The raw test-user key is always deleted from `env` before returning, even on
 * failure, so it cannot leak into Cypress's public config.env.
 */
export function consumeRuntimeEnvironment(
  env: NodeJS.ProcessEnv,
): RuntimeConfig {
  const stage = env[ENV_STAGE];
  const expectedOrigin = env[ENV_EXPECTED_ORIGIN];
  const rawUsers = env[ENV_TEST_USERS_JSON];

  try {
    if (!isSupportedStage(stage)) {
      throw new RuntimeConfigError("stage: unsupported or missing");
    }
    if (typeof expectedOrigin !== "string" || expectedOrigin.length === 0) {
      throw new RuntimeConfigError("expected origin: missing");
    }
    if (typeof rawUsers !== "string" || rawUsers.length === 0) {
      throw new RuntimeConfigError("test users: secret was not provided");
    }
    const testUsers = parseTestUsers(rawUsers);
    return Object.freeze({ stage, expectedOrigin, testUsers });
  } finally {
    // The raw secret must never remain in the environment Cypress inherits.
    delete env[ENV_TEST_USERS_JSON];
  }
}
