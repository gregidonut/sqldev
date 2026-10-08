package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/utils"
	"github.com/gregidonut/sqldev/packages/functions/internal/imagor"
	"github.com/gregidonut/sqldev/packages/functions/internal/jobs"
)

func (s *Server) TransformImage(ctx context.Context, request TransformImageRequestObject) (TransformImageResponseObject, error) {
	if request.Body == nil {
		return transformFailure(errBadRequest), nil
	}
	spec := imagor.Request{
		SourceKey: request.Body.SourceKey,
		Width:     request.Body.Width,
		Height:    request.Body.Height,
		Fit:       string(request.Body.Fit),
		Format:    string(request.Body.Format),
		Quality:   request.Body.Quality,
		Preview:   string(request.Body.Preview),
	}
	if err := imagor.Validate(spec); err != nil {
		return transformFailure(fmt.Errorf("%w: %s", errBadRequest, err.Error())), nil
	}
	receipt, err := s.submit(ctx, jobs.KindImagor, spec, request.Params.IdempotencyKey)
	if err != nil {
		return transformFailure(err), nil
	}
	return TransformImage202JSONResponse{JobAcceptedJSONResponse: JobAcceptedJSONResponse(receipt)}, nil
}

// PrepareImage checks the caller's storage permission. It does not call Imagor.
func (s *Server) PrepareImage(ctx context.Context, envelope jobs.Envelope) (imagor.Request, jobs.Outcome) {
	request, err := s.prepareImage(ctx, envelope)
	if err != nil {
		return imagor.Request{}, outcomeError(err)
	}
	return request, jobs.Outcome{}
}

// RenderImage calls Imagor and returns the bytes to store. The worker calls it
// after the database transaction has finished.
func (s *Server) RenderImage(ctx context.Context, envelope jobs.Envelope, request imagor.Request) (jobs.Outcome, error) {
	if s.Images == nil {
		return jobs.Outcome{HTTPStatus: http.StatusNotImplemented, Message: "imagor is not configured"}, nil
	}
	renderCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	image, err := s.Images.Render(renderCtx, request)
	if err != nil {
		return outcomeError(err), nil
	}
	key, err := imagor.ResultKey(envelope.Claims.Subject, envelope.JobID)
	if err != nil {
		return outcomeError(err), nil
	}
	return jobs.Outcome{
		HTTPStatus: http.StatusOK,
		Artifact: &jobs.Artifact{
			Key:         key,
			ContentType: image.ContentType,
			Body:        image.Body,
		},
	}, nil
}

func (s *Server) prepareImage(ctx context.Context, envelope jobs.Envelope) (imagor.Request, error) {
	var request imagor.Request
	if err := json.Unmarshal(envelope.Payload, &request); err != nil {
		return imagor.Request{}, errBadRequest
	}
	if err := imagor.Validate(request); err != nil {
		return imagor.Request{}, fmt.Errorf("%w: %s", errBadRequest, err.Error())
	}
	if _, err := utils.ParseObjectKey(request.SourceKey); err != nil {
		return imagor.Request{}, fmt.Errorf("%w: %s", errBadRequest, err.Error())
	}
	token, userID, err := s.caller(ctx)
	if err != nil {
		return imagor.Request{}, err
	}
	row, found, err := s.lookupKey(ctx, token, request.SourceKey)
	if err != nil {
		return imagor.Request{}, err
	}
	if !found {
		return imagor.Request{}, errForbidden
	}
	if !row.Public {
		if err := s.allow(ctx, token, userID, "d_storage_objects.read", row.StorageObjectID); err != nil {
			return imagor.Request{}, err
		}
	}
	if s.Objects == nil || s.Bucket == "" {
		return imagor.Request{}, errors.New("object store is not configured")
	}
	exists, err := s.Objects.Exists(ctx, s.Bucket, request.SourceKey)
	if err != nil {
		return imagor.Request{}, err
	}
	if !exists {
		return imagor.Request{}, errNotFound
	}
	return request, nil
}

func transformFailure(err error) TransformImageResponseObject {
	status, message := classify(err)
	switch status {
	case http.StatusUnauthorized:
		return TransformImage401JSONResponse{UnauthorizedJSONResponse: UnauthorizedJSONResponse{Message: message}}
	case http.StatusForbidden:
		return TransformImage403JSONResponse{ForbiddenJSONResponse: ForbiddenJSONResponse{Message: message}}
	case http.StatusBadRequest:
		return TransformImage400JSONResponse{BadRequestJSONResponse: BadRequestJSONResponse{Message: message}}
	default:
		return TransformImage500JSONResponse{InternalErrorJSONResponse: InternalErrorJSONResponse{Message: message}}
	}
}
