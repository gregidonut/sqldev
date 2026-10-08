package api

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/utils"
	"github.com/gregidonut/sqldev/packages/functions/internal/jobs"
)

func (s *Server) Execute(ctx context.Context, envelope jobs.Envelope) (jobs.Outcome, error) {
	switch envelope.Kind {
	case jobs.KindImagor:
		request, outcome := s.PrepareImage(ctx, envelope)
		if outcome.HTTPStatus != 0 {
			return outcome, nil
		}
		return s.RenderImage(ctx, envelope, request)
	case jobs.KindListView:
		var payload struct {
			View string `json:"view"`
		}
		if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
			return outcomeError(errBadRequest), nil
		}
		return s.executeListView(ctx, ViewName(payload.View))
	case jobs.KindGetViewItem:
		var payload struct {
			View   string `json:"view"`
			ItemID string `json:"itemId"`
		}
		if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
			return outcomeError(errBadRequest), nil
		}
		return s.executeGetViewItem(ctx, ViewName(payload.View), payload.ItemID)
	case jobs.KindCreateViewItem:
		var payload struct {
			View ViewName       `json:"view"`
			Args map[string]any `json:"args"`
		}
		if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
			return outcomeError(errBadRequest), nil
		}
		return s.executeCreateViewItem(ctx, payload.View, payload.Args)
	case jobs.KindUpdateViewItem:
		var payload struct {
			View ViewName       `json:"view"`
			Args map[string]any `json:"args"`
		}
		if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
			return outcomeError(errBadRequest), nil
		}
		return s.executeUpdateViewItem(ctx, payload.View, payload.Args)
	case jobs.KindGetTodoTree:
		var payload struct {
			TodoSpaceID string `json:"todoSpaceId"`
		}
		if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
			return outcomeError(errBadRequest), nil
		}
		return s.executeTodoTree(ctx, payload.TodoSpaceID)
	case jobs.KindMoveTodoItems:
		var payload struct {
			Args map[string]any `json:"args"`
		}
		if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
			return outcomeError(errBadRequest), nil
		}
		return s.executeMoveTodo(ctx, payload.Args)
	case jobs.KindCreateTodo:
		var payload struct {
			TodoSpaceID string         `json:"todoSpaceId"`
			Args        map[string]any `json:"args"`
		}
		if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
			return outcomeError(errBadRequest), nil
		}
		return s.executeCreateTodo(ctx, payload.TodoSpaceID, payload.Args)
	case jobs.KindBucketExists:
		var payload struct {
			Bucket string `json:"bucket"`
		}
		if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
			return outcomeError(errBadRequest), nil
		}
		return s.executeBucketExists(ctx, payload.Bucket)
	case jobs.KindListStorage:
		var payload struct {
			Bucket string `json:"bucket"`
			Tab    string `json:"tab"`
		}
		if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
			return outcomeError(errBadRequest), nil
		}
		return s.executeListStorage(ctx, payload.Bucket, StorageTab(payload.Tab))
	case jobs.KindPresign:
		var payload struct {
			Bucket   string `json:"bucket"`
			FileName string `json:"fileName"`
		}
		if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
			return outcomeError(errBadRequest), nil
		}
		return s.executePresign(ctx, payload.Bucket, payload.FileName)
	case jobs.KindCommit:
		var payload struct {
			Bucket  string        `json:"bucket"`
			Pending PendingUpload `json:"pending"`
		}
		if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
			return outcomeError(errBadRequest), nil
		}
		return s.executeCommit(ctx, payload.Bucket, payload.Pending)
	case jobs.KindAbort:
		var payload struct {
			Bucket  string        `json:"bucket"`
			Pending PendingUpload `json:"pending"`
		}
		if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
			return outcomeError(errBadRequest), nil
		}
		return s.executeAbort(ctx, payload.Bucket, payload.Pending)
	case jobs.KindDownload:
		var payload struct {
			Bucket string `json:"bucket"`
			Key    string `json:"key"`
		}
		if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
			return outcomeError(errBadRequest), nil
		}
		return s.executeDownload(ctx, payload.Bucket, payload.Key)
	case jobs.KindCopy:
		var payload struct {
			Bucket              string `json:"bucket"`
			Key                 string `json:"key"`
			DestinationBucket   string `json:"destinationBucket"`
			DestinationFileName string `json:"destinationFileName"`
		}
		if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
			return outcomeError(errBadRequest), nil
		}
		return s.executeCopy(ctx, payload.Bucket, payload.Key, payload.DestinationBucket, payload.DestinationFileName)
	case jobs.KindDeleteObject:
		var payload struct {
			Bucket    string `json:"bucket"`
			Key       string `json:"key"`
			VersionID string `json:"versionId"`
			Bypass    bool   `json:"bypass"`
		}
		if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
			return outcomeError(errBadRequest), nil
		}
		return s.executeDeleteOne(ctx, payload.Bucket, payload.Key, payload.VersionID, payload.Bypass)
	case jobs.KindDeleteObjects:
		var payload struct {
			Bucket string   `json:"bucket"`
			Keys   []string `json:"keys"`
			Bypass bool     `json:"bypass"`
		}
		if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
			return outcomeError(errBadRequest), nil
		}
		return s.executeDeleteMany(ctx, payload.Bucket, payload.Keys, payload.Bypass)
	default:
		return outcomeError(errBadRequest), nil
	}
}

