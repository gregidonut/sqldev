//go:build integration

package main

// A rig that runs the production path end to end against local Supabase:
// API handler -> job-status store -> queue message -> processor.Accept -> real DBOS
// workflow -> sqldb.Session transaction as `authenticated` -> the SQL functions.
//
//	SQLDEV_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
//	  CGO_ENABLED=0 go -C packages/functions test -tags integration ./cmd/supabaseworker/...
//
// DBOS state lives in a throwaway schema (dbos_it_<random>) that is dropped afterwards.

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/dbos-inc/dbos-transact-golang/dbos"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/api"
	"github.com/gregidonut/sqldev/packages/functions/internal/jobs"
	"github.com/gregidonut/sqldev/packages/functions/internal/queue"
	"github.com/gregidonut/sqldev/packages/functions/internal/status"
)

const (
	rigBucket = "linked-bucket"
	rigPrefix = "it_"
)

func propertyTag(t *testing.T, n int, title string, fn func(t *testing.T)) {
	t.Helper()
	t.Run(fmt.Sprintf("Feature: storage-visibility-confirmation, Property %d: %s", n, title), fn)
}

type rigIdentity struct{}

// Verify maps the token "tok-<sub>" to that Clerk subject.
func (rigIdentity) Verify(token string) (jobs.Claims, error) {
	sub, ok := strings.CutPrefix(token, "tok-")
	if !ok || sub == "" {
		return jobs.Claims{}, fmt.Errorf("unauthorized")
	}
	return jobs.Claims{Subject: sub, Role: "authenticated"}, nil
}

type rig struct {
	t        *testing.T
	pool     *pgxpool.Pool
	appName  string
	proc     *processor
	api      *api.Server
	handler  http.Handler
	messages *queue.Memory

	mu        sync.Mutex
	delivered int
}

type owner struct {
	Sub    string
	UserID uuid.UUID
	Object uuid.UUID
}

