package api

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gregidonut/sqldev/packages/functions/internal/jobs"
	"github.com/gregidonut/sqldev/packages/functions/internal/queue"
	"github.com/gregidonut/sqldev/packages/functions/internal/status"
)

const (
	vizObject    = "5b1f7f0e-0c4a-4f7e-9a63-2f4f6a1d9b11"
	vizChallenge = "0d7e1c52-8b0e-4a53-b3a4-1c9d2a6f7e90"
	vizProof     = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCde"
	vizJobID     = "11111111-1111-4111-8111-111111111111"
)

func visibilityBody(visibility string, revision int) string {
	return `{"target":{"type":"storage_object","id":"` + vizObject + `"},"expectedRevision":` +
		itoa(revision) + `,"visibility":"` + visibility + `"}`
}

func confirmBody(revision int) string {
	return `{"operationKind":"storage.visibility.make_public","target":{"type":"storage_object","id":"` + vizObject +
		`"},"expectedRevision":` + itoa(revision) + `,"challengeId":"` + vizChallenge + `","proof":"` + vizProof + `"}`
}

func itoa(n int) string {
	raw, _ := json.Marshal(n)
	return string(raw)
}

// requestWithKey sends a raw body with an explicit Idempotency-Key.
func requestWithKey(t *testing.T, server *Server, path, token, key, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	if key != "" {
		request.Header.Set("Idempotency-Key", key)
	}
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	NewHandler(server).ServeHTTP(response, request)
	return response
}

const visibilityPathFor = "/api/storage/buckets/" + testBucket + "/objects/visibility"

func TestVisibilityRequestQueuesOneFingerprintedJob(t *testing.T) {
	messages := queue.NewMemory()
	server := testServer(t, &fakeDB{}, &fakeObjects{}, messages)
	response := requestWithKey(t, server, visibilityPathFor, testJWT, "key-1", visibilityBody("public", 3))
	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d body %s", response.Code, response.Body.String())
	}
	if len(messages.Sent()) != 1 {
		t.Fatalf("sent = %d, want exactly one", len(messages.Sent()))
	}
	envelope, err := jobs.Parse(messages.Sent()[0])
	if err != nil {
		t.Fatal(err)
	}
	if envelope.Kind != jobs.KindSetStorageVisibility || envelope.Fingerprint == "" {
		t.Fatalf("envelope = %+v", envelope)
	}
	var payload setVisibilityPayload
	if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if payload != (setVisibilityPayload{TargetID: vizObject, ExpectedRevision: 3, Public: true}) {
		t.Fatalf("payload = %+v", payload)
	}
	var receipt JobReceipt
	if err := json.Unmarshal(response.Body.Bytes(), &receipt); err != nil || receipt.JobId.String() != envelope.JobID {
		t.Fatalf("receipt = %s (%v)", response.Body.String(), err)
	}
}

func TestVisibilityReplayWithTheSameBodyReusesTheJob(t *testing.T) {
	messages := queue.NewMemory()
	server := testServer(t, &fakeDB{}, &fakeObjects{}, messages)
	first := requestWithKey(t, server, visibilityPathFor, testJWT, "key-1", visibilityBody("public", 3))
	second := requestWithKey(t, server, visibilityPathFor, testJWT, "key-1", visibilityBody("public", 3))
	if first.Code != http.StatusAccepted || second.Code != http.StatusAccepted {
		t.Fatalf("statuses = %d %d", first.Code, second.Code)
	}
	if first.Body.String() != second.Body.String() {
		t.Fatalf("receipts differ: %s vs %s", first.Body.String(), second.Body.String())
	}
}

func TestReusingAKeyWithADifferentBodyIsRejectedBeforeTheQueue(t *testing.T) {
	changes := map[string]string{
		"another revision":   visibilityBody("public", 4),
		"another visibility": visibilityBody("private", 3),
		"another target":     strings.Replace(visibilityBody("public", 3), vizObject, "6c2f8f1f-1d5b-4a8f-8b74-3a5f7b2e0c22", 1),
	}
	for name, body := range changes {
		t.Run(name, func(t *testing.T) {
			messages := queue.NewMemory()
			server := testServer(t, &fakeDB{}, &fakeObjects{}, messages)
			if first := requestWithKey(t, server, visibilityPathFor, testJWT, "key-1", visibilityBody("public", 3)); first.Code != http.StatusAccepted {
				t.Fatalf("first = %d", first.Code)
			}
			sentBefore := len(messages.Sent())
			response := requestWithKey(t, server, visibilityPathFor, testJWT, "key-1", body)
			if response.Code != http.StatusConflict {
				t.Fatalf("status = %d body %s", response.Code, response.Body.String())
			}
			var rejected OperationRejectedResult
			if err := json.Unmarshal(response.Body.Bytes(), &rejected); err != nil ||
				rejected.Kind != Rejected || rejected.Reason != RejectionReasonIdempotencyConflict {
				t.Fatalf("body = %s (%v)", response.Body.String(), err)
			}
			if len(messages.Sent()) != sentBefore {
				t.Fatalf("a conflicting request was queued (%d -> %d)", sentBefore, len(messages.Sent()))
			}
		})
	}
}

