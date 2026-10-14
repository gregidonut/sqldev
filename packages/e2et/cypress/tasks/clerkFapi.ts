// Pure helpers for creating an actor session on a Clerk *production* instance.
//
// Clerk's Backend API `sessions.createSession` is valid only for development
// instances (production returns `request_invalid_for_environment`). A
// production instance instead exchanges a one-time sign-in token through the
// Frontend API (`strategy=ticket`), which yields a real session whose
// `supabase` JWT the Backend API can then mint.

export class ClerkFapiError extends Error {
  constructor(category: string) {
    super(category);
    this.name = "ClerkFapiError";
  }
}

/** True for a production-instance secret key (`sk_live_...`). */
export function isLiveClerkKey(key: string): boolean {
  return key.startsWith("sk_live_") || key.startsWith("pk_live_");
}

/**
 * Decodes the Frontend API host embedded in a publishable key
 * (`pk_<env>_<base64("host$")>`). Never returns or logs the key itself.
 */
export function fapiHostFromPublishableKey(publishableKey: string): string {
  const parts = publishableKey.split("_");
  const encoded = parts.slice(2).join("_");
  if (parts.length < 3 || encoded.length === 0) {
    throw new ClerkFapiError("clerk publishable key is malformed");
  }
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const host = decoded.replace(/\$$/, "");
  if (!/^[a-z0-9.-]+$/i.test(host) || !host.includes(".")) {
    throw new ClerkFapiError("clerk publishable key has no valid frontend host");
  }
  return host;
}

export type TicketExchangeResult = Readonly<{ sessionId: string }>;

/**
 * Exchanges a sign-in token for a session via the Frontend API. The `origin`
 * header must be the application's origin so Clerk accepts the request.
 * Errors name a category only; the ticket and response body are never echoed.
 */
export async function exchangeSignInTicket(
  fapiHost: string,
  origin: string,
  ticket: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TicketExchangeResult> {
  const response = await fetchImpl(`https://${fapiHost}/v1/client/sign_ins`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin,
    },
    body: new URLSearchParams({ strategy: "ticket", ticket }),
  });

  if (!response.ok) {
    throw new ClerkFapiError(
      `clerk ticket exchange was rejected (status ${response.status})`,
    );
  }

  const body: unknown = await response.json();
  const inner =
    typeof body === "object" && body !== null && "response" in body
      ? (body as { response: unknown }).response
      : undefined;
  const status =
    typeof inner === "object" && inner !== null && "status" in inner
      ? (inner as { status: unknown }).status
      : undefined;
  const sessionId =
    typeof inner === "object" && inner !== null && "created_session_id" in inner
      ? (inner as { created_session_id: unknown }).created_session_id
      : undefined;

  if (status !== "complete" || typeof sessionId !== "string" || sessionId === "") {
    throw new ClerkFapiError("clerk ticket exchange did not complete a session");
  }
  return Object.freeze({ sessionId });
}
