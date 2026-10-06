package supadb

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRPCSendsClerkJWTAndAPIKey(t *testing.T) {
	var gotAuth, gotKey, gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotKey = r.Header.Get("apikey")
		gotPath = r.URL.Path
		_, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`"11111111-1111-1111-1111-111111111111"`))
	}))
	defer server.Close()

	client, err := New(server.URL, "anon-key")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := client.RPC(context.Background(), "clerk-jwt", "set_owner", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) == "" {
		t.Fatal("empty rpc body")
	}
	if gotAuth != "Bearer clerk-jwt" {
		t.Fatalf("authorization = %q", gotAuth)
	}
	if gotKey != "anon-key" {
		t.Fatalf("apikey = %q", gotKey)
	}
	if gotPath != "/rest/v1/rpc/set_owner" {
		t.Fatalf("path = %q", gotPath)
	}
}

func TestListSendsClerkJWT(t *testing.T) {
	var gotAuth, gotKey, gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotKey = r.Header.Get("apikey")
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[]`))
	}))
	defer server.Close()

	client, err := New(server.URL, "anon-key")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.List(context.Background(), "clerk-jwt", "ig_posts_view"); err != nil {
		t.Fatal(err)
	}
	if gotAuth != "Bearer clerk-jwt" {
		t.Fatalf("authorization = %q", gotAuth)
	}
	if gotKey != "anon-key" {
		t.Fatalf("apikey = %q", gotKey)
	}
	if gotPath != "/rest/v1/ig_posts_view" {
		t.Fatalf("path = %q", gotPath)
	}
}

func TestRPCUnauthorized(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"code":"PGRST301","message":"JWT expired"}`))
	}))
	defer server.Close()

	client, err := New(server.URL, "anon-key")
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.RPC(context.Background(), "expired", "set_owner", nil)
	var dbErr *Error
	if !asError(err, &dbErr) || dbErr.Status != http.StatusUnauthorized {
		t.Fatalf("err = %#v", err)
	}
}

func asError(err error, target **Error) bool {
	if err == nil {
		return false
	}
	dbErr, ok := err.(*Error)
	if !ok {
		return false
	}
	*target = dbErr
	return true
}
