package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/clerkprofile"
	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/s3store"
	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/supadb"
)

const (
	testUser   = "11111111-1111-1111-1111-111111111111"
	testJWT    = "clerk-session-token"
	testBucket = "linked-bucket"
)

func TestMissingBearerIsUnauthorized(t *testing.T) {
	server := testServer(t, &fakeDB{}, &fakeObjects{})
	response := requestJSON(t, server, http.MethodGet, "/api/views/igPosts/list/get", "", nil)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.Code)
	}
}

func TestListViewForwardsClerkJWT(t *testing.T) {
	db := &fakeDB{listBody: json.RawMessage(`[{"post_id":"11111111-1111-1111-1111-111111111111"}]`)}
	server := testServer(t, db, &fakeObjects{})
	response := requestJSON(t, server, http.MethodGet, "/api/views/igPosts/list/get", testJWT, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d body %s", response.Code, response.Body.String())
	}
	if db.listJWT != testJWT || db.listRelation != "ig_posts_view" {
		t.Fatalf("list jwt=%q relation=%q", db.listJWT, db.listRelation)
	}
}

func TestStorageWrongBucketDoesNotTouchS3(t *testing.T) {
	objects := &fakeObjects{}
	server := testServer(t, &fakeDB{}, objects)
	response := requestJSON(t, server, http.MethodGet, "/api/storage/buckets/other/objects?tab=mine", testJWT, nil)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", response.Code)
	}
	if objects.existCalls != 0 || objects.deleteCalls != 0 || objects.presignCalls != 0 {
		t.Fatalf("s3 was called: %+v", objects)
	}
}

func TestForgedAbortDoesNotCallDatabase(t *testing.T) {
	db := &fakeDB{}
	server := testServer(t, db, &fakeObjects{})
	body := map[string]any{
		"storageObjectId":     "22222222-2222-2222-2222-222222222222",
		"storageObjectDataId": "33333333-3333-3333-3333-333333333333",
		"fileName":            "note.txt",
		"isNewObject":         true,
		"s3ObjectKey":         "99999999-9999-9999-9999-999999999999/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333/note.txt",
	}
	response := requestJSON(t, server, http.MethodPost, "/api/storage/buckets/"+testBucket+"/objects/abort", testJWT, body)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d body %s", response.Code, response.Body.String())
	}
	if len(db.rpcs) != 1 || db.rpcs[0] != "set_owner" {
		t.Fatalf("rpcs = %#v, want only set_owner", db.rpcs)
	}
}

func TestCommitMissingObjectAbortsAndDoesNotCommit(t *testing.T) {
	db := &fakeDB{}
	objects := &fakeObjects{exists: false}
	server := testServer(t, db, objects)
	response := requestJSON(t, server, http.MethodPost, "/api/storage/buckets/"+testBucket+"/objects/commit", testJWT, pendingBody())
	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d body %s", response.Code, response.Body.String())
	}
	if contains(db.rpcs, "commit_d_storage_upload") {
		t.Fatalf("commit rpc was called: %#v", db.rpcs)
	}
	if !contains(db.rpcs, "abort_d_storage_upload") {
		t.Fatalf("abort rpc missing: %#v", db.rpcs)
	}
}

func TestCommitExistingObjectForwardsJWT(t *testing.T) {
	db := &fakeDB{}
	server := testServer(t, db, &fakeObjects{exists: true})
	response := requestJSON(t, server, http.MethodPost, "/api/storage/buckets/"+testBucket+"/objects/commit", testJWT, pendingBody())
	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d body %s", response.Code, response.Body.String())
	}
	if db.rpcJWT != testJWT {
		t.Fatalf("rpc jwt = %q", db.rpcJWT)
	}
	if !contains(db.rpcs, "commit_d_storage_upload") {
		t.Fatalf("commit rpc missing: %#v", db.rpcs)
	}
}

func TestForbiddenRPCIs403(t *testing.T) {
	db := &fakeDB{rpcErr: &supadb.Error{Status: http.StatusBadRequest, Message: "prepare_d_storage_upload: forbidden"}}
	server := testServer(t, db, &fakeObjects{})
	response := requestJSON(t, server, http.MethodPost, "/api/storage/buckets/"+testBucket+"/objects/presign?fileName=note.txt", testJWT, nil)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d body %s", response.Code, response.Body.String())
	}
}

func TestListStorageFiltersEmptyKeys(t *testing.T) {
	db := &fakeDB{rpcBody: json.RawMessage(`[
		{"storage_object_id":"22222222-2222-2222-2222-222222222222","user_id":"11111111-1111-1111-1111-111111111111","clerk_user_id":"user_1","created_at":"2026-10-07T12:00:00.123456+00:00","updated_at":"2026-10-07T12:00:00.123456+00:00","s3_object_key":"11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333/note.txt","file_name":"note.txt","public":false},
		{"s3_object_key":""}
	]`)}
	server := testServer(t, db, &fakeObjects{bucketExists: true})
	response := requestJSON(t, server, http.MethodGet, "/api/storage/buckets/"+testBucket+"/objects?tab=mine", testJWT, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d body %s", response.Code, response.Body.String())
	}
	var rows []map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &rows); err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0]["file_name"] != "note.txt" {
		t.Fatalf("rows = %#v", rows)
	}
}

func TestMoveTodoSendsEveryID(t *testing.T) {
	db := &fakeDB{rpcBody: json.RawMessage(`[{"todo_item_id":"22222222-2222-2222-2222-222222222222"}]`)}
	server := testServer(t, db, &fakeObjects{})
	body, contentType := formBody(map[string][]string{
		"p_todo_item_ids": {"22222222-2222-2222-2222-222222222222", "33333333-3333-3333-3333-333333333333"},
	})
	request := httptest.NewRequest(http.MethodPatch, "/api/views/tdsTodos/44444444-4444-4444-4444-444444444444/tree/move/patch", body)
	request.Header.Set("Authorization", "Bearer "+testJWT)
	request.Header.Set("Content-Type", contentType)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d body %s", response.Code, response.Body.String())
	}
	ids, _ := db.lastArgs["p_todo_item_ids"].([]string)
	if len(ids) != 2 {
		t.Fatalf("ids = %#v", db.lastArgs["p_todo_item_ids"])
	}
	if db.lastArgs["p_new_parent_id"] != nil {
		t.Fatalf("parent = %#v", db.lastArgs["p_new_parent_id"])
	}
}

func testServer(t *testing.T, db *fakeDB, objects *fakeObjects) http.Handler {
	t.Helper()
	return NewHandler(&Server{
		DB:       db,
		Objects:  objects,
		Profiles: fakeProfiles{},
		Bucket:   testBucket,
	})
}

func requestJSON(t *testing.T, handler http.Handler, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
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
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func pendingBody() map[string]any {
	return map[string]any{
		"storageObjectId":     "22222222-2222-2222-2222-222222222222",
		"storageObjectDataId": "33333333-3333-3333-3333-333333333333",
		"fileName":            "note.txt",
		"isNewObject":         true,
		"s3ObjectKey":         testUser + "/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333/note.txt",
	}
}

func formBody(fields map[string][]string) (*bytes.Buffer, string) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for key, values := range fields {
		for _, value := range values {
			_ = writer.WriteField(key, value)
		}
	}
	_ = writer.Close()
	return &body, writer.FormDataContentType()
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

type fakeProfiles struct{}

func (fakeProfiles) Get(context.Context, string) (clerkprofile.User, error) {
	username := "ada"
	return clerkprofile.User{ID: "user_1", Username: &username}, nil
}
