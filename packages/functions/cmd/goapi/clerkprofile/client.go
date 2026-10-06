package clerkprofile

import (
	"context"
	"errors"
	"net/http"

	"github.com/clerk/clerk-sdk-go/v2"
	"github.com/clerk/clerk-sdk-go/v2/user"
)

var ErrNotFound = errors.New("clerk user not found")

type User struct {
	ID       string
	Username *string
	ImageURL *string
}

type Client struct {
	users *user.Client
}

func New(secret string) (*Client, error) {
	if secret == "" {
		return nil, errors.New("clerk secret is required")
	}
	return &Client{users: user.NewClient(&clerk.ClientConfig{
		BackendConfig: clerk.BackendConfig{Key: clerk.String(secret)},
	})}, nil
}

func (c *Client) Get(ctx context.Context, userID string) (User, error) {
	record, err := c.users.Get(ctx, userID)
	if err != nil {
		var apiErr *clerk.APIErrorResponse
		if errors.As(err, &apiErr) && apiErr.HTTPStatusCode == http.StatusNotFound {
			return User{}, ErrNotFound
		}
		return User{}, err
	}
	if record == nil || record.ID == "" {
		return User{}, ErrNotFound
	}
	return User{ID: record.ID, Username: record.Username, ImageURL: record.ImageURL}, nil
}
