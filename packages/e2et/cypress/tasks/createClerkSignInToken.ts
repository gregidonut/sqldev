import {
  getClerkClient,
  resolveClerkUserId,
  withClerkRetry,
} from "./clerk.js";

export async function createClerkSignInToken(identifier: string): Promise<string> {
  const clerk = getClerkClient();
  const userId = await resolveClerkUserId(clerk, identifier);

  const signInToken = await withClerkRetry(() =>
    clerk.signInTokens.createSignInToken({
      userId,
      expiresInSeconds: 300,
    }),
  );

  return signInToken.token;
}
