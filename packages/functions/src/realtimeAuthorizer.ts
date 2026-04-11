import { Resource } from "sst";
import { realtime } from "sst/aws/realtime";
import jwt, { type JwtPayload } from "jsonwebtoken";

export const handler = realtime.authorizer(async (token) => {
  const publicKey = Resource.ClerkJWKSPublicKey.value;
  try {
    const actualToken = token.startsWith("Bearer ")
      ? token.split(" ")[1]
      : token;

    const claims = jwt.verify(actualToken, publicKey, {
      clockTolerance: 30, // 30 seconds
    }) as JwtPayload;

    if (claims.role !== "authenticated") {
      throw new Error("Unauthorized: Invalid role");
    }

    const prefix = `${Resource.App.name}/${Resource.App.stage}`;

    return {
      publish: [`${prefix}/*`],
      subscribe: [`${prefix}/*`],
      disconnectAfterInSeconds: 3600,
    };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      console.error("JWT Verification failed: TokenExpiredError: jwt expired", {
        expiredAt: error.expiredAt,
      });
    } else {
      console.error("JWT Verification failed:", error);
    }
    throw error;
  }
});

/*
function generatePolicy(metadata, principalId, effect, resource) {
    const authResponse = {
        principalId: principalId,
        policyDocument: {
            Version: "2012-10-17",
            Statement: [
                {
                    Action: "execute-api:Invoke",
                    Effect: effect,
                    Resource: resource,
                },
            ],
        },
    };
    if (metadata) {
        authResponse.context = metadata;
    }
    return authResponse;
}
*/