func (s *Server) executeListView(ctx context.Context, view ViewName) (jobs.Outcome, error) {
	token, _, err := s.caller(ctx)
	if err != nil {
		return outcomeError(err), nil
	}
	spec, ok := viewSpecFor(view)
	if !ok {
		return outcomeError(errBadRequest), nil
	}
	raw, err := s.DB.List(ctx, token, spec.relation)
	if err != nil {
		return outcomeError(err), nil
	}
	rows, err := decodeRows(raw)
	if err != nil {
		return outcomeError(err), nil
	}
	return outcomeJSON(http.StatusOK, rows)
}

func (s *Server) executeGetViewItem(ctx context.Context, view ViewName, itemID string) (jobs.Outcome, error) {
	token, _, err := s.caller(ctx)
	if err != nil {
		return outcomeError(err), nil
	}
	spec, ok := viewSpecFor(view)
	if !ok {
		return outcomeError(errBadRequest), nil
	}
	raw, err := s.DB.One(ctx, token, spec.relation, spec.idColumn, itemID)
	if err != nil {
		return outcomeError(err), nil
	}
	var row JsonObject
	if err := json.Unmarshal(raw, &row); err != nil {
		return outcomeError(err), nil
	}
	return outcomeJSON(http.StatusOK, row)
}

func (s *Server) executeCreateViewItem(ctx context.Context, view ViewName, args map[string]any) (jobs.Outcome, error) {
	token, _, err := s.caller(ctx)
	if err != nil {
		return outcomeError(err), nil
	}
	spec, ok := viewSpecFor(view)
	if !ok {
		return outcomeError(errBadRequest), nil
	}
	selected := map[string]any{}
	for _, field := range spec.create {
		if value, exists := args[field]; exists {
			selected[field] = value
		}
	}
	if err := requireFields(selected, spec.requiredC...); err != nil {
		return outcomeError(err), nil
	}
	raw, err := s.DB.RPC(ctx, token, spec.createRPC, selected)
	if err != nil {
		return outcomeError(err), nil
	}
	if view == IgPosts {
		s.notifyPost(ctx, token, raw)
	}
	rows, err := decodeRows(raw)
	if err != nil {
		return outcomeError(err), nil
	}
	return outcomeJSON(http.StatusOK, rows)
}

