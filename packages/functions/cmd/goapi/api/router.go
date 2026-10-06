package api

import (
	"context"
	"net/http"

	"github.com/gorilla/mux"
)

func NewHandler(server StrictServerInterface) http.Handler {
	router := mux.NewRouter()
	router.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := bearerToken(r.Header.Get("Authorization"))
			ctx := context.WithValue(r.Context(), tokenContextKey{}, token)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	return HandlerFromMux(NewStrictHandler(server, nil), router)
}
