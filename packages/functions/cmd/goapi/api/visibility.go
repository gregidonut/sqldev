package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"

	"github.com/google/uuid"

	"github.com/gregidonut/sqldev/packages/functions/internal/jobs"
)

// maxConfigRevision is the largest integer a JavaScript number represents exactly.
const maxConfigRevision = 9007199254740991

var proofPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

// setVisibilityPayload is the SQS payload of KindSetStorageVisibility.
type setVisibilityPayload struct {
	TargetID         string `json:"targetId"`
	ExpectedRevision int64  `json:"expectedRevision"`
	Public           bool   `json:"public"`
}

// confirmPayload is the SQS payload of KindConfirmOperation.
type confirmPayload struct {
	OperationKind    string `json:"operationKind"`
	TargetType       string `json:"targetType"`
	TargetID         string `json:"targetId"`
	ExpectedRevision int64  `json:"expectedRevision"`
	ChallengeID      string `json:"challengeId"`
	Proof            string `json:"proof"`
}

func validRevision(revision int64) bool {
	return revision >= 1 && revision <= maxConfigRevision
}

func validTarget(target ConfirmationTarget) bool {
	return target.Type == StorageObject && target.Id != uuid.Nil
}

// SetStorageObjectVisibility queues a make-private, or the first half of make-public.
// Neither waits for the user: confirming is a separate request and a separate job.
func (s *Server) SetStorageObjectVisibility(ctx context.Context, request SetStorageObjectVisibilityRequestObject) (SetStorageObjectVisibilityResponseObject, error) {
	if err := s.sameBucket(request.BucketName); err != nil {
		return setVisibilityFailure(err), nil
	}
	body := request.Body
	if body == nil || !validTarget(body.Target) || !validRevision(body.ExpectedRevision) ||
		(body.Visibility != VisibilityPublic && body.Visibility != VisibilityPrivate) {
		return setVisibilityFailure(errBadRequest), nil
	}
	receipt, err := s.submit(ctx, jobs.KindSetStorageVisibility, setVisibilityPayload{
		TargetID:         body.Target.Id.String(),
		ExpectedRevision: body.ExpectedRevision,
		Public:           body.Visibility == VisibilityPublic,
	}, request.Params.IdempotencyKey)
	if err != nil {
		return setVisibilityFailure(err), nil
	}
	return SetStorageObjectVisibility202JSONResponse{JobAcceptedJSONResponse: JobAcceptedJSONResponse(receipt)}, nil
}

// ConfirmOperation queues the second half of a confirmable operation.
func (s *Server) ConfirmOperation(ctx context.Context, request ConfirmOperationRequestObject) (ConfirmOperationResponseObject, error) {
	body := request.Body
	if body == nil || body.OperationKind != StorageVisibilityMakePublic || !validTarget(body.Target) ||
		!validRevision(body.ExpectedRevision) || body.ChallengeId == uuid.Nil || !proofPattern.MatchString(body.Proof) {
		return confirmFailure(errBadRequest), nil
	}
	receipt, err := s.submit(ctx, jobs.KindConfirmOperation, confirmPayload{
		OperationKind:    string(body.OperationKind),
		TargetType:       string(body.Target.Type),
		TargetID:         body.Target.Id.String(),
		ExpectedRevision: body.ExpectedRevision,
		ChallengeID:      body.ChallengeId.String(),
		Proof:            body.Proof,
	}, request.Params.IdempotencyKey)
	if err != nil {
		return confirmFailure(err), nil
	}
	return ConfirmOperation202JSONResponse{JobAcceptedJSONResponse: JobAcceptedJSONResponse(receipt)}, nil
}

func idempotencyConflict() OperationRejectedJSONResponse {
	return OperationRejectedJSONResponse{Kind: Rejected, Reason: RejectionReasonIdempotencyConflict}
}

