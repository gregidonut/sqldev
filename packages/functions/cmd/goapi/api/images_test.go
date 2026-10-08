package api

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/gregidonut/sqldev/packages/functions/internal/imagor"
	"github.com/gregidonut/sqldev/packages/functions/internal/jobs"
	"github.com/gregidonut/sqldev/packages/functions/internal/queue"
	"github.com/gregidonut/sqldev/packages/functions/internal/status"
)

const imageKey = testUser + "/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333/photo.jpg"

func TestTransformImageQueuesAnIdempotentJob(t *testing.T) {
	messages := queue.NewMemory()
	server := testServer(t, &fakeDB{}, &fakeObjects{}, messages)
	body := map[string]any{
		"sourceKey": imageKey,
		"width":     200,
		"height":    100,
		"fit":       "contain",
		"format":    "jpeg",
		"quality":   80,
	}
	first := requestJSON(t, server, http.MethodPost, "/api/images/transform", testJWT, body)
	second := requestJSON(t, server, http.MethodPost, "/api/images/transform", testJWT, body)
	if first.Code != http.StatusAccepted || second.Code != http.StatusAccepted {
		t.Fatalf("statuses = %d %d bodies %s %s", first.Code, second.Code, first.Body.String(), second.Body.String())
	}
	var left, right JobReceipt
	if err := json.Unmarshal(first.Body.Bytes(), &left); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(second.Body.Bytes(), &right); err != nil {
		t.Fatal(err)
	}
	if left.JobId != right.JobId || len(messages.Sent()) != 2 {
		t.Fatalf("jobs = %s %s sent %d", left.JobId, right.JobId, len(messages.Sent()))
	}
	envelope, err := jobs.Parse(messages.Sent()[0])
	if err != nil {
		t.Fatal(err)
	}
	if envelope.Kind != jobs.KindImagor {
		t.Fatalf("kind = %s", envelope.Kind)
	}
	var payload imagor.Request
	if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.SourceKey != imageKey || payload.Fit != imagor.FitContain || payload.Format != imagor.FormatJPEG {
		t.Fatalf("payload = %+v", payload)
	}
}

func TestTransformImageReopensFailedJob(t *testing.T) {
	messages := queue.NewMemory()
	server := testServer(t, &fakeDB{}, &fakeObjects{}, messages)
	body := map[string]any{
		"sourceKey": imageKey,
		"width":     200,
		"height":    100,
		"fit":       "contain",
		"format":    "jpeg",
		"quality":   80,
	}
	first := requestJSON(t, server, http.MethodPost, "/api/images/transform", testJWT, body)
	var receipt JobReceipt
	if err := json.Unmarshal(first.Body.Bytes(), &receipt); err != nil {
		t.Fatal(err)
	}
	failed, err := server.Jobs.Get(context.Background(), receipt.JobId.String())
	if err != nil {
		t.Fatal(err)
	}
	failed.Status = status.Failed
	failed.HTTPStatus = http.StatusNotImplemented
	failed.Message = "imagor is not configured"
	if err := server.Jobs.Update(context.Background(), failed); err != nil {
		t.Fatal(err)
	}
	second := requestJSON(t, server, http.MethodPost, "/api/images/transform", testJWT, body)
	if second.Code != http.StatusAccepted {
		t.Fatalf("status = %d body %s", second.Code, second.Body.String())
	}
	reopened, err := server.Jobs.Get(context.Background(), receipt.JobId.String())
	if err != nil {
		t.Fatal(err)
	}
	if reopened.Status != status.Pending || reopened.Attempt != 2 || reopened.Message != "" {
		t.Fatalf("reopened = %+v", reopened)
	}
}

func TestTransformImageRejectsUnsafeOptions(t *testing.T) {
	messages := queue.NewMemory()
	server := testServer(t, &fakeDB{}, &fakeObjects{}, messages)
	response := requestJSON(t, server, http.MethodPost, "/api/images/transform", testJWT, map[string]any{
		"sourceKey": "https://evil.test/a.jpg",
		"width":     5000,
		"height":    10,
		"fit":       "stretch",
		"format":    "gif",
		"quality":   80,
	})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body %s", response.Code, response.Body.String())
	}
	if len(messages.Sent()) != 0 {
		t.Fatalf("queued = %d", len(messages.Sent()))
	}
}

