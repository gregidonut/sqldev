import { Resource } from "sst";
import { realtime } from "sst/aws/realtime";
import jwt, { type JwtPayload } from "jsonwebtoken";

const publicKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAx/VvBD2LN+oqi5n8fQhx
J/JZqZtcQKh0FHOFAeA4rtfRroEQswxXm3OMbE6J3454EgbeELRu/hXtUWvDwqnT
U8W3YqpE7GbChgX82L0+iYITpkQqPqnO3xGb9sfn6/SUFcneZtwSViMr9G3x6LSC
PM/uOsQhW4cvWMgkQlbDABEtrk3D9I6k9KEq1X1uSmmrucFAiy97jalhl5Pwx13j
7zNLkNz/kV6N+T0AMU+wVPZ6nulcCI1hm8wDAuSG6DSK3wpS+JhW6XMiL3E068I6
N4KQV6LnALliH1NIw3NbJqpJVLH33l8rQZoXbcqIgusSY+6l6Jkx7MqGv8RNAR1z
wwIDAQAB
-----END PUBLIC KEY-----`;

export const handler = realtime.authorizer(async (token) => {
  try {
    const actualToken = token.startsWith("Bearer ")
      ? token.split(" ")[1]
      : token;

    const claims = jwt.verify(actualToken, publicKey) as JwtPayload;

    if (claims./*metadata?.*/ role !== "authenticated") {
      return {
        publish: [],
        subscribe: [],
      };
    }

    const prefix = `${Resource.App.name}/${Resource.App.stage}`;

    return {
      publish: [`${prefix}/*`],
      subscribe: [`${prefix}/*`],
    };
  } catch (error) {
    console.error("JWT Verification failed:", error);
    return {
      publish: [],
      subscribe: [],
    };
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