func TestConfirmationRequestIsASeparateFingerprintedJob(t *testing.T) {
	messages := queue.NewMemory()
	server := testServer(t, &fakeDB{}, &fakeObjects{}, messages)
	first := requestWithKey(t, server, visibilityPathFor, testJWT, "initiate-key", visibilityBody("public", 1))
	second := requestWithKey(t, server, "/api/confirmations", testJWT, "confirm-key", confirmBody(1))
	if first.Code != http.StatusAccepted || second.Code != http.StatusAccepted {
		t.Fatalf("statuses = %d %d (%s)", first.Code, second.Code, second.Body.String())
	}
	if first.Body.String() == second.Body.String() {
		t.Fatal("initiation and confirmation must be distinct jobs")
	}
	envelope, err := jobs.Parse(messages.Sent()[1])
	if err != nil || envelope.Kind != jobs.KindConfirmOperation || envelope.Fingerprint == "" {
		t.Fatalf("envelope = %+v (%v)", envelope, err)
	}
	// A different proof under the same key is a different request.
	other := strings.Replace(confirmBody(1), vizProof, "ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210-_ZyXwV", 1)
	conflict := requestWithKey(t, server, "/api/confirmations", testJWT, "confirm-key", other)
	if conflict.Code != http.StatusConflict {
		t.Fatalf("status = %d", conflict.Code)
	}
}

func TestVisibilityAuthAndBucketChecks(t *testing.T) {
	messages := queue.NewMemory()
	server := testServer(t, &fakeDB{}, &fakeObjects{}, messages)
	if r := requestWithKey(t, server, visibilityPathFor, "", "k", visibilityBody("public", 1)); r.Code != http.StatusUnauthorized {
		t.Fatalf("no bearer: status = %d", r.Code)
	}
	if r := requestWithKey(t, server, "/api/confirmations", "", "k", confirmBody(1)); r.Code != http.StatusUnauthorized {
		t.Fatalf("no bearer on confirm: status = %d", r.Code)
	}
	if r := requestWithKey(t, server, "/api/storage/buckets/other/objects/visibility", testJWT, "k", visibilityBody("public", 1)); r.Code != http.StatusForbidden {
		t.Fatalf("wrong bucket: status = %d", r.Code)
	}
	if r := requestWithKey(t, server, visibilityPathFor, testJWT, "", visibilityBody("public", 1)); r.Code != http.StatusBadRequest {
		t.Fatalf("missing idempotency key: status = %d", r.Code)
	}
	if len(messages.Sent()) != 0 {
		t.Fatalf("queued = %d, want 0", len(messages.Sent()))
	}
}

func executeEnvelope(kind, payload string) jobs.Envelope {
	return jobs.Envelope{
		Version: jobs.Version,
		JobID:   vizJobID,
		Kind:    kind,
		Claims:  jobs.Claims{Subject: "user_test", Role: "authenticated"},
		Payload: json.RawMessage(payload),
	}
}

const (
	setPublicPayload  = `{"targetId":"` + vizObject + `","expectedRevision":3,"public":true}`
	setPrivatePayload = `{"targetId":"` + vizObject + `","expectedRevision":3,"public":false}`
	confirmJobPayload = `{"operationKind":"storage.visibility.make_public","targetType":"storage_object","targetId":"` + vizObject +
		`","expectedRevision":3,"challengeId":"` + vizChallenge + `","proof":"` + vizProof + `"}`

	requiredResult = `{"kind":"confirmation_required","operationKind":"storage.visibility.make_public","target":{"type":"storage_object","id":"` +
		vizObject + `"},"expectedRevision":3,"challengeId":"` + vizChallenge + `","proof":"` + vizProof + `","expiresAt":"2026-10-14T15:50:20.944454Z"}`
	changedResult  = `{"kind":"visibility_changed","target":{"type":"storage_object","id":"` + vizObject + `"},"visibility":"public","revision":4}`
	rejectedResult = `{"kind":"rejected","reason":"stale_revision"}`
)

