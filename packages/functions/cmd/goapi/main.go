package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/awslabs/aws-lambda-go-api-proxy/httpadapter"
	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/api"
	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/clerkprofile"
	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/s3store"
	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/supadb"
	"github.com/sst/sst/v3/sdk/golang/resource"
)

func main() {
	supabaseURL, err := linkedString("SupabaseUrl", "value")
	if err != nil {
		log.Fatal(err)
	}
	supabaseKey, err := linkedString("SupabaseKey", "value")
	if err != nil {
		log.Fatal(err)
	}
	clerkSecret, err := linkedString("ClerkSecretKey", "value")
	if err != nil {
		log.Fatal(err)
	}
	bucket, err := linkedString("SQLDevBucket", "name")
	if err != nil {
		log.Fatal(err)
	}

	database, err := supadb.New(supabaseURL, supabaseKey)
	if err != nil {
		log.Fatal(err)
	}
	objects, err := s3store.New(context.Background())
	if err != nil {
		log.Fatal(err)
	}
	profiles, err := clerkprofile.New(clerkSecret)
	if err != nil {
		log.Fatal(err)
	}

	server := &api.Server{
		DB:       database,
		Objects:  objects,
		Profiles: profiles,
		Bucket:   bucket,
	}
	adapter := httpadapter.New(api.NewHandler(server))
	lambda.Start(func(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
		resp, err := adapter.ProxyWithContext(ctx, req)
		if err != nil {
			return resp, err
		}
		return ensureBinaryEncoded(resp), nil
	})
}

func linkedString(name, property string) (string, error) {
	value, err := resource.Get(name, property)
	if err != nil {
		return "", fmt.Errorf("load %s: %w", name, err)
	}
	text, ok := value.(string)
	if !ok || strings.TrimSpace(text) == "" {
		return "", fmt.Errorf("load %s: empty", name)
	}
	return text, nil
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
