import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { fcParams } from "../config/proptest.js";
import {
  assertDirectLocalDbUrl,
  assertLocalApiUrl,
  assertLocalDevStage,
} from "./localDbReset.js";

const DB_PORT = 54322 as number;
const POOLER_PORT = 54329 as number;
const API_PORT = 54321 as number;

describe("assertLocalDevStage", () => {
  const original = process.env.STAGE;
  const originalSst = process.env.SST_STAGE;

  function withStage(stage: string | undefined, fn: () => void) {
    if (stage === undefined) {
      delete process.env.STAGE;
    } else {
      process.env.STAGE = stage;
    }
    delete process.env.SST_STAGE;
    try {
      fn();
    } finally {
      if (original === undefined) delete process.env.STAGE;
      else process.env.STAGE = original;
      if (originalSst === undefined) delete process.env.SST_STAGE;
      else process.env.SST_STAGE = originalSst;
    }
  }

  test.each(["dev", "local", "development"])("accepts %s", (stage: string) => {
    withStage(stage, () => {
      expect(assertLocalDevStage()).toBe(stage);
    });
  });

  test.each(["staging", "prod", "production", "", "Dev"])(
    "rejects %s",
    (stage: string) => {
      withStage(stage === "" ? undefined : stage, () => {
        expect(() => assertLocalDevStage()).toThrow();
      });
    },
  );
});

describe("assertDirectLocalDbUrl", () => {
  test("accepts the direct loopback db port", () => {
    const url = assertDirectLocalDbUrl(
      `postgresql://postgres:postgres@127.0.0.1:${DB_PORT}/postgres`,
      DB_PORT,
      POOLER_PORT,
    );
    expect(Number(url.port)).toBe(DB_PORT);
  });

  test("rejects the pooler port", () => {
    expect(() =>
      assertDirectLocalDbUrl(
        `postgresql://postgres@127.0.0.1:${POOLER_PORT}/postgres`,
        DB_PORT,
        POOLER_PORT,
      ),
    ).toThrow();
  });

  test("rejects a non-loopback host", () => {
    expect(() =>
      assertDirectLocalDbUrl(
        `postgresql://postgres@db.example.com:${DB_PORT}/postgres`,
        DB_PORT,
        POOLER_PORT,
      ),
    ).toThrow();
  });

  test("rejects a non-postgres protocol", () => {
    expect(() =>
      assertDirectLocalDbUrl(`mysql://127.0.0.1:${DB_PORT}/x`, DB_PORT, POOLER_PORT),
    ).toThrow();
  });
});

// Property 8: Local Endpoint Validation Is Fail-Closed.
// Feature: stage-aware-cypress-harness, Property 8: Local Endpoint Validation Is Fail-Closed
describe("Property 8: Local Endpoint Validation Is Fail-Closed", () => {
  const { numRuns, seed } = fcParams();

  test("db authorization only for the exact direct loopback port", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("127.0.0.1", "localhost", "::1", "db.example.com", "10.0.0.5"),
        fc.integer({ min: 1024, max: 65535 }),
        (host, port) => {
          const hostPart = host === "::1" ? "[::1]" : host;
          const url = `postgresql://postgres@${hostPart}:${port}/postgres`;
          let ok = true;
          try {
            assertDirectLocalDbUrl(url, DB_PORT, POOLER_PORT);
          } catch {
            ok = false;
          }
          const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
          const expected = loopback && port === DB_PORT && port !== POOLER_PORT;
          return ok === expected;
        },
      ),
      { numRuns, seed },
    );
  });

  test("api authorization only for the exact loopback api port", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("127.0.0.1", "localhost", "evil.example.com"),
        fc.integer({ min: 1024, max: 65535 }),
        (host, port) => {
          const url = `http://${host}:${port}`;
          let ok = true;
          try {
            assertLocalApiUrl(url, API_PORT);
          } catch {
            ok = false;
          }
          const loopback = host === "127.0.0.1" || host === "localhost";
          return ok === (loopback && port === API_PORT);
        },
      ),
      { numRuns, seed },
    );
  });
});
