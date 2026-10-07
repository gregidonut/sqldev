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

const resultInlineLimit = 300_000

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
	} else {
		record.Status = status.Completed
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
}

func (m *memoryResults) Put(_ context.Context, key string, body []byte) error {
	if m.values == nil {
		m.values = map[string][]byte{}
	}
	m.values[key] = append([]byte(nil), body...)
	return nil
}

func (m *memoryResults) Get(_ context.Context, key string) ([]byte, error) {
	body, ok := m.values[key]
	if !ok {
		return nil, result.ErrNotFound
	}
	return append([]byte(nil), body...), nil
}