func TestExecuteImagorAuthorizesBeforeRendering(t *testing.T) {
	db := &fakeDB{rpcByName: map[string]json.RawMessage{
		"get_d_storage_object_by_key": json.RawMessage(`[{"storage_object_id":"22222222-2222-2222-2222-222222222222","public":false}]`),
		"authorize_d_storage_object":  json.RawMessage(`true`),
	}}
	images := &fakeImages{image: imagor.Image{ContentType: "image/jpeg", Body: []byte("jpeg-bytes")}}
	server := imageServer(t, db, &fakeObjects{exists: true}, images)
	envelope := imageEnvelope()
	if err := server.Jobs.Create(context.Background(), status.Record{
		JobID:  envelope.JobID,
		Owner:  "user_test",
		Kind:   jobs.KindImagor,
		Status: status.Pending,
	}); err != nil {
		t.Fatal(err)
	}
	outcome, err := server.Execute(jobContext(), envelope)
	if err != nil {
		t.Fatal(err)
	}
	if outcome.HTTPStatus != http.StatusOK || outcome.Artifact == nil || outcome.Artifact.ContentType != "image/jpeg" {
		t.Fatalf("outcome = %+v", outcome)
	}
	if images.got.SourceKey != imageKey || !contains(db.rpcs, "authorize_d_storage_object") {
		t.Fatalf("request = %+v rpcs = %#v", images.got, db.rpcs)
	}
	if err := server.Finish(context.Background(), envelope, outcome); err != nil {
		t.Fatal(err)
	}
	response := requestJSON(t, server, http.MethodGet, "/api/jobs/"+envelope.JobID, testJWT, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d body %s", response.Code, response.Body.String())
	}
	var state JobState
	if err := json.Unmarshal(response.Body.Bytes(), &state); err != nil {
		t.Fatal(err)
	}
	result, ok := state.Result.(map[string]any)
	if !ok || result["contentType"] != "image/jpeg" || result["url"] == "" {
		t.Fatalf("result = %#v", state.Result)
	}
	server.Identity = rejectIdentity{}
	denied := requestJSON(t, server, http.MethodGet, "/api/jobs/"+envelope.JobID, "other-token", nil)
	if denied.Code != http.StatusNotFound {
		t.Fatalf("other owner status = %d", denied.Code)
	}
}

func TestExecuteImagorDoesNotRenderWithoutPermission(t *testing.T) {
	tests := []struct {
		name   string
		db     *fakeDB
		exists bool
		want   int
	}{
		{
			name:   "missing record",
			db:     &fakeDB{rpcByName: map[string]json.RawMessage{"get_d_storage_object_by_key": json.RawMessage(`[]`)}},
			exists: true,
			want:   http.StatusForbidden,
		},
		{
			name: "denied",
			db: &fakeDB{rpcByName: map[string]json.RawMessage{
				"get_d_storage_object_by_key": json.RawMessage(`[{"storage_object_id":"22222222-2222-2222-2222-222222222222","public":false}]`),
				"authorize_d_storage_object":  json.RawMessage(`false`),
			}},
			exists: true,
			want:   http.StatusForbidden,
		},
		{
			name: "missing object",
			db: &fakeDB{rpcByName: map[string]json.RawMessage{
				"get_d_storage_object_by_key": json.RawMessage(`[{"storage_object_id":"22222222-2222-2222-2222-222222222222","public":true}]`),
			}},
			want: http.StatusNotFound,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			images := &fakeImages{}
			server := imageServer(t, test.db, &fakeObjects{exists: test.exists}, images)
			outcome, err := server.Execute(jobContext(), imageEnvelope())
			if err != nil {
				t.Fatal(err)
			}
			if outcome.HTTPStatus != test.want {
				t.Fatalf("status = %d message %s", outcome.HTTPStatus, outcome.Message)
			}
			if images.calls != 0 {
				t.Fatalf("imagor calls = %d", images.calls)
			}
		})
	}
}

func TestExecuteImagorReportsUpstreamFailures(t *testing.T) {
	db := &fakeDB{rpcByName: map[string]json.RawMessage{
		"get_d_storage_object_by_key": json.RawMessage(`[{"storage_object_id":"22222222-2222-2222-2222-222222222222","public":true}]`),
	}}
	server := imageServer(t, db, &fakeObjects{exists: true}, &fakeImages{err: imagor.ErrUpstream})
	outcome, err := server.Execute(jobContext(), imageEnvelope())
	if err != nil {
		t.Fatal(err)
	}
	if outcome.HTTPStatus != http.StatusBadGateway {
		t.Fatalf("status = %d", outcome.HTTPStatus)
	}
	if contains(db.rpcs, "authorize_d_storage_object") {
		t.Fatal("public object required an extra permission check")
	}

	unconfigured := imageServer(t, db, &fakeObjects{exists: true}, nil)
	outcome, err = unconfigured.Execute(jobContext(), imageEnvelope())
	if err != nil {
		t.Fatal(err)
	}
	if outcome.HTTPStatus != http.StatusNotImplemented {
		t.Fatalf("status = %d", outcome.HTTPStatus)
	}
}

func imageServer(t *testing.T, db *fakeDB, objects *fakeObjects, images ImageRenderer) *Server {
	t.Helper()
	server := testServer(t, db, objects, queue.NewMemory())
	server.Images = images
	server.Results = &memoryResults{}
	return server
}

func imageEnvelope() jobs.Envelope {
	return jobs.Envelope{
		Version: jobs.Version,
		JobID:   "11111111-1111-4111-8111-111111111111",
		Kind:    jobs.KindImagor,
		Claims:  jobs.Claims{Subject: "user_test", Role: "authenticated"},
		Payload: json.RawMessage(`{"sourceKey":"` + imageKey + `","width":20,"height":10,"fit":"contain","format":"jpeg","quality":80}`),
	}
}

type fakeImages struct {
	image imagor.Image
	err   error
	got   imagor.Request
	calls int
}

func (f *fakeImages) Render(_ context.Context, request imagor.Request) (imagor.Image, error) {
	f.calls++
	f.got = request
	return f.image, f.err
}
