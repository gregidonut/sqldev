import { createClerkClient } from "@clerk/backend";
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

export async function getActorSupabaseJwt(identifier: string): Promise<string> {
  const clerk = getClerkClient();
  const userId = await resolveClerkUserId(clerk, identifier);
  let actor = actorSessions.get(userId);
  if (!actor) {
    const session = await clerk.sessions.createSession({ userId });
    actor = { sessionId: session.id };
    actorSessions.set(userId, actor);
  }
  const token = await clerk.sessions.getToken(actor.sessionId, "supabase");
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
