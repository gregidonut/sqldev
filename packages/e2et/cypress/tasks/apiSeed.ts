// Seeding through the deployed frontend's same-origin `/api/*` proxy, for stages
// whose Supabase and Go API are not reachable from the machine running Cypress.
//
// Staging's Supabase is a private VPC address, and the Go API Gateway has a
// resource policy that denies every caller except the app's NAT egress IP, so a
// developer machine can reach neither. The deployed frontend is the sanctioned
// entry point: it authenticates with Clerk, forwards the session token, and
// egresses from the allowed IP - exactly what the browser specs already use.
// Local stages keep the direct-RPC helpers.
//
// The API runs the same RPCs as the worker with the caller's identity, so row
// ownership and RLS match the direct path. Creating an Instagram post also sends
// the MQTT notify server-side, so no separate notify call is made here.

import { getActorSessionToken } from "./clerk.js";
import { runJob, type JobTransport } from "./goApiJobs.js";
import { isRecord } from "./narrow.js";
import { currentStage, isLocalStage } from "./stage.js";

/** True when seeding must go through the public Go API instead of Supabase. */
export function seedsThroughGoApi(): boolean {
  return !isLocalStage(currentStage());
}

/** The stage-selected frontend origin injected by the sqldev CLI. */
export function frontendOrigin(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === "") {
    throw new Error(
      "SQLDEV_E2E_EXPECTED_ORIGIN is not set. Run Cypress through `sqldev cypress ...` so the CLI injects it.",
    );
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("SQLDEV_E2E_EXPECTED_ORIGIN is not a valid URL");
  }
  return url.origin;
}

function transportFor(identifier: string): JobTransport {
  return {
    baseUrl: frontendOrigin(process.env.SQLDEV_E2E_EXPECTED_ORIGIN),
    getToken: () => getActorSessionToken(identifier),
  };
}

/** Reads `field` from the first row of a job result (`[{ field: "..." }]`). */
export function firstResultField(result: unknown, field: string): string {
  if (!Array.isArray(result)) {
    throw new Error(`job result had no rows for ${field}`);
  }
  const row: unknown = result[0];
  const value = isRecord(row) ? row[field] : undefined;
  if (typeof value !== "string" || value === "") {
    throw new Error(`job result had no ${field}`);
  }
  return value;
}

export async function createIgPostViaApi(
  identifier: string,
  textContent: string,
  isPublic: boolean,
): Promise<string> {
  const result = await runJob(transportFor(identifier), {
    method: "POST",
    path: "/api/views/igPosts/new/item",
    fields: { p_text_content: textContent, p_public: String(isPublic) },
  });
  return firstResultField(result, "post_id");
}

export async function createTodoSpaceViaApi(
  identifier: string,
  name: string,
  isPublic: boolean,
): Promise<string> {
  const result = await runJob(transportFor(identifier), {
    method: "POST",
    path: "/api/views/tdsTodoSpaces/new/item",
    fields: { p_name: name, p_public: String(isPublic) },
  });
  return firstResultField(result, "todo_space_id");
}

export async function createTodoViaApi(
  identifier: string,
  todoSpaceId: string,
  title: string,
  description: string,
): Promise<string> {
  const result = await runJob(transportFor(identifier), {
    method: "POST",
    path: `/api/views/tdsTodos/${todoSpaceId}/new/post`,
    fields: {
      p_todo_space_id: todoSpaceId,
      p_title: title,
      p_description: description,
    },
  });
  return firstResultField(result, "todo_id");
}