func TestExecuteBeginCallsOnlyTheInitiationFunction(t *testing.T) {
	db := &fakeDB{rpcByName: map[string]json.RawMessage{"begin_d_storage_make_public": json.RawMessage(requiredResult)}}
	server := testServer(t, db, &fakeObjects{}, queue.NewMemory())
	outcome, err := server.Execute(jobContext(), executeEnvelope(jobs.KindSetStorageVisibility, setPublicPayload))
	if err != nil || outcome.HTTPStatus != http.StatusOK {
		t.Fatalf("outcome = %+v err %v", outcome, err)
	}
	if !contains(db.rpcs, "begin_d_storage_make_public") || contains(db.rpcs, "confirm_app_operation") || contains(db.rpcs, "make_d_storage_object_private") {
		t.Fatalf("rpcs = %v", db.rpcs)
	}
	if db.lastArgs["p_storage_object_id"] != vizObject || db.lastArgs["p_expected_revision"] != int64(3) || db.lastArgs["p_request_id"] != vizJobID {
		t.Fatalf("args = %#v", db.lastArgs)
	}
	var result ConfirmationRequiredResult
	if err := json.Unmarshal(outcome.Body, &result); err != nil || result.Kind != ConfirmationRequired {
		t.Fatalf("body = %s (%v)", outcome.Body, err)
	}
}

func TestExecutePrivateCallsOnlyThePrivateFunction(t *testing.T) {
	db := &fakeDB{rpcByName: map[string]json.RawMessage{"make_d_storage_object_private": json.RawMessage(strings.Replace(changedResult, "public", "private", 1))}}
	server := testServer(t, db, &fakeObjects{}, queue.NewMemory())
	outcome, err := server.Execute(jobContext(), executeEnvelope(jobs.KindSetStorageVisibility, setPrivatePayload))
	if err != nil || outcome.HTTPStatus != http.StatusOK {
		t.Fatalf("outcome = %+v err %v", outcome, err)
	}
	if !contains(db.rpcs, "make_d_storage_object_private") || contains(db.rpcs, "begin_d_storage_make_public") {
		t.Fatalf("rpcs = %v", db.rpcs)
	}
}

func TestExecuteConfirmPassesTheChallengeAndTheJobID(t *testing.T) {
	db := &fakeDB{rpcByName: map[string]json.RawMessage{"confirm_app_operation": json.RawMessage(changedResult)}}
	server := testServer(t, db, &fakeObjects{}, queue.NewMemory())
	outcome, err := server.Execute(jobContext(), executeEnvelope(jobs.KindConfirmOperation, confirmJobPayload))
	if err != nil || outcome.HTTPStatus != http.StatusOK {
		t.Fatalf("outcome = %+v err %v", outcome, err)
	}
	want := map[string]any{
		"p_challenge_id": vizChallenge, "p_operation_kind": "storage.visibility.make_public", "p_target_type": "storage_object",
		"p_target_id": vizObject, "p_expected_revision": int64(3), "p_proof": vizProof, "p_request_id": vizJobID,
	}
	for key, value := range want {
		if db.lastArgs[key] != value {
			t.Errorf("%s = %#v, want %#v", key, db.lastArgs[key], value)
		}
	}
}

func TestADomainRejectionIsACompletedJobWhoseBodySurvives(t *testing.T) {
	db := &fakeDB{rpcByName: map[string]json.RawMessage{"confirm_app_operation": json.RawMessage(rejectedResult)}}
	messages := queue.NewMemory()
	server := testServer(t, db, &fakeObjects{}, messages)

	submitted := requestWithKey(t, server, "/api/confirmations", testJWT, "k", confirmBody(3))
	var receipt JobReceipt
	if err := json.Unmarshal(submitted.Body.Bytes(), &receipt); err != nil {
		t.Fatal(err)
	}
	envelope, err := jobs.Parse(messages.Sent()[0])
	if err != nil {
		t.Fatal(err)
	}
	outcome, err := server.Execute(jobContext(), envelope)
	if err != nil {
		t.Fatal(err)
	}
	if outcome.HTTPStatus != http.StatusOK {
		t.Fatalf("a rejection must be HTTP 200 so Finish keeps the body, got %d", outcome.HTTPStatus)
	}
	if err := server.Finish(jobContext(), envelope, outcome); err != nil {
		t.Fatal(err)
	}
	polled := requestJSON(t, server, http.MethodGet, "/api/jobs/"+receipt.JobId.String(), testJWT, nil)
	var state JobState
	if err := json.Unmarshal(polled.Body.Bytes(), &state); err != nil {
		t.Fatal(err)
	}
	result, _ := json.Marshal(state.Result)
	if state.Status != JobStateStatusCompleted || string(result) != rejectedResult {
		t.Fatalf("state = %s, want completed with %s", polled.Body.String(), rejectedResult)
	}
}