func setVisibilityFailure(err error) SetStorageObjectVisibilityResponseObject {
	status, message := classify(err)
	switch status {
	case http.StatusUnauthorized:
		return SetStorageObjectVisibility401JSONResponse{UnauthorizedJSONResponse: UnauthorizedJSONResponse{Message: message}}
	case http.StatusForbidden:
		return SetStorageObjectVisibility403JSONResponse{ForbiddenJSONResponse: ForbiddenJSONResponse{Message: message}}
	case http.StatusBadRequest:
		return SetStorageObjectVisibility400JSONResponse{BadRequestJSONResponse: BadRequestJSONResponse{Message: message}}
	case http.StatusConflict:
		return SetStorageObjectVisibility409JSONResponse{OperationRejectedJSONResponse: idempotencyConflict()}
	default:
		return SetStorageObjectVisibility500JSONResponse{InternalErrorJSONResponse: InternalErrorJSONResponse{Message: message}}
	}
}

func confirmFailure(err error) ConfirmOperationResponseObject {
	status, message := classify(err)
	switch status {
	case http.StatusUnauthorized:
		return ConfirmOperation401JSONResponse{UnauthorizedJSONResponse: UnauthorizedJSONResponse{Message: message}}
	case http.StatusBadRequest:
		return ConfirmOperation400JSONResponse{BadRequestJSONResponse: BadRequestJSONResponse{Message: message}}
	case http.StatusConflict:
		return ConfirmOperation409JSONResponse{OperationRejectedJSONResponse: idempotencyConflict()}
	default:
		return ConfirmOperation500JSONResponse{InternalErrorJSONResponse: InternalErrorJSONResponse{Message: message}}
	}
}

// executeSetVisibility runs inside the worker's database transaction. The
// transaction ends as soon as the SQL function returns; a confirmation_required
// result is simply a completed job, so nothing waits on the user.
func (s *Server) executeSetVisibility(ctx context.Context, jobID string, raw json.RawMessage) (jobs.Outcome, error) {
	var payload setVisibilityPayload
	if err := decodeStrict(raw, &payload); err != nil || !hasExactKeys(raw, "targetId", "expectedRevision", "public") ||
		uuid.Validate(payload.TargetID) != nil || !validRevision(payload.ExpectedRevision) {
		return outcomeError(errBadRequest), nil
	}
	token, _, err := s.caller(ctx)
	if err != nil {
		return outcomeError(err), nil
	}
	name := "make_d_storage_object_private"
	if payload.Public {
		name = "begin_d_storage_make_public"
	}
	result, err := s.DB.RPC(ctx, token, name, map[string]any{
		"p_storage_object_id": payload.TargetID,
		"p_expected_revision": payload.ExpectedRevision,
		"p_request_id":        jobID,
	})
	if err != nil {
		return outcomeError(err), nil
	}
	return operationOutcome(result)
}

func (s *Server) executeConfirm(ctx context.Context, jobID string, raw json.RawMessage) (jobs.Outcome, error) {
	var payload confirmPayload
	if err := decodeStrict(raw, &payload); err != nil ||
		!hasExactKeys(raw, "operationKind", "targetType", "targetId", "expectedRevision", "challengeId", "proof") ||
		payload.OperationKind != string(StorageVisibilityMakePublic) || payload.TargetType != string(StorageObject) ||
		uuid.Validate(payload.TargetID) != nil || uuid.Validate(payload.ChallengeID) != nil ||
		!validRevision(payload.ExpectedRevision) || !proofPattern.MatchString(payload.Proof) {
		return outcomeError(errBadRequest), nil
	}
	token, _, err := s.caller(ctx)
	if err != nil {
		return outcomeError(err), nil
	}
	result, err := s.DB.RPC(ctx, token, "confirm_app_operation", map[string]any{
		"p_challenge_id":      payload.ChallengeID,
		"p_operation_kind":    payload.OperationKind,
		"p_target_type":       payload.TargetType,
		"p_target_id":         payload.TargetID,
		"p_expected_revision": payload.ExpectedRevision,
		"p_proof":             payload.Proof,
		"p_request_id":        jobID,
	})
	if err != nil {
		return outcomeError(err), nil
	}
	return operationOutcome(result)
}

