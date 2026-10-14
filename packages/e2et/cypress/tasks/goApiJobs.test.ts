import { describe, expect, test } from "bun:test";
import { firstResultField, frontendOrigin } from "./apiSeed.js";
import { GoApiJobError, runJob, type JobTransport } from "./goApiJobs.js";

type Step = Response | Error;

/** Scripted fetch: each call consumes the next step; records every request. */
function scripted(steps: Step[]) {
  const calls: { url: string; method: string; headers: Headers; body?: BodyInit | null }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: String(init.method),
      headers: new Headers(init.headers),
      body: init.body ?? null,
    });
    const step = steps.shift();
    if (step === undefined) {
      throw new Error("script exhausted");
    }
    if (step instanceof Error) {
      throw step;
    }
    return step;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

function transport(
  fetchImpl: typeof fetch,
  overrides: Partial<JobTransport> = {},
): JobTransport {
  let tokens = 0;
  let clock = 0;
  return {
    baseUrl: "https://api.example.com/stage",
    getToken: async () => `tok-${(tokens += 1)}`,
    fetchImpl,
    sleep: async (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    newKey: () => "key-1",
    timeoutMs: 10_000,
    ...overrides,
  };
}

const request = {
  method: "POST",
  path: "/api/views/igPosts/new/item",
  fields: { p_text_content: "hello", p_public: "true" },
} as const;

describe("runJob", () => {
  test("submits then polls until completed and returns the result", async () => {
    const { impl, calls } = scripted([
      json(202, { jobId: "job-1", status: "pending" }),
      json(200, { jobId: "job-1", status: "running" }),
      json(200, { jobId: "job-1", status: "completed", result: [{ post_id: "p1" }] }),
    ]);
    const result = await runJob(transport(impl), request);
    expect(result).toEqual([{ post_id: "p1" }]);
    expect(calls[0]?.url).toBe("https://api.example.com/stage/api/views/igPosts/new/item");
    expect(calls[0]?.headers.get("idempotency-key")).toBe("key-1");
    expect(calls[1]?.url).toBe("https://api.example.com/stage/api/jobs/job-1");
  });

  test("requests a fresh bearer token for every call", async () => {
    const { impl, calls } = scripted([
      json(202, { jobId: "job-1" }),
      json(200, { status: "running" }),
      json(200, { status: "completed", result: [] }),
    ]);
    await runJob(transport(impl), request);
    const auths = calls.map((c) => c.headers.get("authorization"));
    expect(new Set(auths).size).toBe(3);
  });

  test("sends the form fields as multipart", async () => {
    const { impl, calls } = scripted([
      json(202, { jobId: "job-1" }),
      json(200, { status: "completed", result: [] }),
    ]);
    await runJob(transport(impl), request);
    const body = calls[0]?.body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get("p_text_content")).toBe("hello");
    expect((body as FormData).get("p_public")).toBe("true");
  });

  test("retries a transient 5xx submit with the same idempotency key", async () => {
    const { impl, calls } = scripted([
      json(502, { message: "bad gateway" }),
      json(202, { jobId: "job-1" }),
      json(200, { status: "completed", result: [] }),
    ]);
    await runJob(transport(impl), request);
    expect(calls[0]?.headers.get("idempotency-key")).toBe("key-1");
    expect(calls[1]?.headers.get("idempotency-key")).toBe("key-1");
  });

  test("tolerates a transient 5xx and a network error while polling", async () => {
    const { impl } = scripted([
      json(202, { jobId: "job-1" }),
      json(500, { message: "sst dev is not running" }),
      new Error("socket hang up"),
      json(200, { status: "completed", result: [{ post_id: "p2" }] }),
    ]);
    const result = await runJob(transport(impl), request);
    expect(result).toEqual([{ post_id: "p2" }]);
  });

  test("does not retry a 4xx submit and reports the server message", async () => {
    const { impl, calls } = scripted([json(400, { message: "p_text_content is required" })]);
    await expect(runJob(transport(impl), request)).rejects.toThrow(/status 400.*p_text_content is required/);
    expect(calls).toHaveLength(1);
  });

  test("a failed job surfaces its status and message", async () => {
    const { impl } = scripted([
      json(202, { jobId: "job-1" }),
      json(200, { status: "failed", httpStatus: 403, error: { message: "forbidden" } }),
    ]);
    await expect(runJob(transport(impl), request)).rejects.toThrow(/job failed \(status 403\): forbidden/);
  });

  test("gives up after the deadline while the job stays pending", async () => {
    const pending = Array.from({ length: 50 }, () => json(200, { status: "pending" }));
    const { impl } = scripted([json(202, { jobId: "job-1" }), ...pending]);
    await expect(
      runJob(transport(impl, { timeoutMs: 3_000 }), request),
    ).rejects.toThrow(/did not finish before the deadline/);
  });

  test("rejects a 202 without a jobId", async () => {
    const { impl } = scripted([json(202, { status: "pending" })]);
    await expect(runJob(transport(impl), request)).rejects.toThrow(/no jobId/);
  });

  test("never includes the bearer token in an error", async () => {
    const { impl } = scripted([json(401, { message: "Unauthorized" })]);
    try {
      await runJob(transport(impl), request);
      throw new Error("expected rejection");
    } catch (err) {
      expect(err).toBeInstanceOf(GoApiJobError);
      expect((err as Error).message).not.toContain("tok-");
    }
  });
});

describe("firstResultField", () => {
  test("reads the id from the first row", () => {
    expect(firstResultField([{ post_id: "p1" }], "post_id")).toBe("p1");
  });

  test.each([[null], [[]], [[{}]], [[{ post_id: 5 }]], [[{ post_id: "" }]], ["x"]])(
    "rejects %p",
    (value: unknown) => {
      expect(() => firstResultField(value, "post_id")).toThrow();
    },
  );
});

describe("frontendOrigin", () => {
  test("reduces the expected origin to a bare origin", () => {
    expect(frontendOrigin("https://dev.sqldev.gregosilaja.cc/")).toBe(
      "https://dev.sqldev.gregosilaja.cc",
    );
    expect(frontendOrigin("https://app.example.com/some/path?x=1")).toBe(
      "https://app.example.com",
    );
  });

  test.each([[undefined], [""], ["   "], ["not a url"]])(
    "rejects %p",
    (value: string | undefined) => {
      expect(() => frontendOrigin(value)).toThrow();
    },
  );
});
