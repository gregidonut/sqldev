package main

import (
	"context"

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

	lambda.Start(func(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
		//defer sentry.Flush(2 * time.Second)
		return httpadapter.New(api.HandlerFromMux(strictHandlerWrapper, r)).ProxyWithContext(ctx, req)
	})
}
