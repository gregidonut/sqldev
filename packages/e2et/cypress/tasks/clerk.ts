import { createClerkClient } from "@clerk/backend";

export function getClerkClient() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error("CLERK_SECRET_KEY is required");
  }
  return createClerkClient({ secretKey });
}

export async function resolveClerkUserId(
  clerk: ReturnType<typeof createClerkClient>,
  identifier: string,
): Promise<string> {
  if (identifier.startsWith("user_")) {
    return identifier;
  }

  const byEmail = await clerk.users.getUserList({ emailAddress: [identifier] });
  const emailMatch = byEmail.data[0];
  if (emailMatch) {
    return emailMatch.id;
  }

  const byUsername = await clerk.users.getUserList({ username: [identifier] });
  const usernameMatch = byUsername.data[0];
  if (usernameMatch) {
    return usernameMatch.id;
  }

  throw new Error(`No Clerk user found for ${identifier}`);
}
