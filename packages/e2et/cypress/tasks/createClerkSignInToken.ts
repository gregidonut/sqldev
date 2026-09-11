import { createClerkClient } from "@clerk/backend";

export async function createClerkSignInToken(identifier: string): Promise<string> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error("CLERK_SECRET_KEY is required to create a Clerk sign-in ticket");
  }

  const clerk = createClerkClient({ secretKey });
  const userId = identifier.startsWith("user_")
    ? identifier
    : await findUserId(clerk, identifier);

  const signInToken = await clerk.signInTokens.createSignInToken({
    userId,
    expiresInSeconds: 300,
  });

  return signInToken.token;
}

async function findUserId(
  clerk: ReturnType<typeof createClerkClient>,
  identifier: string,
): Promise<string> {
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
