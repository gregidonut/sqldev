import { createClerkClient } from "@clerk/backend";

export function getClerkClient() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error("CLERK_SECRET_KEY is required");
  }
  return createClerkClient({ secretKey });
}

function isRetryableClerkFetchError(err: unknown): boolean {
  const first = (
    err as { errors?: Array<{ code?: string; message?: string }> }
  )?.errors?.[0];
  return first?.code === "unexpected_error" && first?.message === "fetch failed";
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
  clerk: ReturnType<typeof createClerkClient>,
  identifier: string,
): Promise<string> {
  if (identifier.startsWith("user_")) {
    return identifier;
  }

  const byEmail = await withClerkRetry(() =>
    clerk.users.getUserList({ emailAddress: [identifier] }),
  );
  const emailMatch = byEmail.data[0];
  if (emailMatch) {
    return emailMatch.id;
  }

  const byUsername = await withClerkRetry(() =>
    clerk.users.getUserList({ username: [identifier] }),
  );
  const usernameMatch = byUsername.data[0];
  if (usernameMatch) {
    return usernameMatch.id;
  }

  throw new Error(`No Clerk user found for ${identifier}`);
}