func newRig(t *testing.T) *rig {
	t.Helper()
	url := os.Getenv("SQLDEV_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("SQLDEV_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	appName := "sqldev-it-" + uuid.NewString()[:8]
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.MaxConns = 16
	cfg.ConnConfig.RuntimeParams["application_name"] = appName
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	schema := "dbos_it_" + hex.EncodeToString([]byte(uuid.NewString()[:6]))
	dbosCtx, err := dbos.NewContext(ctx, dbos.Config{AppName: "sqldev-it", SystemDBPool: pool, DatabaseSchema: schema})
	if err != nil {
		t.Fatalf("dbos context: %v", err)
	}
	source, err := dbos.NewDataSource(dbosCtx, pool, dbos.WithDataSourceName("it"), dbos.WithDataSourceSchema(schema))
	if err != nil {
		t.Fatalf("data source: %v", err)
	}
	jobsStore := status.NewMemory()
	proc := &processor{source: source, server: &api.Server{Jobs: jobsStore, Bucket: rigBucket}}
	dbos.RegisterWorkflow(dbosCtx, proc.Run)
	jobQueue, err := dbos.RegisterQueue(dbosCtx, "ec2-jobs", dbos.WithGlobalConcurrency(1), dbos.WithWorkerConcurrency(1))
	if err != nil {
		t.Fatal(err)
	}
	proc.queue = jobQueue
	proc.dbos = dbosCtx
	if err := dbos.Launch(dbosCtx); err != nil {
		t.Fatalf("launch: %v", err)
	}
	t.Cleanup(func() {
		dbos.Shutdown(dbosCtx, 10*time.Second)
		// DBOS may close the pool it was given, so drop the schema on a fresh connection.
		if !strings.HasPrefix(schema, "dbos_it_") {
			return
		}
		conn, err := pgx.Connect(context.Background(), url)
		if err != nil {
			t.Errorf("drop %s: %v", schema, err)
			return
		}
		defer conn.Close(context.Background())
		if _, err := conn.Exec(context.Background(), fmt.Sprintf(`DROP SCHEMA IF EXISTS %s CASCADE`, pgx.Identifier{schema}.Sanitize())); err != nil {
			t.Errorf("drop %s: %v", schema, err)
		}
	})

	messages := queue.NewMemory()
	apiServer := &api.Server{Bucket: rigBucket, Identity: rigIdentity{}, Jobs: jobsStore, Sender: messages}
	return &rig{t: t, pool: pool, appName: appName, proc: proc, api: apiServer, handler: api.NewHandler(apiServer), messages: messages}
}

// expireJobRecords simulates the 24-hour status TTL: the records vanish, DBOS keeps its workflows.
func (r *rig) expireJobRecords() {
	fresh := status.NewMemory()
	r.api.Jobs = fresh
	r.proc.server.Jobs = fresh
}

func (r *rig) newOwner() owner {
	r.t.Helper()
	ctx := context.Background()
	o := owner{Sub: rigPrefix + strings.ReplaceAll(uuid.NewString(), "-", "")}
	must := func(err error) {
		if err != nil {
			r.t.Fatal(err)
		}
	}
	must(r.pool.QueryRow(ctx, `INSERT INTO public.users (clerk_user_id) VALUES ($1) RETURNING user_id`, o.Sub).Scan(&o.UserID))
	must(r.pool.QueryRow(ctx, `INSERT INTO public.d_storage_objects DEFAULT VALUES RETURNING storage_object_id`).Scan(&o.Object))
	_, err := r.pool.Exec(ctx, `INSERT INTO public.d_storage_objects_roles (storage_object_id, user_id, role) VALUES ($1, $2, 'owner')`, o.Object, o.UserID)
	must(err)
	_, err = r.pool.Exec(ctx, `INSERT INTO public.d_storage_object_config (storage_object_id, public, config_version) VALUES ($1, FALSE, 1)`, o.Object)
	must(err)
	r.t.Cleanup(func() {
		// Children first: the config table has no cascade, and deleting the user
		// would cascade away the roles and leave the object orphaned.
		type step struct {
			sql  string
			args []any
		}
		for _, st := range []step{
			{`DELETE FROM public.app_confirmation_challenges WHERE actor_user_id = $1`, []any{o.UserID}},
			{`DELETE FROM public.d_storage_object_config WHERE storage_object_id = $1`, []any{o.Object}},
			{`DELETE FROM public.d_storage_objects_roles WHERE storage_object_id = $1`, []any{o.Object}},
			{`DELETE FROM public.d_storage_objects WHERE storage_object_id = $1`, []any{o.Object}},
			{`DELETE FROM public.users WHERE user_id = $1`, []any{o.UserID}},
		} {
			if _, err := r.pool.Exec(context.Background(), st.sql, st.args...); err != nil {
				r.t.Errorf("cleanup %q: %v", st.sql, err)
			}
		}
	})
	return o
}

func (r *rig) post(o owner, path, key, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer tok-"+o.Sub)
	request.Header.Set("Idempotency-Key", key)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	r.handler.ServeHTTP(response, request)
	return response
}

func (r *rig) visibilityBody(o owner, visibility string, revision int64) string {
	return fmt.Sprintf(`{"target":{"type":"storage_object","id":"%s"},"expectedRevision":%d,"visibility":"%s"}`, o.Object, revision, visibility)
}

func (r *rig) confirmBody(o owner, challenge map[string]any, revision int64) string {
	return fmt.Sprintf(`{"operationKind":"storage.visibility.make_public","target":{"type":"storage_object","id":"%s"},"expectedRevision":%d,"challengeId":"%s","proof":"%s"}`,
		o.Object, revision, challenge["challengeId"], challenge["proof"])
}

func (r *rig) visibilityPath() string {
	return "/api/storage/buckets/" + rigBucket + "/objects/visibility"
}

// deliver hands every queued message to the worker the way worker.Poll does:
// receive, parse, Accept, then delete. concurrent runs the deliveries in parallel.
func (r *rig) deliver(concurrent bool) {
	r.t.Helper()
	r.mu.Lock()
	sent := r.messages.Sent()
	pending := sent[r.delivered:]
	r.delivered = len(sent)
	r.mu.Unlock()

	var wg sync.WaitGroup
	for _, body := range pending {
		envelope, err := jobs.Parse(body)
		if err != nil {
			r.t.Fatal(err)
		}
		run := func() {
			if err := r.proc.Accept(context.Background(), envelope); err != nil {
				r.t.Errorf("accept %s: %v", envelope.JobID, err)
			}
		}
		if concurrent {
			wg.Add(1)
			go func() { defer wg.Done(); run() }()
		} else {
			run()
		}
	}
	wg.Wait()
}

func (r *rig) wait(jobID string) status.Record {
	r.t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		record, err := r.proc.server.Jobs.Get(context.Background(), jobID)
		if err == nil && (record.Status == status.Completed || record.Status == status.Failed) {
			return record
		}
		time.Sleep(20 * time.Millisecond)
	}
	r.t.Fatalf("job %s did not finish", jobID)
	return status.Record{}
}

