package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/gregidonut/sqldev/packages/functions/internal/jobs"
	"github.com/gregidonut/sqldev/packages/functions/internal/queue"
	"github.com/gregidonut/sqldev/packages/functions/internal/result"
	"github.com/gregidonut/sqldev/packages/functions/internal/status"
)

const (
	resultInlineLimit = 300_000
	imagePresignTTL   = 5 * time.Minute
)

type Identity interface {
	Verify(token string) (jobs.Claims, error)
}

func (s *Server) submit(ctx context.Context, kind string, payload any, idempotencyKey string) (JobReceipt, error) {
	claims, err := s.authenticate(ctx)
	if err != nil {
		return JobReceipt{}, err
	}
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if jobs.Mutation(kind) && idempotencyKey == "" {
		return JobReceipt{}, fmt.Errorf("%w: idempotency key is required", errBadRequest)
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return JobReceipt{}, err
	}
	jobID := jobs.NewID()
	if jobs.Mutation(kind) {
		jobID, err = jobs.StableID(claims.Subject, kind, idempotencyKey)
		if err != nil {
			return JobReceipt{}, err
		}
	}
	record := status.Record{
		JobID:     jobID,
		Owner:     claims.Subject,
		Kind:      kind,
		Status:    status.Pending,
		ExpiresAt: time.Now().Add(24 * time.Hour),
	}
	if err := s.Jobs.Create(ctx, record); err != nil {
		if !errors.Is(err, status.ErrExists) {
			return JobReceipt{}, err
		}
		existing, getErr := s.Jobs.Get(ctx, jobID)
		if getErr != nil {
			return JobReceipt{}, getErr
		}
		if existing.Owner != claims.Subject || existing.Kind != kind {
			return JobReceipt{}, errForbidden
		}
		if err := s.reopenFailedImage(ctx, kind, existing); err != nil {
			return JobReceipt{}, err
		}
	}
	envelope := jobs.Envelope{
		Version: jobs.Version,
		JobID:   jobID,
		Kind:    kind,
		Claims:  claims,
		Payload: body,
	}
	encoded, err := envelope.Marshal()
	if err != nil {
		return JobReceipt{}, err
	}
	if s.Sender == nil {
		return JobReceipt{}, errors.New("job sender is not configured")
	}
	if err := s.Sender.Send(ctx, encoded); err != nil {
		return JobReceipt{}, err
	}
	parsed, err := uuid.Parse(jobID)
	if err != nil {
		return JobReceipt{}, err
	}
	return JobReceipt{JobId: parsed, Status: JobReceiptStatusPending}, nil
}

// reopenFailedImage lets a failed thumbnail run again. The first attempt keeps
// the stable job id, and later attempts use a new worker workflow id.
func (s *Server) reopenFailedImage(ctx context.Context, kind string, existing status.Record) error {
	if kind != jobs.KindImagor || existing.Status != status.Failed {
		return nil
	}
	next := existing.Attempt + 1
	if next < 2 {
		next = 2
	}
	existing.Status = status.Pending
	existing.HTTPStatus = 0
	existing.Message = ""
	existing.Body = nil
	existing.ResultKey = ""
	existing.ContentType = ""
	existing.Attempt = next
	return s.Jobs.Update(ctx, existing)
}

func (s *Server) authenticate(ctx context.Context) (jobs.Claims, error) {
	token := bearerFrom(ctx)
	if token == "" || s.Identity == nil {
		return jobs.Claims{}, errUnauthorized
	}
	claims, err := s.Identity.Verify(token)
	if err != nil {
		return jobs.Claims{}, errUnauthorized
	}
	return claims, nil
}

