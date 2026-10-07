package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/clerkprofile"
	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/s3store"
	"github.com/gregidonut/sqldev/packages/functions/internal/jobs"
	"github.com/gregidonut/sqldev/packages/functions/internal/queue"
	"github.com/gregidonut/sqldev/packages/functions/internal/status"
)

const (
	testUser   = "11111111-1111-1111-1111-111111111111"
	testJWT    = "clerk-session-token"
	testBucket = "linked-bucket"
)

func TestListQueuesWorkWithoutTheRawToken(t *testing.T) {
	messages := queue.NewMemory()
	server := testServer(t, &fakeDB{}, &fakeObjects{}, messages)
	response := requestJSON(t, server, http.MethodGet, "/api/views/igPosts/list/get", testJWT, nil)
	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d body %s", response.Code, response.Body.String())
	}
	envelope, err := jobs.Parse(messages.Sent()[0])
	if err != nil {
		t.Fatal(err)
	}
	if envelope.Kind != jobs.KindListView || envelope.Claims.Subject != "user_test" {
		t.Fatalf("envelope = %+v", envelope)
	}
	if string(envelope.Payload) != `{"view":"igPosts"}` {
		t.Fatalf("payload = %s", envelope.Payload)
	}
}

func TestRepeatedIdempotencyKeyReusesTheJob(t *testing.T) {
	messages := queue.NewMemory()
	server := testServer(t, &fakeDB{}, &fakeObjects{}, messages)
	first := requestJSON(t, server, http.MethodPost, "/api/storage/buckets/"+testBucket+"/objects/presign?fileName=note.txt", testJWT, nil)
	second := requestJSON(t, server, http.MethodPost, "/api/storage/buckets/"+testBucket+"/objects/presign?fileName=note.txt", testJWT, nil)
	if first.Code != http.StatusAccepted || second.Code != http.StatusAccepted {
		t.Fatalf("statuses = %d %d", first.Code, second.Code)
	}
	var left, right JobReceipt
	if err := json.Unmarshal(first.Body.Bytes(), &left); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(second.Body.Bytes(), &right); err != nil {
		t.Fatal(err)
	}
	if left.JobId != right.JobId {
		t.Fatalf("jobs = %s %s", left.JobId, right.JobId)
	}
	if len(messages.Sent()) != 2 {
		t.Fatalf("sent = %d, want a safe resend", len(messages.Sent()))
	}
}

func TestJobStatusIsOwnerScoped(t *testing.T) {
	messages := queue.NewMemory()
	server := testServer(t, &fakeDB{}, &fakeObjects{}, messages)
	created := requestJSON(t, server, http.MethodGet, "/api/views/igPosts/list/get", testJWT, nil)
	var receipt JobReceipt
	if err := json.Unmarshal(created.Body.Bytes(), &receipt); err != nil {
		t.Fatal(err)
	}
	server.Identity = rejectIdentity{}
	response := requestJSON(t, server, http.MethodGet, "/api/jobs/"+receipt.JobId.String(), "other-token", nil)
	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d body %s", response.Code, response.Body.String())
	}
}

func TestMissingBearerIsUnauthorized(t *testing.T) {
	server := testServer(t, &fakeDB{}, &fakeObjects{}, queue.NewMemory())
	response := requestJSON(t, server, http.MethodGet, "/api/views/igPosts/list/get", "", nil)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.Code)
	}
}

func TestStorageWrongBucketDoesNotQueue(t *testing.T) {
	messages := queue.NewMemory()
	server := testServer(t, &fakeDB{}, &fakeObjects{}, messages)
	response := requestJSON(t, server, http.MethodGet, "/api/storage/buckets/other/objects?tab=mine", testJWT, nil)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", response.Code)
	}
	if len(messages.Sent()) != 0 {
		t.Fatalf("queued = %d", len(messages.Sent()))
	}
}

