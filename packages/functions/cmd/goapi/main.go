package main

import (
	"context"
	"encoding/base64"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/awslabs/aws-lambda-go-api-proxy/httpadapter"
	"github.com/gorilla/mux"
	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/api"
)

func main() {
	r := mux.NewRouter()
	server := &api.Server{}
	strictHandlerWrapper := api.NewStrictHandler(server, nil)
	adapter := httpadapter.New(api.HandlerFromMux(strictHandlerWrapper, r))

	lambda.Start(func(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
		resp, err := adapter.ProxyWithContext(ctx, req)
		if err != nil {
			return resp, err
		}
		return ensureBinaryEncoded(resp), nil
	})
}

// ensureBinaryEncoded forces base64 encoding when the handler returns a known
// binary Content-Type. httpadapter v0.16.2 only base64-encodes non-UTF-8
// bodies; API Gateway REST still needs isBase64Encoded for binaryMediaTypes.
func ensureBinaryEncoded(resp events.APIGatewayProxyResponse) events.APIGatewayProxyResponse {
	if resp.IsBase64Encoded || !isBinaryContentType(responseContentType(resp)) {
		return resp
	}
	resp.Body = base64.StdEncoding.EncodeToString([]byte(resp.Body))
	resp.IsBase64Encoded = true
	return resp
}

func responseContentType(resp events.APIGatewayProxyResponse) string {
	if resp.MultiValueHeaders != nil {
		if values := resp.MultiValueHeaders["Content-Type"]; len(values) > 0 {
			return values[0]
		}
		if values := resp.MultiValueHeaders["content-type"]; len(values) > 0 {
			return values[0]
		}
	}
	if resp.Headers != nil {
		if v := resp.Headers["Content-Type"]; v != "" {
			return v
		}
		if v := resp.Headers["content-type"]; v != "" {
			return v
		}
	}
	return ""
}

func isBinaryContentType(contentType string) bool {
	mediaType, _, _ := strings.Cut(contentType, ";")
	mediaType = strings.TrimSpace(strings.ToLower(mediaType))
	switch mediaType {
	case "application/octet-stream",
		"image/jpeg",
		"image/jpg",
		"image/png",
		"image/gif",
		"image/webp",
		"application/pdf",
		"application/zip":
		return true
	default:
		return strings.HasPrefix(mediaType, "image/") ||
			strings.HasPrefix(mediaType, "audio/") ||
			strings.HasPrefix(mediaType, "video/")
	}
}
