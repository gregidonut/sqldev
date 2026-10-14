// Minimal client for the deployed Go API's async job protocol, used by Cypress
// Node tasks to seed data on stages whose Supabase is private (for example the
// staging VPC address), where the direct-RPC path cannot be reached from a
// developer machine.
//
// Protocol (packages/functions/cmd/goapi/api.yaml):
//   POST  {base}{path}  multipart + `Idempotency-Key`  -> 202 { jobId }
//   GET   {base}/api/jobs/{jobId}                       -> { status, result?, error? }
// Terminal statuses are `completed` and `failed`. The bearer token expires
// quickly, so a fresh one is requested for every HTTP call.
//
// Errors never include the bearer token. Server job messages are included
// because they are the only diagnostic for a failed seed operation.

import { isRecord } from "./narrow.js";

export class GoApiJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoApiJobError";
  }
}

export type JobTransport = Readonly<{
  /** Linked GoApi.url without a trailing slash. */
  baseUrl: string;
  /** Returns a fresh bearer JWT for the acting user on every call. */
  getToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  newKey?: () => string;
  /** Total budget for submit + polling. */
  timeoutMs?: number;
}>;

export type JobRequest = Readonly<{
  method: "POST";
  path: string;
  fields: Readonly<Record<string, string>>;
}>;

const POLL_DELAYS_MS = [200, 400, 800, 1200, 1600] as const;
const POLL_STEADY_MS = 2000;
const SUBMIT_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 90_000;

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function pollDelay(attempt: number): number {
  return POLL_DELAYS_MS[attempt] ?? POLL_STEADY_MS;
}

function isTransientStatus(status: number): boolean {
  return status >= 500 && status <= 599;
}

/**
 * Submits a mutating request and waits for the job to finish. Resolves with the
 * job's `result` (the RPC rows), or rejects with a GoApiJobError.
 */
export async function runJob(
  transport: JobTransport,
  request: JobRequest,
): Promise<unknown> {
  const fetchImpl = transport.fetchImpl ?? fetch;
  const sleep = transport.sleep ?? defaultSleep;
  const now = transport.now ?? Date.now;
  const newKey = transport.newKey ?? (() => crypto.randomUUID());
  const deadline = now() + (transport.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const jobId = await submit(transport, request, fetchImpl, sleep, newKey());
  return poll(transport, jobId, fetchImpl, sleep, now, deadline);
}

async function submit(
  transport: JobTransport,
  request: JobRequest,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void>,
  idempotencyKey: string,
): Promise<string> {
  const form = new FormData();
  for (const [name, value] of Object.entries(request.fields)) {
    form.append(name, value);
  }

  let lastFailure = "request did not complete";
  // The same Idempotency-Key makes a retried submit safe: the Go API derives a
  // stable job id from (user, kind, key) and never creates a second row.
  for (let attempt = 0; attempt < SUBMIT_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(`${transport.baseUrl}${request.path}`, {
        method: request.method,
        headers: {
          Authorization: `Bearer ${await transport.getToken()}`,
          "Idempotency-Key": idempotencyKey,
        },
        body: form,
      });
    } catch {
      lastFailure = "network error";
      await sleep(250 * (attempt + 1));
      continue;
    }

    if (isTransientStatus(response.status)) {
      lastFailure = `status ${response.status}`;
      await sleep(250 * (attempt + 1));
      continue;
    }
    if (response.status !== 202) {
      throw new GoApiJobError(
        `submit ${request.path} was rejected (status ${response.status}${await messageSuffix(response)})`,
      );
    }

    const body: unknown = await response.json().catch(() => undefined);
    if (!isRecord(body) || typeof body.jobId !== "string" || body.jobId === "") {
      throw new GoApiJobError(`submit ${request.path} returned no jobId`);
    }
    return body.jobId;
  }
  throw new GoApiJobError(`submit ${request.path} failed: ${lastFailure}`);
}

async function poll(
  transport: JobTransport,
  jobId: string,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void>,
  now: () => number,
  deadline: number,
): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    let response: Response | undefined;
    try {
      response = await fetchImpl(`${transport.baseUrl}/api/jobs/${jobId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${await transport.getToken()}` },
      });
    } catch {
      response = undefined; // transient; retried until the deadline
    }

    if (response !== undefined && !isTransientStatus(response.status)) {
      if (response.status !== 200) {
        throw new GoApiJobError(
          `job poll was rejected (status ${response.status}${await messageSuffix(response)})`,
        );
      }
      const body: unknown = await response.json().catch(() => undefined);
      if (!isRecord(body) || typeof body.status !== "string") {
        throw new GoApiJobError("job poll returned an unexpected body");
      }
      if (body.status === "completed") {
        return body.result;
      }
      if (body.status === "failed") {
        throw new GoApiJobError(`job failed${failureDetail(body)}`);
      }
      // pending | running -> keep polling
    }

    if (now() >= deadline) {
      throw new GoApiJobError("job did not finish before the deadline");
    }
    await sleep(pollDelay(attempt));
  }
}

function failureDetail(body: Record<string, unknown>): string {
  const status =
    typeof body.httpStatus === "number" ? ` (status ${body.httpStatus})` : "";
  const error = body.error;
  const message =
    isRecord(error) && typeof error.message === "string" && error.message !== ""
      ? `: ${error.message}`
      : "";
  return `${status}${message}`;
}

async function messageSuffix(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => undefined);
  if (isRecord(body) && typeof body.message === "string" && body.message !== "") {
    return `: ${body.message}`;
  }
  return "";
}
