import { createClerkClient } from "@clerk/backend";
import {
  exchangeSignInTicket,
  fapiHostFromPublishableKey,
  isLiveClerkKey,
} from "./clerkFapi.js";
import { isRecord } from "./narrow.js";

type ClerkClient = ReturnType<typeof createClerkClient>;

const userIds = new Map<string, string>();
const actorSessions = new Map<string, { sessionId: string }>();

export function getClerkClient() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error("CLERK_SECRET_KEY is required");
  }
  return createClerkClient({ secretKey });
}

function jwtFromToken(token: unknown): string {
  if (typeof token === "string" && token.length > 0) {
    return token;
  }
  if (isRecord(token) && typeof token.jwt === "string" && token.jwt.length > 0) {
    return token.jwt;
  }
  throw new Error("Clerk supabase JWT was empty");
}

/**
 * Creates the session an actor's `supabase` JWT is minted from.
 *
 * Development instances allow the Backend API `createSession`. A production
 * (`sk_live_`) instance rejects it with `request_invalid_for_environment`, so
 * there the actor exchanges a one-time sign-in token through the Frontend API.
 * Either way the resulting session is cached and revoked in `after:run`.
 */
async function createActorSessionId(
  clerk: ClerkClient,
  userId: string,
): Promise<string> {
  const secretKey = process.env.CLERK_SECRET_KEY ?? "";
  if (!isLiveClerkKey(secretKey)) {
    const session = await clerk.sessions.createSession({ userId });
    return session.id;
  }

  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY;
  const origin = process.env.SQLDEV_E2E_EXPECTED_ORIGIN;
  if (!publishableKey || !origin) {
    throw new Error(
      "CLERK_PUBLISHABLE_KEY and SQLDEV_E2E_EXPECTED_ORIGIN are required for a live Clerk instance; run Cypress through `sqldev cypress`.",
    );
  }
  const ticket = await withClerkRetry(() =>
    clerk.signInTokens.createSignInToken({ userId, expiresInSeconds: 60 }),
  );
  const { sessionId } = await exchangeSignInTicket(
    fapiHostFromPublishableKey(publishableKey),
    origin,
    ticket.token,
  );
  return sessionId;
}

async function actorSessionId(
  clerk: ClerkClient,
  identifier: string,
): Promise<string> {
  const userId = await resolveClerkUserId(clerk, identifier);
  let actor = actorSessions.get(userId);
  if (!actor) {
    actor = { sessionId: await createActorSessionId(clerk, userId) };
    actorSessions.set(userId, actor);
  }
  return actor.sessionId;
}

export async function getActorSupabaseJwt(identifier: string): Promise<string> {
  const clerk = getClerkClient();
  const sessionId = await actorSessionId(clerk, identifier);
  const token = await clerk.sessions.getToken(sessionId, "supabase");
  return jwtFromToken(token);
}

/**
 * The actor's native Clerk session token (no JWT template). This is the token
 * the deployed frontend's same-origin `/api/*` proxy forwards to the Go API, so
 * it is what authenticates seeding calls on stages whose Supabase and API
 * Gateway are not reachable from a developer machine. Tokens are short-lived;
 * callers mint a fresh one per request.
 */
export async function getActorSessionToken(identifier: string): Promise<string> {
  const clerk = getClerkClient();
  const sessionId = await actorSessionId(clerk, identifier);
  const token = await clerk.sessions.getToken(sessionId);
  return jwtFromToken(token);
}

export async function revokeCachedClerkSessions(): Promise<null> {
  const sessions = [...actorSessions.values()];
  actorSessions.clear();
  if (sessions.length === 0) {
    return null;
  }

  const clerk = getClerkClient();
  let firstError: unknown;
  for (const actor of sessions) {
    try {
      await clerk.sessions.revokeSession(actor.sessionId);
    } catch (err) {
      firstError ??= err;
    }
  }
  if (firstError) {
    throw firstError;
  }
  return null;
}

function isRetryableClerkFetchError(err: unknown): boolean {
  if (!isRecord(err) || !Array.isArray(err.errors)) {
    return false;
  }
  const first: unknown = err.errors[0];
  return (
    isRecord(first) &&
    first.code === "unexpected_error" &&
    first.message === "fetch failed"
  );
}

export async function withClerkRetry<T>(fn: () => Promise<T>): Promise<T> {
  const maxAttempts = 4;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = isRetryableClerkFetchError(err);
      if (!retryable || attempt === maxAttempts) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw lastErr;
}

export async function resolveClerkUserId(
  clerk: ClerkClient,
  identifier: string,
): Promise<string> {
  const cached = userIds.get(identifier);
  if (cached) {
    return cached;
  }

  if (identifier.startsWith("user_")) {
    userIds.set(identifier, identifier);
    return identifier;
  }

  const byEmail = await withClerkRetry(() =>
    clerk.users.getUserList({ emailAddress: [identifier] }),
  );
  const emailMatch = byEmail.data[0];
  if (emailMatch) {
    userIds.set(identifier, emailMatch.id);
    return emailMatch.id;
  }

  const byUsername = await withClerkRetry(() =>
    clerk.users.getUserList({ username: [identifier] }),
  );
  const usernameMatch = byUsername.data[0];
  if (usernameMatch) {
    userIds.set(identifier, usernameMatch.id);
    return usernameMatch.id;
  }

  throw new Error(`No Clerk user found for ${identifier}`);
}
