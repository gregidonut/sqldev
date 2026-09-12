import { getClerkClient, resolveClerkUserId } from "./clerk.js";

export async function createClerkSignInToken(identifier: string): Promise<string> {
  const clerk = getClerkClient();
  const userId = await resolveClerkUserId(clerk, identifier);

  const signInToken = await clerk.signInTokens.createSignInToken({
    userId,
    expiresInSeconds: 300,
  });

  return signInToken.token;
}
