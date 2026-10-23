package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/gregidonut/sqldev/packages/functions/internal/imagor"
	"github.com/gregidonut/sqldev/packages/functions/internal/jobs"
	"github.com/gregidonut/sqldev/packages/functions/internal/status"
)

const maxReferenceFileNameBytes = 1024

type storageReference struct {
	Kind       string `json:"kind"`
	FileName   string `json:"fileName,omitempty"`
	RevisionID string `json:"revisionId,omitempty"`
	SourceKey  string `json:"sourceKey,omitempty"`
}

type publicStorageReference struct {
	Kind       string `json:"kind"`
	FileName   string `json:"fileName,omitempty"`
	RevisionID string `json:"revisionId,omitempty"`
}

func (s *Server) lookupStorageReference(ctx context.Context, jwt, objectID string) (storageReference, error) {
	parsed, err := uuid.Parse(strings.TrimSpace(objectID))
	if err != nil {
		return storageReference{Kind: "unavailable"}, nil
	}
	raw, err := s.DB.RPC(ctx, jwt, "resolve_d_storage_reference", map[string]any{
		"p_storage_object_id": parsed.String(),
	})
	if err != nil {
		return storageReference{}, err
	}
	return decodeStorageReference(raw)
}

func decodeStorageReference(raw json.RawMessage) (storageReference, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" || trimmed == "[]" {
		return storageReference{Kind: "unavailable"}, nil
	}
	var reference storageReference
	if err := json.Unmarshal(raw, &reference); err != nil {
		return storageReference{}, err
	}
	if reference.Kind != "ready" && reference.Kind != "unavailable" {
		return storageReference{Kind: "unavailable"}, nil
	}
	return reference, nil
}

// visibleStorageReference is the browser result. It never includes a storage key.
func visibleStorageReference(reference storageReference) publicStorageReference {
	if reference.Kind != "ready" || !imagor.Previewable(reference.FileName) || !safeReferenceFileName(reference.FileName) {
		return publicStorageReference{Kind: "unavailable"}
	}
	if _, err := uuid.Parse(reference.RevisionID); err != nil {
		return publicStorageReference{Kind: "unavailable"}
	}
	return publicStorageReference{
		Kind:       "ready",
		FileName:   reference.FileName,
		RevisionID: reference.RevisionID,
	}
}

func safeReferenceFileName(name string) bool {
	if name == "" || len(name) > maxReferenceFileNameBytes || strings.ContainsRune(name, 0) || !utf8.ValidString(name) {
		return false
	}
	return strings.TrimSpace(name) != ""
}

func (s *Server) executeResolveStorageReference(ctx context.Context, envelope jobs.Envelope) (jobs.Outcome, error) {
	var payload struct {
		StorageObjectID string `json:"storageObjectId"`
	}
	if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
		return outcomeError(errBadRequest), nil
	}
	token, _, err := s.caller(ctx)
	if err != nil {
		return outcomeError(err), nil
	}
	reference, err := s.lookupStorageReference(ctx, token, payload.StorageObjectID)
	if err != nil {
		return outcomeError(err), nil
	}
	body, err := json.Marshal(visibleStorageReference(reference))
	if err != nil {
		return outcomeError(err), nil
	}
	return jobs.Outcome{HTTPStatus: http.StatusOK, Body: body}, nil
}

func (s *Server) authorizeImageResult(ctx context.Context, record status.Record) error {
	if record.Kind != jobs.KindImagor || record.StorageObjectID == "" {
		return nil
	}
	if s.DB == nil {
		return errNotFound
	}
	reference, err := s.lookupStorageReference(ctx, bearerFrom(ctx), record.StorageObjectID)
	if err != nil {
		return err
	}
	if reference.Kind != "ready" || reference.RevisionID != record.RevisionID {
		return errNotFound
	}
	return nil
}

// BindImageResource records the rendered revision on a successful image outcome.
func BindImageResource(outcome jobs.Outcome, request imagor.Request) jobs.Outcome {
	return bindImageResource(outcome, request)
}