func (s *Server) GetJob(ctx context.Context, request GetJobRequestObject) (GetJobResponseObject, error) {
	claims, err := s.authenticate(ctx)
	if err != nil {
		return GetJob401JSONResponse{UnauthorizedJSONResponse: UnauthorizedJSONResponse{Message: "Unauthorized"}}, nil
	}
	if s.Jobs == nil {
		return GetJob500JSONResponse{InternalErrorJSONResponse: InternalErrorJSONResponse{Message: "internal error"}}, nil
	}
	record, err := s.Jobs.Get(ctx, request.JobId.String())
	if err != nil || record.Owner != claims.Subject {
		return GetJob404JSONResponse{NotFoundJSONResponse: NotFoundJSONResponse{Message: "Not found"}}, nil
	}
	state := JobState{
		JobId:      request.JobId,
		Status:     JobStateStatus(record.Status),
		HttpStatus: httpStatusPointer(record.HTTPStatus),
	}
	if record.Status == status.Failed {
		state.Error = &ErrorMessage{Message: record.Message}
	}
	if record.Status == status.Completed && record.ContentType != "" {
		if record.ResultKey == "" || s.Results == nil {
			return GetJob500JSONResponse{InternalErrorJSONResponse: InternalErrorJSONResponse{Message: "internal error"}}, nil
		}
		signed, signErr := s.Results.PresignGet(ctx, record.ResultKey, record.ContentType, imagePresignTTL)
		if signErr != nil {
			return GetJob500JSONResponse{InternalErrorJSONResponse: InternalErrorJSONResponse{Message: "internal error"}}, nil
		}
		state.Result = map[string]string{
			"url":         signed,
			"contentType": record.ContentType,
		}
		return GetJob200JSONResponse(state), nil
	}
	if record.Status == status.Completed {
		body := record.Body
		if record.ResultKey != "" && s.Results != nil {
			loaded, loadErr := s.Results.Get(ctx, record.ResultKey)
			if loadErr != nil {
				return GetJob500JSONResponse{InternalErrorJSONResponse: InternalErrorJSONResponse{Message: "internal error"}}, nil
			}
			body = loaded
		}
		if len(body) > 0 && string(body) != "null" {
			var decoded any
			if err := json.Unmarshal(body, &decoded); err != nil {
				return GetJob500JSONResponse{InternalErrorJSONResponse: InternalErrorJSONResponse{Message: "internal error"}}, nil
			}
			state.Result = decoded
		}
	}
	return GetJob200JSONResponse(state), nil
}

func (s *Server) Finish(ctx context.Context, envelope jobs.Envelope, outcome jobs.Outcome) error {
	record, err := s.Jobs.Get(ctx, envelope.JobID)
	if err != nil {
		return err
	}
	record.HTTPStatus = outcome.HTTPStatus
	record.Message = outcome.Message
	if outcome.HTTPStatus >= 400 {
		record.Status = status.Failed
		record.Body = nil
		record.ContentType = ""
		record.ResultKey = ""
	} else if outcome.Artifact != nil {
		if s.Results == nil || outcome.Artifact.Key == "" || outcome.Artifact.ContentType == "" || len(outcome.Artifact.Body) == 0 {
			return errors.New("image artifact is incomplete")
		}
		if err := s.Results.PutObject(ctx, outcome.Artifact.Key, outcome.Artifact.ContentType, outcome.Artifact.Body); err != nil {
			return err
		}
		record.Status = status.Completed
		record.ResultKey = outcome.Artifact.Key
		record.ContentType = outcome.Artifact.ContentType
		record.Body = nil
	} else {
		record.Status = status.Completed
		record.ContentType = ""
		if len(outcome.Body) > resultInlineLimit && s.Results != nil {
			key := "jobs/" + envelope.JobID + ".json"
			if err := s.Results.Put(ctx, key, outcome.Body); err != nil {
				return err
			}
			record.ResultKey = key
			record.Body = nil
		} else {
			record.Body = outcome.Body
		}
	}
	return s.Jobs.Update(ctx, record)
}

func httpStatusPointer(statusCode int) *int {
	if statusCode == 0 {
		return nil
	}
	return &statusCode
}

// Ensure the job stores satisfy the server when tests construct one.
var (
	_ queue.Sender = queue.NewMemory()
	_ result.Store = (*memoryResults)(nil)
)

type memoryResults struct {
	values map[string][]byte
	types  map[string]string
}

func (m *memoryResults) Put(_ context.Context, key string, body []byte) error {
	if m.values == nil {
		m.values = map[string][]byte{}
	}
	m.values[key] = append([]byte(nil), body...)
	return nil
}

func (m *memoryResults) PutObject(_ context.Context, key, contentType string, body []byte) error {
	switch contentType {
	case "image/jpeg", "image/png", "image/webp":
	default:
		return errors.New("result content type is not an image")
	}
	if err := m.Put(context.Background(), key, body); err != nil {
		return err
	}
	if m.types == nil {
		m.types = map[string]string{}
	}
	m.types[key] = contentType
	return nil
}

func (m *memoryResults) PresignGet(_ context.Context, key, contentType string, expires time.Duration) (string, error) {
	if _, ok := m.values[key]; !ok {
		return "", result.ErrNotFound
	}
	if m.types[key] != contentType {
		return "", errors.New("content type mismatch")
	}
	if expires <= 0 || expires > 15*time.Minute {
		return "", errors.New("presign expiry is outside the allowed range")
	}
	return "https://example.test/" + key + "?expires=" + expires.String(), nil
}

func (m *memoryResults) Get(_ context.Context, key string) ([]byte, error) {
	body, ok := m.values[key]
	if !ok {
		return nil, result.ErrNotFound
	}
	return append([]byte(nil), body...), nil
}