// operationOutcome forwards only a result that matches the contract exactly. A
// malformed database result becomes a 500 and is never shown to the browser.
func operationOutcome(raw json.RawMessage) (jobs.Outcome, error) {
	result, err := decodeOperationResult(raw)
	if err != nil {
		// The message deliberately omits the payload: it can hold a challenge proof.
		return outcomeError(fmt.Errorf("invalid operation result: %w", errMalformedResult)), nil
	}
	return outcomeJSON(http.StatusOK, result)
}

var errMalformedResult = errors.New("malformed result")

// decodeOperationResult decodes one ConfirmableOperationResult branch with the
// exact field set and values the contract allows.
func decodeOperationResult(raw json.RawMessage) (any, error) {
	var head struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return nil, errMalformedResult
	}
	switch head.Kind {
	case string(ConfirmationRequired):
		var v ConfirmationRequiredResult
		if err := decodeStrict(raw, &v); err != nil ||
			!hasExactKeys(raw, "kind", "operationKind", "target", "expectedRevision", "challengeId", "proof", "expiresAt") ||
			!hasExactKeys(nestedObject(raw, "target"), "type", "id") || v.Kind != ConfirmationRequired ||
			v.OperationKind != StorageVisibilityMakePublic || !validTarget(v.Target) || !validRevision(v.ExpectedRevision) ||
			v.ChallengeId == uuid.Nil || !proofPattern.MatchString(v.Proof) || v.ExpiresAt.IsZero() {
			return nil, errMalformedResult
		}
		return v, nil
	case string(VisibilityChanged):
		var v VisibilityChangedResult
		if err := decodeStrict(raw, &v); err != nil ||
			!hasExactKeys(raw, "kind", "target", "visibility", "revision") || !hasExactKeys(nestedObject(raw, "target"), "type", "id") || v.Kind != VisibilityChanged || !validTarget(v.Target) ||
			!validRevision(v.Revision) || (v.Visibility != VisibilityPublic && v.Visibility != VisibilityPrivate) {
			return nil, errMalformedResult
		}
		return v, nil
	case string(Rejected):
		var v OperationRejectedResult
		if err := decodeStrict(raw, &v); err != nil || !hasExactKeys(raw, "kind", "reason") || v.Kind != Rejected || !knownRejection(v.Reason) {
			return nil, errMalformedResult
		}
		return v, nil
	default:
		return nil, errMalformedResult
	}
}

func knownRejection(reason RejectionReason) bool {
	switch reason {
	case RejectionReasonForbidden, RejectionReasonStaleRevision, RejectionReasonInvalidChallenge,
		RejectionReasonExpiredChallenge, RejectionReasonConsumedChallenge, RejectionReasonSupersededChallenge,
		RejectionReasonIdempotencyConflict:
		return true
	default:
		return false
	}
}

// hasExactKeys reports whether a JSON object has exactly the given top-level
// keys. decodeStrict alone cannot see a missing key: it would leave the field at
// its zero value, and a missing "public" would silently mean "make private".
func hasExactKeys(raw []byte, keys ...string) bool {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || len(fields) != len(keys) {
		return false
	}
	for _, key := range keys {
		if _, ok := fields[key]; !ok {
			return false
		}
	}
	return true
}

// nestedObject returns the raw JSON of a top-level object field, or nil.
func nestedObject(raw []byte, name string) []byte {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil
	}
	return fields[name]
}

// decodeStrict rejects unknown fields (at every depth) and trailing data.
func decodeStrict(raw []byte, into any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(into); err != nil {
		return err
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		return errors.New("trailing data")
	}
	return nil
}
