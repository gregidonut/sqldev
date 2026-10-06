package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/url"
	"strings"

	"github.com/google/uuid"
	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/s3store"
	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/utils"
)

type tokenContextKey struct{}

func bearerFrom(ctx context.Context) string {
	token, _ := ctx.Value(tokenContextKey{}).(string)
	return token
}

func bearerToken(header string) string {
	const prefix = "Bearer "
	if len(header) < len(prefix) || !strings.EqualFold(header[:len(prefix)], prefix) {
		return ""
	}
	return strings.TrimSpace(header[len(prefix):])
}

func readForm(reader *multipart.Reader) (url.Values, error) {
	if reader == nil {
		return nil, fmt.Errorf("%w: form body is required", errBadRequest)
	}
	const maxFields = 32
	const maxFieldBytes = 1 << 20
	values := url.Values{}
	for range maxFields {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			return values, nil
		}
		if err != nil {
			return nil, fmt.Errorf("%w: invalid form", errBadRequest)
		}
		data, err := io.ReadAll(io.LimitReader(part, maxFieldBytes+1))
		_ = part.Close()
		if err != nil {
			return nil, err
		}
		if len(data) > maxFieldBytes {
			return nil, fmt.Errorf("%w: form field is too large", errBadRequest)
		}
		name := part.FormName()
		if name == "" || name == "payload" {
			continue
		}
		values.Add(name, string(data))
	}
	return nil, fmt.Errorf("%w: too many form fields", errBadRequest)
}

func selectedArgs(values url.Values, fields []string) (map[string]any, error) {
	args := make(map[string]any, len(fields))
	for _, field := range fields {
		raw, ok := values[field]
		if !ok || len(raw) == 0 {
			continue
		}
		if field == "p_public" {
			parsed, err := parseBool(raw[0])
			if err != nil {
				return nil, err
			}
			args[field] = parsed
			continue
		}
		if len(raw) == 1 {
			args[field] = raw[0]
			continue
		}
		args[field] = raw
	}
	return args, nil
}

func parseBool(value string) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "true", "1", "on":
		return true, nil
	case "false", "0", "off":
		return false, nil
	default:
		return false, fmt.Errorf("%w: p_public must be a boolean", errBadRequest)
	}
}

func requireFields(args map[string]any, fields ...string) error {
	for _, field := range fields {
		value, ok := args[field]
		if !ok {
			return fmt.Errorf("%w: %s is required", errBadRequest, field)
		}
		text, isText := value.(string)
		if isText && strings.TrimSpace(text) == "" {
			return fmt.Errorf("%w: %s is required", errBadRequest, field)
		}
	}
	return nil
}

func decodeRows(raw json.RawMessage) ([]JsonObject, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return []JsonObject{}, nil
	}
	var rows []JsonObject
	if err := json.Unmarshal(raw, &rows); err != nil {
		return nil, err
	}
	if rows == nil {
		return []JsonObject{}, nil
	}
	return rows, nil
}

func (s *Server) notifyPost(ctx context.Context, jwt string, raw json.RawMessage) {
	var rows []struct {
		PostID string `json:"post_id"`
	}
	if err := json.Unmarshal(raw, &rows); err != nil || len(rows) == 0 || rows[0].PostID == "" {
		return
	}
	if _, err := s.DB.RPC(ctx, jwt, "notify_ig_posts_view_for_post", map[string]any{
		"p_post_id": rows[0].PostID,
	}); err != nil {
		slog.Error("notify ig post", "error", err)
	}
}

type objectLookup struct {
	StorageObjectID string `json:"storage_object_id"`
	Public          bool   `json:"public"`
}

func (s *Server) lookupKey(ctx context.Context, jwt, key string) (objectLookup, bool, error) {
	raw, err := s.DB.RPC(ctx, jwt, "get_d_storage_object_by_key", map[string]any{
		"p_s3_object_key": key,
	})
	if err != nil {
		return objectLookup{}, false, err
	}
	var rows []objectLookup
	if err := json.Unmarshal(raw, &rows); err != nil {
		return objectLookup{}, false, err
	}
	if len(rows) == 0 || rows[0].StorageObjectID == "" {
		return objectLookup{}, false, nil
	}
	return rows[0], true, nil
}

