// Package supadb calls the Supabase Data API with the caller's Clerk JWT.
// Reads go through the Supabase Go SDK. RPC uses the same apikey and bearer
// headers directly because the SDK's Rpc method discards HTTP status codes.
package supadb

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/supabase-community/supabase-go"
)

var executeCode = regexp.MustCompile(`^\(([^)]+)\) (.*)$`)

// Error is a PostgREST failure with the HTTP status preserved.
type Error struct {
	Status  int
	Code    string
	Message string
}

func (e *Error) Error() string {
	if e.Message == "" {
		return "database request failed"
	}
	return e.Message
}

// Client is safe for concurrent use. Each call builds its own SDK client so
// one caller's JWT cannot leak into another request.
type Client struct {
	baseURL string
	key     string
	http    *http.Client
}

func New(baseURL, key string) (*Client, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	key = strings.TrimSpace(key)
	if _, err := supabase.NewClient(baseURL, key, nil); err != nil {
		return nil, fmt.Errorf("create supabase client: %w", err)
	}
	return &Client{baseURL: baseURL, key: key, http: http.DefaultClient}, nil
}

func (c *Client) RPC(ctx context.Context, jwt, name string, args any) (json.RawMessage, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !validIdentifier(name) {
		return nil, fmt.Errorf("invalid rpc name")
	}
	if args == nil {
		args = map[string]any{}
	}
	payload, err := json.Marshal(args)
	if err != nil {
		return nil, fmt.Errorf("encode rpc %s: %w", name, err)
	}

	endpoint, err := url.JoinPath(c.baseURL, "rest", "v1", "rpc", name)
	if err != nil {
		return nil, fmt.Errorf("build rpc url: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("create rpc request: %w", err)
	}
	request.Header.Set("apikey", c.key)
	request.Header.Set("Authorization", "Bearer "+jwt)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")

	response, err := c.http.Do(request)
	if err != nil {
		return nil, fmt.Errorf("call rpc %s: %w", name, err)
	}
	defer response.Body.Close()

	body, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return nil, fmt.Errorf("read rpc %s: %w", name, err)
	}
	if response.StatusCode >= 400 {
		return nil, errorFromBody(response.StatusCode, body)
	}
	if len(bytes.TrimSpace(body)) == 0 {
		return json.RawMessage("null"), nil
	}
	return json.RawMessage(body), nil
}

func (c *Client) List(ctx context.Context, jwt, relation string) (json.RawMessage, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	client, err := c.userClient(jwt)
	if err != nil {
		return nil, err
	}
	body, _, err := client.From(relation).Select("*", "", false).Execute()
	if err != nil {
		return nil, fromExecuteError(err)
	}
	return json.RawMessage(body), nil
}

func (c *Client) One(ctx context.Context, jwt, relation, column, value string) (json.RawMessage, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !validIdentifier(column) {
		return nil, fmt.Errorf("invalid column")
	}
	client, err := c.userClient(jwt)
	if err != nil {
		return nil, err
	}
	body, _, err := client.From(relation).Select("*", "", false).Eq(column, value).Single().Execute()
	if err != nil {
		return nil, fromExecuteError(err)
	}
	return json.RawMessage(body), nil
}

func (c *Client) userClient(jwt string) (*supabase.Client, error) {
	client, err := supabase.NewClient(c.baseURL, c.key, &supabase.ClientOptions{
		Headers: map[string]string{
			"Authorization": "Bearer " + jwt,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("create user supabase client: %w", err)
	}
	return client, nil
}

func errorFromBody(status int, body []byte) error {
	var payload struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &payload); err != nil || payload.Message == "" {
		return &Error{Status: status, Message: "database request failed"}
	}
	return &Error{Status: status, Code: payload.Code, Message: payload.Message}
}

func fromExecuteError(err error) error {
	matches := executeCode.FindStringSubmatch(err.Error())
	if matches == nil {
		return fmt.Errorf("query database: %w", err)
	}
	code, message := matches[1], matches[2]
	status := 500
	switch {
	case code == "PGRST301" || code == "PGRST302" || strings.Contains(strings.ToLower(message), "jwt"):
		status = http.StatusUnauthorized
	case code == "PGRST116":
		status = http.StatusNotFound
	case code == "42501" || strings.Contains(strings.ToLower(message), "forbidden"):
		status = http.StatusForbidden
	case strings.HasPrefix(code, "PGRST") || strings.HasPrefix(code, "22") || strings.HasPrefix(code, "23"):
		status = http.StatusBadRequest
	}
	return &Error{Status: status, Code: code, Message: message}
}

func validIdentifier(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '_' {
			return false
		}
	}
	return true
}
