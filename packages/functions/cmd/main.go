package main

import (
	"net/http"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/awslabs/aws-lambda-go-api-proxy/httpadapter"
	"github.com/gregidonut/sqldev/packages/functions/cmd/handlers"
)

func router() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /notify", handlers.IgPostsViewNotifierPost)

	return mux
}

func main() {

	lambda.Start(httpadapter.New(router()).ProxyWithContext)

}