func TestAMalformedDatabaseResultFailsClosed(t *testing.T) {
	bad := []string{
		`{"kind":"visibility_changed"}`,
		`{"kind":"rejected","reason":"teapot"}`,
		`{"kind":"rejected","reason":"forbidden","proof":"` + vizProof + `"}`,
		`{"kind":"mystery"}`,
		`not json`,
		`null`,
		strings.Replace(requiredResult, vizProof, "short", 1),
	}
	for _, body := range bad {
		db := &fakeDB{rpcBody: json.RawMessage(body)}
		server := testServer(t, db, &fakeObjects{}, queue.NewMemory())
		outcome, err := server.Execute(jobContext(), executeEnvelope(jobs.KindSetStorageVisibility, setPublicPayload))
		if err != nil {
			t.Fatal(err)
		}
		if outcome.HTTPStatus != http.StatusInternalServerError || len(outcome.Body) != 0 || outcome.Message != "internal error" {
			t.Errorf("body %q: outcome = %+v", body, outcome)
		}
	}
}

func TestInvalidJobPayloadsAreRejectedWithoutCallingTheDatabase(t *testing.T) {
	payloads := map[string][]string{
		jobs.KindSetStorageVisibility: {
			`{"targetId":"` + vizObject + `","expectedRevision":3}`,
			`{"targetId":"nope","expectedRevision":3,"public":true}`,
			`{"targetId":"` + vizObject + `","expectedRevision":0,"public":true}`,
			`{"targetId":"` + vizObject + `","expectedRevision":3,"public":true,"extra":1}`,
			`[]`,
		},
		jobs.KindConfirmOperation: {
			strings.Replace(confirmJobPayload, "storage.visibility.make_public", "storage.visibility.destroy", 1),
			strings.Replace(confirmJobPayload, vizProof, "short", 1),
			strings.Replace(confirmJobPayload, `"storage_object"`, `"ig_post"`, 1),
			strings.Replace(confirmJobPayload, vizChallenge, "nope", 1),
			`{}`,
		},
	}
	for kind, list := range payloads {
		for _, payload := range list {
			db := &fakeDB{}
			server := testServer(t, db, &fakeObjects{}, queue.NewMemory())
			outcome, err := server.Execute(jobContext(), executeEnvelope(kind, payload))
			if err != nil || outcome.HTTPStatus != http.StatusBadRequest {
				t.Errorf("%s %q: outcome = %+v err %v", kind, payload, outcome, err)
			}
			if len(db.rpcs) != 0 {
				t.Errorf("%s %q: database was called: %v", kind, payload, db.rpcs)
			}
		}
	}
}

func TestTheProofNeverReachesLogsOrJobMetadata(t *testing.T) {
	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(previous) })

	// Both a failing database call and a rejection are exercised.
	for _, db := range []*fakeDB{
		{rpcByName: map[string]json.RawMessage{"confirm_app_operation": json.RawMessage(rejectedResult)}},
		{rpcErr: http.ErrAbortHandler},
	} {
		messages := queue.NewMemory()
		server := testServer(t, db, &fakeObjects{}, messages)
		response := requestWithKey(t, server, "/api/confirmations", testJWT, "k", confirmBody(3))
		if response.Code != http.StatusAccepted {
			t.Fatalf("status = %d", response.Code)
		}
		envelope, _ := jobs.Parse(messages.Sent()[0])
		outcome, err := server.Execute(jobContext(), envelope)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(outcome.Message, vizProof) {
			t.Fatalf("outcome message leaks the proof: %q", outcome.Message)
		}
		if err := server.Finish(jobContext(), envelope, outcome); err != nil {
			t.Fatal(err)
		}
		record, err := server.Jobs.Get(jobContext(), envelope.JobID)
		if err != nil {
			t.Fatal(err)
		}
		metadata := record.Kind + record.Status + record.Message + record.Fingerprint + record.ResultKey + record.ContentType + record.Owner
		if strings.Contains(metadata, vizProof) {
			t.Fatalf("job metadata leaks the proof: %+v", record)
		}
	}
	if strings.Contains(logs.String(), vizProof) {
		t.Fatalf("logs leak the proof:\n%s", logs.String())
	}
}

func TestFingerprintDoesNotSurviveAsPartOfAnyUpdate(t *testing.T) {
	store := status.NewMemory()
	record := status.Record{JobID: vizJobID, Owner: "u", Kind: jobs.KindConfirmOperation, Status: status.Pending, Fingerprint: "fp"}
	if err := store.Create(jobContext(), record); err != nil {
		t.Fatal(err)
	}
	if err := store.Update(jobContext(), status.Record{JobID: vizJobID, Owner: "u", Kind: jobs.KindConfirmOperation, Status: status.Running}); err != nil {
		t.Fatal(err)
	}
	got, _ := store.Get(jobContext(), vizJobID)
	if got.Fingerprint != "fp" {
		t.Fatalf("fingerprint = %q after an update, want it unchanged", got.Fingerprint)
	}
}