func (s *Server) executeUpdateViewItem(ctx context.Context, view ViewName, args map[string]any) (jobs.Outcome, error) {
	token, _, err := s.caller(ctx)
	if err != nil {
		return outcomeError(err), nil
	}
	spec, ok := viewSpecFor(view)
	if !ok {
		return outcomeError(errBadRequest), nil
	}
	selected := map[string]any{}
	for _, field := range spec.update {
		if value, exists := args[field]; exists {
			selected[field] = value
		}
	}
	if err := requireFields(selected, spec.requiredU...); err != nil {
		return outcomeError(err), nil
	}
	raw, err := s.DB.RPC(ctx, token, spec.updateRPC, selected)
	if err != nil {
		return outcomeError(err), nil
	}
	if view == IgPosts {
		s.notifyPost(ctx, token, raw)
	}
	rows, err := decodeRows(raw)
	if err != nil {
		return outcomeError(err), nil
	}
	return outcomeJSON(http.StatusOK, rows)
}

func (s *Server) executeTodoTree(ctx context.Context, spaceID string) (jobs.Outcome, error) {
	token, _, err := s.caller(ctx)
	if err != nil {
		return outcomeError(err), nil
	}
	raw, err := s.DB.RPC(ctx, token, "get_tds_todos_tree", map[string]any{"p_todo_space_id": spaceID})
	if err != nil {
		return outcomeError(err), nil
	}
	rows, err := decodeRows(raw)
	if err != nil {
		return outcomeError(err), nil
	}
	return outcomeJSON(http.StatusOK, rows)
}

func (s *Server) executeMoveTodo(ctx context.Context, args map[string]any) (jobs.Outcome, error) {
	token, _, err := s.caller(ctx)
	if err != nil {
		return outcomeError(err), nil
	}
	if args["p_todo_item_ids"] == nil {
		return outcomeError(errBadRequest), nil
	}
	raw, err := s.DB.RPC(ctx, token, "move_tds_todo_items", args)
	if err != nil {
		return outcomeError(err), nil
	}
	rows, err := decodeRows(raw)
	if err != nil {
		return outcomeError(err), nil
	}
	return outcomeJSON(http.StatusOK, rows)
}

func (s *Server) executeCreateTodo(ctx context.Context, spaceID string, args map[string]any) (jobs.Outcome, error) {
	token, _, err := s.caller(ctx)
	if err != nil {
		return outcomeError(err), nil
	}
	if _, ok := args["p_todo_space_id"]; !ok {
		args["p_todo_space_id"] = spaceID
	}
	if err := requireFields(args, "p_todo_space_id", "p_title"); err != nil {
		return outcomeError(err), nil
	}
	raw, err := s.DB.RPC(ctx, token, "create_tds_todo", args)
	if err != nil {
		return outcomeError(err), nil
	}
	rows, err := decodeRows(raw)
	if err != nil {
		return outcomeError(err), nil
	}
	return outcomeJSON(http.StatusOK, rows)
}

func (s *Server) executeBucketExists(ctx context.Context, bucket string) (jobs.Outcome, error) {
	if _, _, err := s.caller(ctx); err != nil {
		return outcomeError(err), nil
	}
	if err := s.sameBucket(bucket); err != nil {
		return outcomeError(err), nil
	}
	exists, err := s.Objects.BucketExists(ctx, bucket)
	if err != nil {
		return outcomeError(err), nil
	}
	if !exists {
		return outcomeError(errNotFound), nil
	}
	return jobs.Outcome{HTTPStatus: http.StatusOK}, nil
}

func (s *Server) executeListStorage(ctx context.Context, bucket string, tab StorageTab) (jobs.Outcome, error) {
	token, _, err := s.caller(ctx)
	if err != nil {
		return outcomeError(err), nil
	}
	if err := s.sameBucket(bucket); err != nil {
		return outcomeError(err), nil
	}
	if !tab.Valid() {
		return outcomeError(errBadRequest), nil
	}
	raw, err := s.DB.RPC(ctx, token, "get_d_storage_objects", map[string]any{"p_tab": string(tab)})
	if err != nil {
		return outcomeError(err), nil
	}
	var rows []StorageObjectRow
	if err := json.Unmarshal(raw, &rows); err != nil {
		return outcomeError(err), nil
	}
	visible := make([]StorageObjectRow, 0, len(rows))
	for _, row := range rows {
		if row.S3ObjectKey == nil || *row.S3ObjectKey == "" {
			continue
		}
		visible = append(visible, row)
	}
	return outcomeJSON(http.StatusOK, visible)
}

