package handlers

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net/http"
	"os"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/iotdataplane"
	"github.com/sst/sst/v3/sdk/golang/resource"
)

type igPostsViewNotifierRequestBody struct {
	View string `json:"view"`
}

type igPostsViewNotifierPublishPayload struct {
	Message string `json:"message"`
}

func IgPostsViewNotifierPost(w http.ResponseWriter, r *http.Request) {
	nSecret := r.Header.Get("x-notify-secret")
	if nSecret == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	secretVal, err := resource.Get("NotifySecret", "value")
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	secret, ok := secretVal.(string)
	if !ok || secret == "" {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	if subtle.ConstantTimeCompare([]byte(nSecret), []byte(secret)) != 1 {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	var body igPostsViewNotifierRequestBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.View == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	endpoint, err := resource.Get("SQLDevRealtimeSST", "endpoint")
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	cfg, err := config.LoadDefaultConfig(context.Background(),
		config.WithRegion("ap-east-1"),
	)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	iotClient := iotdataplane.NewFromConfig(cfg, func(o *iotdataplane.Options) {
		o.BaseEndpoint = aws.String("https://" + endpoint.(string))
	})

	appName := os.Getenv("APP_NAME")
	appStage := os.Getenv("APP_STAGE")
	topic := fmt.Sprintf("%s/%s/%s", appName, appStage, body.View)

	payload, err := json.Marshal(igPostsViewNotifierPublishPayload{Message: "new_post_content"})
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	_, err = iotClient.Publish(r.Context(), &iotdataplane.PublishInput{
		Topic:   aws.String(topic),
		Payload: payload,
		Qos:     1,
	})
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}
