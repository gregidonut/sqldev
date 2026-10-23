package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/gregidonut/sqldev/packages/functions/internal/imagor"
	"github.com/gregidonut/sqldev/packages/functions/internal/jobs"
	"github.com/gregidonut/sqldev/packages/functions/internal/queue"
	"github.com/gregidonut/sqldev/packages/functions/internal/status"
)

const referenceObject = "22222222-2222-4222-8222-222222222222"
const referenceRevision = "33333333-3333-4333-8333-333333333333"

func TestResolveStorageReferenceHidesTheSourceKey(t *testing.T) {
	db := &fakeDB{rpcByName: map[string]json.RawMessage{
		"resolve_d_storage_reference": json.RawMessage(`{"kind":"ready","fileName":"clip.mp4","revisionId":"` + referenceRevision + `","sourceKey":"` + imageKey + `"}`),
	}}
	server := testServer(t, db, &fakeObjects{}, nil)
	outcome, err := server.Execute(jobContext(), jobs.Envelope{
		Version: jobs.Version,
		JobID:   "44444444-4444-4444-8444-444444444444",
		Kind:    jobs.KindResolveStorageReference,
		Claims:  jobs.Claims{Subject: "user_test", Role: "authenticated"},
		Payload: json.RawMessage(`{"storageObjectId":"` + referenceObject + `"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if outcome.HTTPStatus != http.StatusOK {
		t.Fatalf("status = %d", outcome.HTTPStatus)
	}
	body := string(outcome.Body)
	if strings.Contains(body, "sourceKey") || strings.Contains(body, imageKey) {
		t.Fatalf("body leaked the key: %s", body)
	}
	var visible publicStorageReference
	if err := json.Unmarshal(outcome.Body, &visible); err != nil {
		t.Fatal(err)
	}
	if visible.Kind != "ready" || visible.FileName != "clip.mp4" || visible.RevisionID != referenceRevision {
		t.Fatalf("visible = %+v", visible)
	}
}

func TestResolveStorageReferenceCollapsesDeniedObjects(t *testing.T) {
	server := testServer(t, &fakeDB{rpcByName: map[string]json.RawMessage{
		"resolve_d_storage_reference": json.RawMessage(`{"kind":"unavailable"}`),
	}}, &fakeObjects{}, nil)
	outcome, err := server.Execute(jobContext(), jobs.Envelope{
		Version: jobs.Version,
		JobID:   "44444444-4444-4444-8444-444444444444",
		Kind:    jobs.KindResolveStorageReference,
		Claims:  jobs.Claims{Subject: "user_test", Role: "authenticated"},
		Payload: json.RawMessage(`{"storageObjectId":"` + referenceObject + `"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if string(outcome.Body) != `{"kind":"unavailable"}` {
		t.Fatalf("body = %s", outcome.Body)
	}
}

func TestResolveStorageReferenceHidesUnsupportedFiles(t *testing.T) {
	visible := visibleStorageReference(storageReference{
		Kind: "ready", FileName: "notes.txt", RevisionID: referenceRevision, SourceKey: imageKey,
	})
	if visible.Kind != "unavailable" || visible.FileName != "" || visible.RevisionID != "" {
		t.Fatalf("visible = %+v", visible)
	}
}

func TestPreviewStorageReferenceDoesNotQueueAKey(t *testing.T) {
	messages := queue.NewMemory()
	server := testServer(t, &fakeDB{}, &fakeObjects{}, messages)
	response := requestWithKey(t, server, "/api/storage/references/preview", testJWT, "preview-key", `{
		"storageObjectId":"`+referenceObject+`",
		"revisionId":"`+referenceRevision+`",
		"width":512,
		"height":320,
		"fit":"cover",
		"format":"webp",
		"quality":80,
		"preview":"animation"
	}`)
	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d body %s", response.Code, response.Body.String())
	}
	envelope, err := jobs.Parse(messages.Sent()[0])
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(envelope.Payload), imageKey) || strings.Contains(string(envelope.Payload), "sourceKey") {
		t.Fatalf("payload = %s", envelope.Payload)
	}
	var payload imagor.Request
	if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.StorageObjectID != referenceObject || payload.RevisionID != referenceRevision || payload.SourceKey != "" {
		t.Fatalf("payload = %+v", payload)
	}
}

func TestObjectPreviewRejectsAStaleRevisionWithoutRendering(t *testing.T) {
	db := &fakeDB{rpcByName: map[string]json.RawMessage{
		"resolve_d_storage_reference": json.RawMessage(`{"kind":"ready","fileName":"clip.mp4","revisionId":"99999999-9999-4999-8999-999999999999","sourceKey":"` + imageKey + `"}`),
	}}
	images := &fakeImages{}
	server := imageServer(t, db, &fakeObjects{exists: true}, images)
	outcome, err := server.Execute(jobContext(), jobs.Envelope{
		Version: jobs.Version,
		JobID:   "44444444-4444-4444-8444-444444444444",
		Kind:    jobs.KindImagor,
		Claims:  jobs.Claims{Subject: "user_test", Role: "authenticated"},
		Payload: json.RawMessage(`{"storageObjectId":"` + referenceObject + `","revisionId":"` + referenceRevision + `","width":512,"height":320,"fit":"cover","format":"webp","quality":80,"preview":"video"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if outcome.HTTPStatus != http.StatusConflict || images.calls != 0 {
		t.Fatalf("status = %d calls = %d", outcome.HTTPStatus, images.calls)
	}
}

func TestGetJobRefusesAPreviewAfterAccessIsRemoved(t *testing.T) {
	db := &fakeDB{rpcByName: map[string]json.RawMessage{
		"resolve_d_storage_reference": json.RawMessage(`{"kind":"unavailable"}`),
	}}
	server := imageServer(t, db, &fakeObjects{}, nil)
	const jobID = "55555555-5555-4555-8555-555555555555"
	if err := server.Jobs.Create(jobContext(), status.Record{
		JobID:           jobID,
		Owner:           "user_test",
		Kind:            jobs.KindImagor,
		Status:          status.Completed,
		HTTPStatus:      http.StatusOK,
		ResultKey:       "images/user_test/" + jobID,
		ContentType:     "image/webp",
		Body:            []byte(`{"url":"https://example.test/expired","contentType":"image/webp"}`),
		StorageObjectID: referenceObject,
		RevisionID:      referenceRevision,
	}); err != nil {
		t.Fatal(err)
	}
	if err := server.Results.(*memoryResults).PutObject(jobContext(), "images/user_test/"+jobID, "image/webp", []byte("webp")); err != nil {
		t.Fatal(err)
	}
	response := requestJSON(t, server, http.MethodGet, "/api/jobs/"+jobID, testJWT, nil)
	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d body %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), imageKey) || strings.Contains(response.Body.String(), "example.test") || strings.Contains(response.Body.String(), "expired") {
		t.Fatalf("body = %s", response.Body.String())
	}
}

func TestGetJobSignsAFreshPreviewURL(t *testing.T) {
	server := imageServer(t, &fakeDB{}, &fakeObjects{}, nil)
	server.DB = nil
	const jobID = "66666666-6666-4666-8666-666666666666"
	key := "images/user_test/" + jobID
	if err := server.Jobs.Create(jobContext(), status.Record{
		JobID:           jobID,
		Owner:           "user_test",
		Kind:            jobs.KindImagor,
		Status:          status.Completed,
		HTTPStatus:      http.StatusOK,
		ResultKey:       key,
		ContentType:     "image/webp",
		Body:            []byte(`{"url":"https://example.test/expired","contentType":"image/webp"}`),
		StorageObjectID: referenceObject,
		RevisionID:      referenceRevision,
	}); err != nil {
		t.Fatal(err)
	}
	if err := server.Results.(*memoryResults).PutObject(jobContext(), key, "image/webp", []byte("webp")); err != nil {
		t.Fatal(err)
	}
	response := requestJSON(t, server, http.MethodGet, "/api/jobs/"+jobID, testJWT, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d body %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "https://example.test/expired") {
		t.Fatalf("body replayed the stored signature: %s", response.Body.String())
	}
	var state JobState
	if err := json.Unmarshal(response.Body.Bytes(), &state); err != nil {
		t.Fatal(err)
	}
	result, ok := state.Result.(map[string]any)
	want := "https://example.test/" + key + "?expires=5m0s"
	if !ok || result["url"] != want || result["contentType"] != "image/webp" {
		t.Fatalf("result = %#v", state.Result)
	}
}