func (s *Server) executePresign(ctx context.Context, bucket, fileName string) (jobs.Outcome, error) {
	token, _, err := s.caller(ctx)
	if err != nil {
		return outcomeError(err), nil
	}
	if err := s.sameBucket(bucket); err != nil {
		return outcomeError(err), nil
	}
	prepared, err := s.prepareUpload(ctx, token, fileName)
	if err != nil {
		return outcomeError(err), nil
	}
	pending, err := pendingFrom(prepared)
	if err != nil {
		return outcomeError(err), nil
	}
	signed, err := s.Objects.PresignPut(ctx, s.Bucket, pending.S3ObjectKey)
	if err != nil {
		s.abortPending(ctx, token, pending)
		return outcomeError(err), nil
	}
	return outcomeJSON(http.StatusOK, PresignResponse{Url: signed, Key: pending.S3ObjectKey, PendingUpload: pending})
}

func (s *Server) executeCommit(ctx context.Context, bucket string, pending PendingUpload) (jobs.Outcome, error) {
	token, userID, err := s.caller(ctx)
	if err != nil {
		return outcomeError(err), nil
	}
	if err := s.sameBucket(bucket); err != nil {
		return outcomeError(err), nil
	}
	if err := s.commitPrepared(ctx, token, userID, pending); err != nil {
		return outcomeError(err), nil
	}
	return jobs.Outcome{HTTPStatus: http.StatusNoContent}, nil
}

func (s *Server) executeAbort(ctx context.Context, bucket string, pending PendingUpload) (jobs.Outcome, error) {
	token, userID, err := s.caller(ctx)
	if err != nil {
		return outcomeError(err), nil
	}
	if err := s.sameBucket(bucket); err != nil {
		return outcomeError(err), nil
	}
	if err := validatePending(userID, pending); err != nil {
		return outcomeError(err), nil
	}
	if _, err := s.DB.RPC(ctx, token, "abort_d_storage_upload", abortArgs(pending)); err != nil {
		return outcomeError(err), nil
	}
	return jobs.Outcome{HTTPStatus: http.StatusNoContent}, nil
}

func (s *Server) executeDownload(ctx context.Context, bucket, key string) (jobs.Outcome, error) {
	token, userID, err := s.caller(ctx)
	if err != nil {
		return outcomeError(err), nil
	}
	if err := s.sameBucket(bucket); err != nil {
		return outcomeError(err), nil
	}
	if _, err := utils.ParseObjectKey(key); err != nil {
		return outcomeError(errBadRequest), nil
	}
	row, found, err := s.lookupKey(ctx, token, key)
	if err != nil {
		return outcomeError(err), nil
	}
	if !found {
		return outcomeError(errForbidden), nil
	}
	if !row.Public {
		if err := s.allow(ctx, token, userID, "d_storage_objects.read", row.StorageObjectID); err != nil {
			return outcomeError(err), nil
		}
	}
	exists, err := s.Objects.Exists(ctx, s.Bucket, key)
	if err != nil {
		return outcomeError(err), nil
	}
	if !exists {
		return outcomeError(errNotFound), nil
	}
	url, err := s.Objects.PresignGet(ctx, s.Bucket, key)
	if err != nil {
		return outcomeError(err), nil
	}
	return outcomeJSON(http.StatusOK, map[string]string{"url": url})
}