func receiptID(t *testing.T, response *httptest.ResponseRecorder) string {
	t.Helper()
	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d body %s", response.Code, response.Body.String())
	}
	var receipt api.JobReceipt
	if err := json.Unmarshal(response.Body.Bytes(), &receipt); err != nil {
		t.Fatal(err)
	}
	return receipt.JobId.String()
}

// result returns the canonical JSON the browser would read for the job.
func (r *rig) result(o owner, jobID string) string {
	r.t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/api/jobs/"+jobID, nil)
	request.Header.Set("Authorization", "Bearer tok-"+o.Sub)
	response := httptest.NewRecorder()
	r.handler.ServeHTTP(response, request)
	var state struct {
		Status string          `json:"status"`
		Result json.RawMessage `json:"result"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &state); err != nil || state.Status != "completed" {
		r.t.Fatalf("job %s: %s (%v)", jobID, response.Body.String(), err)
	}
	var canonical any
	_ = json.Unmarshal(state.Result, &canonical)
	out, _ := json.Marshal(canonical)
	return string(out)
}

func decodeMap(t *testing.T, raw string) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		t.Fatalf("%s: %v", raw, err)
	}
	return out
}

type dbState struct {
	rows        int
	maxRevision int64
	challenges  int
	consumed    int
}

func (r *rig) state(o owner) dbState {
	r.t.Helper()
	var s dbState
	err := r.pool.QueryRow(context.Background(), `
		SELECT (SELECT count(*) FROM public.d_storage_object_config WHERE storage_object_id = $1),
		       (SELECT max(config_version) FROM public.d_storage_object_config WHERE storage_object_id = $1),
		       (SELECT count(*) FROM public.app_confirmation_challenges WHERE target_id = $1),
		       (SELECT count(*) FROM public.app_confirmation_challenges WHERE target_id = $1 AND state = 'consumed')`,
		o.Object).Scan(&s.rows, &s.maxRevision, &s.challenges, &s.consumed)
	if err != nil {
		r.t.Fatal(err)
	}
	return s
}

// initiate runs the first job of make-public to completion and returns its challenge.
func (r *rig) initiate(o owner, key string, revision int64) (jobID string, challenge map[string]any) {
	r.t.Helper()
	jobID = receiptID(r.t, r.post(o, r.visibilityPath(), key, r.visibilityBody(o, "public", revision)))
	r.deliver(false)
	r.wait(jobID)
	challenge = decodeMap(r.t, r.result(o, jobID))
	if challenge["kind"] != "confirmation_required" {
		r.t.Fatalf("initiation result = %v", challenge)
	}
	return jobID, challenge
}
