package api

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"os"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/iotdataplane"
	"github.com/sst/sst/v3/sdk/golang/resource"
)

func (s Server) Notify(ctx context.Context, request NotifyRequestObject) (NotifyResponseObject, error) {
	nSecret := request.Params.XNotifySecret
	if nSecret == "" {
		return Notify401Response{}, nil
	}

	secretVal, err := resource.Get("NotifySecret", "value")
	if err != nil {
		return Notify500Response{}, nil
	}

	secret, ok := secretVal.(string)
	if !ok || secret == "" {
		return Notify400Response{}, nil
	}

	if subtle.ConstantTimeCompare([]byte(nSecret), []byte(secret)) != 1 {
		return Notify401Response{}, nil
	}

	if request.Body.View == "" {
		return Notify400Response{}, nil
	}
	if request.Body.Message == "" {
		return Notify400Response{}, nil
	}

	endpoint, err := resource.Get("SQLDevRealtimeSST", "endpoint")
	if err != nil {
		return Notify500Response{}, nil
	}

	cfg, err := config.LoadDefaultConfig(ctx,
		config.WithRegion("ap-east-1"),
	)
	if err != nil {
		return Notify500Response{}, nil
	}

	iotClient := iotdataplane.NewFromConfig(cfg, func(o *iotdataplane.Options) {
		o.BaseEndpoint = aws.String("https://" + endpoint.(string))
	})

	appName := os.Getenv("APP_NAME")
	appStage := os.Getenv("APP_STAGE")
	topic := fmt.Sprintf("%s/%s/%s", appName, appStage, request.Body.View)

	payload, err := json.Marshal(struct {
		Message string `json:"message"`
	}{
		Message: request.Body.Message,
	})
	if err != nil {
		return Notify500Response{}, nil
	}

	_, err = iotClient.Publish(ctx, &iotdataplane.PublishInput{
		Topic:   aws.String(topic),
		Payload: payload,
		Qos:     1,
	})
	if err != nil {
		return Notify500Response{}, nil
	}

	return Notify200Response{}, nil
}
