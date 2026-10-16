package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"sort"

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
	router.Use(strictJSONBody)
	return HandlerFromMux(NewStrictHandler(server, nil), router)
}

// maxStrictBody bounds the body of the strictly validated routes.
const maxStrictBody = 4 << 10

type strictBodySpec struct {
	// required lists the exact top-level keys; nested lists the exact keys of an object field.
	required []string
	nested   map[string][]string
	decode   func(body []byte) error
}

var (
	visibilityPath = regexp.MustCompile(`^/api/storage/buckets/[^/]+/objects/visibility$`)
	confirmPath    = regexp.MustCompile(`^/api/confirmations$`)

	visibilitySpec = strictBodySpec{
		required: []string{"target", "expectedRevision", "visibility"},
		nested:   map[string][]string{"target": {"type", "id"}},
		decode:   func(body []byte) error { var v StorageVisibilityChange; return decodeStrict(body, &v) },
	}
	confirmSpec = strictBodySpec{
		required: []string{"operationKind", "target", "expectedRevision", "challengeId", "proof"},
		nested:   map[string][]string{"target": {"type", "id"}},
		decode:   func(body []byte) error { var v OperationConfirmation; return decodeStrict(body, &v) },
	}
)

func strictBodySpecFor(r *http.Request) (strictBodySpec, bool) {
	if r.Method != http.MethodPost {
		return strictBodySpec{}, false
	}
	switch {
	case visibilityPath.MatchString(r.URL.Path):
		return visibilitySpec, true
	case confirmPath.MatchString(r.URL.Path):
		return confirmSpec, true
	default:
		return strictBodySpec{}, false
	}
}

// strictJSONBody guards the two confirmable routes. The generated handler decodes
// JSON leniently: it ignores unknown fields and leaves missing ones at their zero
// value, which could change which operation, target or revision a request means.
// Such a body is answered with 400 before any handler or job runs.
func strictJSONBody(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		spec, ok := strictBodySpecFor(r)
		if !ok {
			next.ServeHTTP(w, r)
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxStrictBody))
		if err != nil || !spec.valid(body) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"message":"invalid request"}`))
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
		r.ContentLength = int64(len(body))
		next.ServeHTTP(w, r)
	})
}

func (spec strictBodySpec) valid(body []byte) bool {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil || !sameKeys(fields, spec.required) {
		return false
	}
	for name, keys := range spec.nested {
		var inner map[string]json.RawMessage
		if err := json.Unmarshal(fields[name], &inner); err != nil || !sameKeys(inner, keys) {
			return false
		}
	}
	return spec.decode(body) == nil
}

func sameKeys(fields map[string]json.RawMessage, want []string) bool {
	if len(fields) != len(want) {
		return false
	}
	have := make([]string, 0, len(fields))
	for key := range fields {
		have = append(have, key)
	}
	sort.Strings(have)
	sorted := append([]string(nil), want...)
	sort.Strings(sorted)
	for i := range have {
		if have[i] != sorted[i] {
			return false
		}
	}
	return true
}
