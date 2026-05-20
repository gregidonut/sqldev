package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net/http"
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

func handler(ctx context.Context, req events.LambdaFunctionURLRequest) (events.LambdaFunctionURLResponse, error) {
	nSecret := req.Headers["X-Notify-Secret"]
	if nSecret == "" {
		return events.LambdaFunctionURLResponse{StatusCode: http.StatusUnauthorized}, nil
	}

	secretVal, err := resource.Get("NotifySecret", "value")
	if err != nil {
		return events.LambdaFunctionURLResponse{StatusCode: http.StatusInternalServerError}, err
	}
	secret, ok := secretVal.(string)
	if !ok || secret == "" {
		return events.LambdaFunctionURLResponse{StatusCode: http.StatusInternalServerError}, err
	}

	if subtle.ConstantTimeCompare([]byte(nSecret), []byte(secret)) != 1 {
		return events.LambdaFunctionURLResponse{StatusCode: http.StatusUnauthorized}, nil
	}

	var body RequestBody
	if err := json.Unmarshal([]byte(req.Body), &body); err != nil || body.View == "" {
		return events.LambdaFunctionURLResponse{StatusCode: http.StatusBadRequest}, nil
	}

	var iotClient *iotdataplane.Client
	err = (func() error {
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
		return events.LambdaFunctionURLResponse{StatusCode: http.StatusInternalServerError}, err
	}

	appName := os.Getenv("SST_APP")
	appStage := os.Getenv("SST_STAGE")
	topic := fmt.Sprintf("%s/%s/%s", appName, appStage, body.View)

	payload, err := json.Marshal(PublishPayload{Message: "new_post_content"})
	if err != nil {
		return events.LambdaFunctionURLResponse{StatusCode: http.StatusInternalServerError}, err
	}

	_, err = iotClient.Publish(ctx, &iotdataplane.PublishInput{
		Topic:   aws.String(topic),
		Payload: payload,
		Qos:     1,
	})
	if err != nil {
		return events.LambdaFunctionURLResponse{StatusCode: http.StatusInternalServerError}, err
	}

	return events.LambdaFunctionURLResponse{StatusCode: http.StatusOK}, nil
}

func main() {
	lambda.Start(handler)
}
