package main

import (
	"context"
	"errors"
	"fmt"
	"os"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-lambda-go/lambdacontext"
	"github.com/gregidonut/sqldev/packages/functions/cmd/realtimeAuthorizer/authorizerEvent"
	"github.com/gregidonut/sqldev/packages/functions/cmd/realtimeAuthorizer/policyBuilder"
	"github.com/gregidonut/sqldev/packages/functions/cmd/realtimeAuthorizer/utils"
)

func handler(ctx context.Context, event events.IoTCoreCustomAuthorizerRequest) (events.IoTCoreCustomAuthorizerResponse, error) {
	principalID := authorizerEvent.GetPrincipalID(event)

	publicKey, err := utils.GetResourceString("ClerkJWKSPublicKey", "value")
	if err != nil {
		return events.IoTCoreCustomAuthorizerResponse{}, fmt.Errorf("failed to retrieve public key: %w", err)
	}

	token, err := authorizerEvent.GetToken(event)
	if err != nil {
		return unauthorized(principalID), nil
	}

	if err := utils.VerifyClerkJWT(token, publicKey); err != nil {
		utils.LogJWTError(err)
		return unauthorized(principalID), nil
	}

	lc, ok := lambdacontext.FromContext(ctx)
	if !ok {
		return events.IoTCoreCustomAuthorizerResponse{}, errors.New("missing lambda context")
	}

	appName := os.Getenv("APP_NAME")
	appStage := os.Getenv("APP_STAGE")
	topicPattern := fmt.Sprintf("%s/%s/*", appName, appStage)

	policy, err := policyBuilder.BuildPolicyDocuments(lc.InvokedFunctionArn, topicPattern)
	if err != nil {
		return events.IoTCoreCustomAuthorizerResponse{}, err
	}

	return events.IoTCoreCustomAuthorizerResponse{
		IsAuthenticated:          true,
		PrincipalID:              principalID,
		DisconnectAfterInSeconds: utils.DisconnectAfterSeconds,
		RefreshAfterInSeconds:    utils.RefreshAfterSeconds,
		PolicyDocuments:          policy,
	}, nil
}

func unauthorized(principalID string) events.IoTCoreCustomAuthorizerResponse {
	return events.IoTCoreCustomAuthorizerResponse{
		IsAuthenticated: false,
		PrincipalID:     principalID,
	}
}

func main() {
	lambda.Start(handler)
}
