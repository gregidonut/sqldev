package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/iotdataplane"
	"github.com/sst/sst/v3/sdk/golang/resource"
)

type RequestBody struct {
	View string `json:"view"`
}

type PublishPayload struct {
	Message string `json:"message"`
}

func handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	var iotClient *iotdataplane.Client
	var body RequestBody

	err := (func() error {
		endpoint, err := resource.Get("SQLDevRealtimeSST", "endpoint")
		if err != nil {
			return fmt.Errorf("failed to get IoT endpoint from SST resource: %w", err)
		}

		cfg, err := config.LoadDefaultConfig(context.Background())
		if err != nil {
			return fmt.Errorf("failed to load AWS config: %w", err)
		}

		iotClient = iotdataplane.NewFromConfig(cfg, func(o *iotdataplane.Options) {
			o.BaseEndpoint = aws.String("https://" + endpoint.(string))
		})
		return nil
	})()
	if err != nil {
		return events.APIGatewayProxyResponse{StatusCode: 500, Body: fmt.Sprintf("error from init: ", err)}, nil
	}

	if err = json.Unmarshal([]byte(request.Body), &body); err != nil {
		return events.APIGatewayProxyResponse{StatusCode: 400, Body: "invalid request body"}, nil
	}

	appName := os.Getenv("SST_APP")
	appStage := os.Getenv("SST_STAGE")
	topic := fmt.Sprintf("%s/%s/%s", appName, appStage, body.View)

	payload, err := json.Marshal(PublishPayload{Message: "new_post_content"})
	if err != nil {
		return events.APIGatewayProxyResponse{StatusCode: 500, Body: "failed to marshal payload"}, nil
	}

	_, err = iotClient.Publish(ctx, &iotdataplane.PublishInput{
		Topic:   aws.String(topic),
		Payload: payload,
		Qos:     1,
	})
	if err != nil {
		return events.APIGatewayProxyResponse{StatusCode: 500, Body: fmt.Sprintf("failed to publish: %v", err)}, nil
	}

	return events.APIGatewayProxyResponse{StatusCode: 200, Body: "ok"}, nil
}

func main() {
	lambda.Start(handler)
}