func (s *Server) allow(ctx context.Context, jwt, userID, permission, objectID string) error {
	raw, err := s.DB.RPC(ctx, jwt, "authorize_d_storage_object", map[string]any{
		"p_requested_user_id":           userID,
		"p_requested_permission":        permission,
		"p_requested_storage_object_id": objectID,
	})
	if err != nil {
		return err
	}
	var allowed bool
	if err := json.Unmarshal(raw, &allowed); err != nil {
		return err
	}
	if !allowed {
		return errForbidden
	}
	return nil
}

type preparedUpload struct {
	UserID              string `json:"user_id"`
	StorageObjectID     string `json:"storage_object_id"`
	StorageObjectDataID string `json:"storage_object_data_id"`
	FileName            string `json:"file_name"`
	S3ObjectKey         string `json:"s3_object_key"`
	IsNewObject         bool   `json:"is_new_object"`
}

func (s *Server) prepareUpload(ctx context.Context, jwt, fileName string) (preparedUpload, error) {
	if strings.TrimSpace(fileName) == "" {
		return preparedUpload{}, fmt.Errorf("%w: fileName is required", errBadRequest)
	}
	raw, err := s.DB.RPC(ctx, jwt, "prepare_d_storage_upload", map[string]any{
		"p_file_name": fileName,
	})
	if err != nil {
		return preparedUpload{}, err
	}
	var rows []preparedUpload
	if err := json.Unmarshal(raw, &rows); err != nil {
		return preparedUpload{}, err
	}
	if len(rows) == 0 || rows[0].S3ObjectKey == "" {
		return preparedUpload{}, errors.New("prepare upload returned no rows")
	}
	return rows[0], nil
}

func pendingFrom(row preparedUpload) (PendingUpload, error) {
	objectID, err := uuid.Parse(row.StorageObjectID)
	if err != nil {
		return PendingUpload{}, fmt.Errorf("prepare upload object id: %w", err)
	}
	dataID, err := uuid.Parse(row.StorageObjectDataID)
	if err != nil {
		return PendingUpload{}, fmt.Errorf("prepare upload data id: %w", err)
	}
	return PendingUpload{
		FileName:            row.FileName,
		IsNewObject:         row.IsNewObject,
		S3ObjectKey:         row.S3ObjectKey,
		StorageObjectDataId: dataID,
		StorageObjectId:     objectID,
	}, nil
}

func validatePending(userID string, pending PendingUpload) error {
	parts, err := utils.ParseObjectKey(pending.S3ObjectKey)
	if err != nil {
		return fmt.Errorf("%w: %s", errBadRequest, err.Error())
	}
	if parts.UserID != userID {
		return errForbidden
	}
	if parts.StorageObjectID != pending.StorageObjectId.String() ||
		parts.StorageObjectDataID != pending.StorageObjectDataId.String() ||
		parts.FileName != pending.FileName {
		return fmt.Errorf("%w: pending upload does not match its object key", errBadRequest)
	}
	return nil
}

func abortArgs(pending PendingUpload) map[string]any {
	return map[string]any{
		"p_storage_object_id": pending.StorageObjectId.String(),
		"p_is_new_object":     pending.IsNewObject,
	}
}

func commitArgs(pending PendingUpload) map[string]any {
	return map[string]any{
		"p_storage_object_id":      pending.StorageObjectId.String(),
		"p_storage_object_data_id": pending.StorageObjectDataId.String(),
		"p_file_name":              pending.FileName,
	}
}

func (s *Server) abortPending(ctx context.Context, jwt string, pending PendingUpload) {
	if _, err := s.DB.RPC(ctx, jwt, "abort_d_storage_upload", abortArgs(pending)); err != nil {
		slog.Error("abort pending upload", "error", err)
	}
}

func (s *Server) deleteObjectBestEffort(ctx context.Context, key string) {
	if err := s.Objects.Delete(ctx, s.Bucket, key, "", false); err != nil && !errors.Is(err, s3store.ErrNotFound) {
		slog.Error("delete orphaned object", "error", err)
	}
}