func TestExecuteFiltersEmptyStorageKeys(t *testing.T) {
	db := &fakeDB{rpcBody: json.RawMessage(`[
		{"storage_object_id":"22222222-2222-2222-2222-222222222222","s3_object_key":"11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333/note.txt","file_name":"note.txt","public":false},
		{"s3_object_key":""}
	]`)}
	server := testServer(t, db, &fakeObjects{bucketExists: true}, queue.NewMemory())
	outcome, err := server.Execute(jobContext(), jobs.Envelope{
		Version: jobs.Version,
		JobID:   "11111111-1111-4111-8111-111111111111",
		Kind:    jobs.KindListStorage,
		Claims:  jobs.Claims{Subject: "user_test", Role: "authenticated"},
		Payload: json.RawMessage(`{"bucket":"` + testBucket + `","tab":"mine"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if outcome.HTTPStatus != http.StatusOK {
		t.Fatalf("status = %d message %s", outcome.HTTPStatus, outcome.Message)
	}
	var rows []map[string]any
	if err := json.Unmarshal(outcome.Body, &rows); err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0]["file_name"] != "note.txt" {
		t.Fatalf("rows = %#v", rows)
	}
}

func TestExecuteForgedAbortDoesNotCallAbort(t *testing.T) {
	db := &fakeDB{}
	server := testServer(t, db, &fakeObjects{}, queue.NewMemory())
	outcome, err := server.Execute(jobContext(), jobs.Envelope{
		Version: jobs.Version,
		JobID:   "11111111-1111-4111-8111-111111111111",
		Kind:    jobs.KindAbort,
		Claims:  jobs.Claims{Subject: "user_test", Role: "authenticated"},
		Payload: json.RawMessage(`{"bucket":"` + testBucket + `","pending":{"storageObjectId":"22222222-2222-2222-2222-222222222222","storageObjectDataId":"33333333-3333-3333-3333-333333333333","fileName":"note.txt","isNewObject":true,"s3ObjectKey":"99999999-9999-9999-9999-999999999999/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333/note.txt"}}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if outcome.HTTPStatus != http.StatusForbidden {
		t.Fatalf("status = %d message %s", outcome.HTTPStatus, outcome.Message)
	}
	if contains(db.rpcs, "abort_d_storage_upload") {
		t.Fatalf("abort rpc was called: %#v", db.rpcs)
	}
}

func TestExecuteCommitMissingObjectAborts(t *testing.T) {
	db := &fakeDB{}
	server := testServer(t, db, &fakeObjects{exists: false}, queue.NewMemory())
	outcome, err := server.Execute(jobContext(), jobs.Envelope{
		Version: jobs.Version,
		JobID:   "11111111-1111-4111-8111-111111111111",
		Kind:    jobs.KindCommit,
		Claims:  jobs.Claims{Subject: "user_test", Role: "authenticated"},
		Payload: json.RawMessage(`{"bucket":"` + testBucket + `","pending":{"storageObjectId":"22222222-2222-2222-2222-222222222222","storageObjectDataId":"33333333-3333-3333-3333-333333333333","fileName":"note.txt","isNewObject":true,"s3ObjectKey":"` + testUser + `/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333/note.txt"}}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if outcome.HTTPStatus != http.StatusConflict {
		t.Fatalf("status = %d message %s", outcome.HTTPStatus, outcome.Message)
	}
	if contains(db.rpcs, "commit_d_storage_upload") || !contains(db.rpcs, "abort_d_storage_upload") {
		t.Fatalf("rpcs = %#v", db.rpcs)
	}
}

func TestImgproxyKindIsReserved(t *testing.T) {
	server := testServer(t, &fakeDB{}, &fakeObjects{}, queue.NewMemory())
	outcome, err := server.Execute(jobContext(), jobs.Envelope{
		Version: jobs.Version,
		JobID:   "11111111-1111-4111-8111-111111111111",
		Kind:    jobs.KindImgproxy,
		Claims:  jobs.Claims{Subject: "user_test", Role: "authenticated"},
		Payload: json.RawMessage(`{}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if outcome.HTTPStatus != http.StatusNotImplemented {
		t.Fatalf("status = %d", outcome.HTTPStatus)
	}
}

func testServer(t *testing.T, db *fakeDB, objects *fakeObjects, messages *queue.Memory) *Server {
	t.Helper()
	return &Server{
		DB:       db,
		Objects:  objects,
		Profiles: fakeProfiles{},
		Bucket:   testBucket,
		Identity: fakeIdentity{},
		Jobs:     status.NewMemory(),
		Sender:   messages,
	}
}

func requestJSON(t *testing.T, server *Server, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	handler := NewHandler(server)
	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(payload)
	}
	request := httptest.NewRequest(method, path, reader)
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	request.Header.Set("Idempotency-Key", "test-key")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func jobContext() context.Context {
	return context.WithValue(context.Background(), tokenContextKey{}, testJWT)
}

type fakeIdentity struct{}

func (fakeIdentity) Verify(token string) (jobs.Claims, error) {
	if token != testJWT {
		return jobs.Claims{}, errUnauthorized
	}
	return jobs.Claims{Subject: "user_test", Role: "authenticated"}, nil
}

type rejectIdentity struct{}

func (rejectIdentity) Verify(string) (jobs.Claims, error) {
	return jobs.Claims{Subject: "someone_else", Role: "authenticated"}, nil
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

type fakeDB struct {
	listBody     json.RawMessage
	listJWT      string
	listRelation string
	rpcBody      json.RawMessage
	rpcErr       error
	rpcJWT       string
	rpcs         []string
	lastArgs     map[string]any
}

func (f *fakeDB) RPC(_ context.Context, jwt, name string, args any) (json.RawMessage, error) {
	f.rpcJWT = jwt
	f.rpcs = append(f.rpcs, name)
	if argsMap, ok := args.(map[string]any); ok {
		f.lastArgs = argsMap
	}
	if name == "set_owner" {
		return json.RawMessage(`"` + testUser + `"`), nil
	}
	if f.rpcErr != nil {
		return nil, f.rpcErr
	}
	if f.rpcBody != nil {
		return f.rpcBody, nil
	}
	return json.RawMessage(`[]`), nil
}

func (f *fakeDB) List(_ context.Context, jwt, relation string) (json.RawMessage, error) {
	f.listJWT = jwt
	f.listRelation = relation
	if f.listBody != nil {
		return f.listBody, nil
	}
	return json.RawMessage(`[]`), nil
}

func (f *fakeDB) One(context.Context, string, string, string, string) (json.RawMessage, error) {
	return json.RawMessage(`{}`), nil
}

type fakeObjects struct {
	exists       bool
	bucketExists bool
	existCalls   int
	deleteCalls  int
	presignCalls int
}

func (f *fakeObjects) BucketExists(context.Context, string) (bool, error) {
	return f.bucketExists, nil
}
func (f *fakeObjects) Upload(context.Context, string, string, io.Reader, int64) error {
	return nil
}
func (f *fakeObjects) Open(context.Context, string, string) (s3store.Opened, error) {
	return s3store.Opened{Body: io.NopCloser(bytes.NewReader(nil))}, nil
}
func (f *fakeObjects) Delete(context.Context, string, string, string, bool) error {
	f.deleteCalls++
	return nil
}
func (f *fakeObjects) DeleteMany(context.Context, string, []string, bool) error {
	f.deleteCalls++
	return nil
}
func (f *fakeObjects) Copy(context.Context, string, string, string, string) error { return nil }
func (f *fakeObjects) Exists(context.Context, string, string) (bool, error) {
	f.existCalls++
	return f.exists, nil
}
func (f *fakeObjects) PresignPut(context.Context, string, string) (string, error) {
	f.presignCalls++
	return "https://example.test/put", nil
}
func (f *fakeObjects) PresignGet(context.Context, string, string) (string, error) {
	return "https://example.test/get", nil
}

type fakeProfiles struct{}

func (fakeProfiles) Get(context.Context, string) (clerkprofile.User, error) {
	username := "ada"
	return clerkprofile.User{ID: "user_1", Username: &username}, nil
}
