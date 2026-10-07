package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/clerkprofile"
	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/s3store"
	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/supadb"
	"github.com/gregidonut/sqldev/packages/functions/internal/queue"
	"github.com/gregidonut/sqldev/packages/functions/internal/result"
	"github.com/gregidonut/sqldev/packages/functions/internal/status"
)

var (
	errUnauthorized = errors.New("unauthorized")
	errForbidden    = errors.New("forbidden")
	errBadRequest   = errors.New("bad request")
	errConflict     = errors.New("conflict")
	errNotFound     = errors.New("not found")
)

// Database calls Supabase with the caller's Clerk JWT so RLS and auth.jwt() apply.
type Database interface {
	RPC(ctx context.Context, jwt, name string, args any) (json.RawMessage, error)
	List(ctx context.Context, jwt, relation string) (json.RawMessage, error)
	One(ctx context.Context, jwt, relation, column, value string) (json.RawMessage, error)
}

// Objects is the linked S3 bucket.
type Objects interface {
	BucketExists(ctx context.Context, bucket string) (bool, error)
	Upload(ctx context.Context, bucket, key string, body io.Reader, size int64) error
	Open(ctx context.Context, bucket, key string) (s3store.Opened, error)
	Delete(ctx context.Context, bucket, key, versionID string, bypass bool) error
	DeleteMany(ctx context.Context, bucket string, keys []string, bypass bool) error
	Copy(ctx context.Context, sourceBucket, destinationBucket, sourceKey, destinationKey string) error
	Exists(ctx context.Context, bucket, key string) (bool, error)
	PresignPut(ctx context.Context, bucket, key string) (string, error)
	PresignGet(ctx context.Context, bucket, key string) (string, error)
}

// Profiles loads Clerk users after the caller is authenticated.
type Profiles interface {
	Get(ctx context.Context, userID string) (clerkprofile.User, error)
}

// Server implements the generated strict API.
type Server struct {
	DB       Database
	Objects  Objects
	Profiles Profiles
	Bucket   string
	Identity Identity
	Jobs     status.Store
	Sender   queue.Sender
	Results  result.Store
}

func (s *Server) caller(ctx context.Context) (string, string, error) {
	token := bearerFrom(ctx)
	if token == "" {
		return "", "", errUnauthorized
	}
	raw, err := s.DB.RPC(ctx, token, "set_owner", map[string]any{})
	if err != nil {
		return "", "", err
	}
	var userID string
	if err := json.Unmarshal(raw, &userID); err != nil || userID == "" {
		return "", "", errForbidden
	}
	return token, userID, nil
}

func (s *Server) sameBucket(name string) error {
	if s.Bucket == "" || name != s.Bucket {
		return errForbidden
	}
	return nil
}

func classify(err error) (int, string) {
	if err == nil {
		return http.StatusOK, ""
	}
	var dbErr *supadb.Error
	if errors.As(err, &dbErr) {
		message := dbErr.Message
		if message == "" {
			message = "database request failed"
		}
		switch {
		case dbErr.Status == http.StatusUnauthorized:
			return http.StatusUnauthorized, "Unauthorized"
		case dbErr.Status == http.StatusForbidden || strings.Contains(strings.ToLower(message), "forbidden"):
			return http.StatusForbidden, "Forbidden"
		case dbErr.Status == http.StatusNotFound:
			return http.StatusNotFound, "Not found"
		case dbErr.Status >= 400 && dbErr.Status < 500:
			return http.StatusBadRequest, message
		default:
			slog.Error("database request failed", "code", dbErr.Code, "status", dbErr.Status)
			return http.StatusInternalServerError, "internal error"
		}
	}
	switch {
	case errors.Is(err, errUnauthorized):
		return http.StatusUnauthorized, "Unauthorized"
	case errors.Is(err, errForbidden), errors.Is(err, s3store.ErrAccessDenied):
		return http.StatusForbidden, "Forbidden"
	case errors.Is(err, errNotFound), errors.Is(err, s3store.ErrNotFound), errors.Is(err, clerkprofile.ErrNotFound):
		return http.StatusNotFound, "Not found"
	case errors.Is(err, errBadRequest):
		message := strings.TrimPrefix(err.Error(), errBadRequest.Error()+": ")
		if message == "" || message == err.Error() {
			message = "Bad request"
		}
		return http.StatusBadRequest, message
	case errors.Is(err, errConflict), errors.Is(err, s3store.ErrInactive):
		return http.StatusConflict, "Conflict"
	case errors.Is(err, s3store.ErrTooLarge):
		return http.StatusRequestEntityTooLarge, "Entity too large"
	default:
		slog.Error("request failed", "error", err)
		return http.StatusInternalServerError, "internal error"
	}
}