func bindImageResource(outcome jobs.Outcome, request imagor.Request) jobs.Outcome {
	if outcome.HTTPStatus >= 400 || request.StorageObjectID == "" || request.RevisionID == "" {
		return outcome
	}
	outcome.Resource = &jobs.ResourceBinding{
		StorageObjectID: request.StorageObjectID,
		RevisionID:      request.RevisionID,
	}
	return outcome
}

func (s *Server) ResolveStorageReference(ctx context.Context, request ResolveStorageReferenceRequestObject) (ResolveStorageReferenceResponseObject, error) {
	if request.Body == nil || request.Body.StorageObjectId == uuid.Nil {
		return resolveReferenceFailure(errBadRequest), nil
	}
	receipt, err := s.submit(ctx, jobs.KindResolveStorageReference, map[string]string{
		"storageObjectId": request.Body.StorageObjectId.String(),
	}, "")
	if err != nil {
		return resolveReferenceFailure(err), nil
	}
	return ResolveStorageReference202JSONResponse{JobAcceptedJSONResponse: JobAcceptedJSONResponse(receipt)}, nil
}

func (s *Server) PreviewStorageReference(ctx context.Context, request PreviewStorageReferenceRequestObject) (PreviewStorageReferenceResponseObject, error) {
	if request.Body == nil || request.Body.StorageObjectId == uuid.Nil || request.Body.RevisionId == uuid.Nil {
		return previewReferenceFailure(errBadRequest), nil
	}
	spec := imagor.Request{
		StorageObjectID: request.Body.StorageObjectId.String(),
		RevisionID:      request.Body.RevisionId.String(),
		Width:           request.Body.Width,
		Height:          request.Body.Height,
		Fit:             string(request.Body.Fit),
		Format:          string(request.Body.Format),
		Quality:         request.Body.Quality,
		Preview:         string(request.Body.Preview),
	}
	if err := imagor.ValidateOptions(spec); err != nil {
		return previewReferenceFailure(fmt.Errorf("%w: %s", errBadRequest, err.Error())), nil
	}
	receipt, err := s.submit(ctx, jobs.KindImagor, spec, request.Params.IdempotencyKey)
	if err != nil {
		return previewReferenceFailure(err), nil
	}
	return PreviewStorageReference202JSONResponse{JobAcceptedJSONResponse: JobAcceptedJSONResponse(receipt)}, nil
}

func resolveReferenceFailure(err error) ResolveStorageReferenceResponseObject {
	statusCode, message := classify(err)
	switch statusCode {
	case http.StatusUnauthorized:
		return ResolveStorageReference401JSONResponse{UnauthorizedJSONResponse: UnauthorizedJSONResponse{Message: message}}
	case http.StatusBadRequest:
		return ResolveStorageReference400JSONResponse{BadRequestJSONResponse: BadRequestJSONResponse{Message: message}}
	default:
		return ResolveStorageReference500JSONResponse{InternalErrorJSONResponse: InternalErrorJSONResponse{Message: message}}
	}
}

func previewReferenceFailure(err error) PreviewStorageReferenceResponseObject {
	statusCode, message := classify(err)
	switch statusCode {
	case http.StatusUnauthorized:
		return PreviewStorageReference401JSONResponse{UnauthorizedJSONResponse: UnauthorizedJSONResponse{Message: message}}
	case http.StatusForbidden:
		return PreviewStorageReference403JSONResponse{ForbiddenJSONResponse: ForbiddenJSONResponse{Message: message}}
	case http.StatusBadRequest:
		return PreviewStorageReference400JSONResponse{BadRequestJSONResponse: BadRequestJSONResponse{Message: message}}
	case http.StatusConflict:
		return PreviewStorageReference409JSONResponse{ConflictJSONResponse: ConflictJSONResponse{Message: message}}
	default:
		return PreviewStorageReference500JSONResponse{InternalErrorJSONResponse: InternalErrorJSONResponse{Message: message}}
	}
}
