import { NatEip } from "./vpc";
import { realtime } from "./realtime";
import { notifySecret } from "./secrets";

export const api = new sst.aws.ApiGatewayV1("GoApi", {
  cors: true,
});

function addRoute(route: string) {
  api.route(route, {
    handler: "packages/functions/cmd/goapi/main.go",
    runtime: "go",
    link: [realtime, notifySecret],
    environment: {
      APP_NAME: $app.name,
      APP_STAGE: $app.stage,
    },
  });
}

addRoute("ANY /");
addRoute("ANY /{proxy+}");

api.deploy();

if (!["dev"].includes($app.stage) && NatEip) {
  const policy = NatEip.publicIp.apply(function (ip) {
    console.log({ whitelistIp: ip });
    return JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: "*",
          Action: "execute-api:Invoke",
          Resource: "execute-api:/*",
        },
        {
          Effect: "Deny",
          Principal: "*",
          Action: "execute-api:Invoke",
          Resource: "execute-api:/*",
          Condition: {
            NotIpAddress: {
              "aws:SourceIp": [`${ip}/32`],
            },
          },
        },
      ],
    });
  });

  new aws.apigateway.RestApiPolicy("api-vpc-policy", {
    restApiId: api.nodes.api.id,
    policy,
  });
}