func (s *Server) executeCopy(ctx context.Context, bucket, key, destinationBucket, destinationFileName string) (jobs.Outcome, error) {
	token, userID, err := s.caller(ctx)
	if err != nil {
		return outcomeError(err), nil
	}
	if err := s.sameBucket(bucket); err != nil || s.sameBucket(destinationBucket) != nil {
		return outcomeError(errForbidden), nil
	}
	source, err := utils.ParseObjectKey(key)
	if err != nil {
		return outcomeError(errBadRequest), nil
	}
	row, found, err := s.lookupKey(ctx, token, key)
	if err != nil {
		return outcomeError(err), nil
	}
	if !found {
		return outcomeError(errForbidden), nil
	}
	if err := s.allow(ctx, token, userID, "d_storage_objects.read", row.StorageObjectID); err != nil {
		return outcomeError(err), nil
	}
	prepared, err := s.prepareUpload(ctx, token, destinationFileName)
	if err != nil {
		return outcomeError(err), nil
	}
	pending, err := pendingFrom(prepared)
	if err != nil {
		return outcomeError(err), nil
	}
	sourceKey, err := utils.BuildObjectKey(source)
	if err != nil {
		s.abortPending(ctx, token, pending)
		return outcomeError(err), nil
	}
	if err := s.Objects.Copy(ctx, s.Bucket, s.Bucket, sourceKey, pending.S3ObjectKey); err != nil {
		s.abortPending(ctx, token, pending)
		return outcomeError(err), nil
	}
	if err := s.commitPrepared(ctx, token, userID, pending); err != nil {
		return outcomeError(err), nil
	}
	return jobs.Outcome{HTTPStatus: http.StatusOK}, nil
}

func (s *Server) executeDeleteOne(ctx context.Context, bucket, key, versionID string, bypass bool) (jobs.Outcome, error) {
	token, userID, err := s.caller(ctx)
	if err != nil {
		return outcomeError(err), nil
	}
	if err := s.sameBucket(bucket); err != nil {
		return outcomeError(err), nil
	}
	if _, err := utils.ParseObjectKey(key); err != nil {
		return outcomeError(errBadRequest), nil
	}
	row, found, err := s.lookupKey(ctx, token, key)
	if err != nil {
		return outcomeError(err), nil
	}
	if !found {
		return outcomeError(errForbidden), nil
	}
	if err := s.allow(ctx, token, userID, "d_storage_objects.delete", row.StorageObjectID); err != nil {
		return outcomeError(err), nil
	}
	if err := s.Objects.Delete(ctx, s.Bucket, key, versionID, bypass); err != nil {
		return outcomeError(err), nil
	}
	return jobs.Outcome{HTTPStatus: http.StatusNoContent}, nil
}

func (s *Server) executeDeleteMany(ctx context.Context, bucket string, keys []string, bypass bool) (jobs.Outcome, error) {
	token, userID, err := s.caller(ctx)
	if err != nil {
		return outcomeError(err), nil
	}
	if err := s.sameBucket(bucket); err != nil {
		return outcomeError(err), nil
	}
	unique := uniqueKeys(keys)
	for _, key := range unique {
		if _, err := utils.ParseObjectKey(key); err != nil {
			return outcomeError(errBadRequest), nil
		}
		row, found, err := s.lookupKey(ctx, token, key)
		if err != nil {
			return outcomeError(err), nil
		}
		if !found {
			return outcomeError(errForbidden), nil
		}
		if err := s.allow(ctx, token, userID, "d_storage_objects.delete", row.StorageObjectID); err != nil {
			return outcomeError(err), nil
		}
	}
	if len(unique) > 0 {
		if err := s.Objects.DeleteMany(ctx, s.Bucket, unique, bypass); err != nil {
			return outcomeError(err), nil
		}
	}
	return jobs.Outcome{HTTPStatus: http.StatusOK}, nil
}

func outcomeJSON(status int, body any) (jobs.Outcome, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return jobs.Outcome{}, err
	}
	return jobs.Outcome{HTTPStatus: status, Body: raw}, nil
}

func outcomeError(err error) jobs.Outcome {
	status, message := classify(err)
	return jobs.Outcome{HTTPStatus: status, Message: message}
}
