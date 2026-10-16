package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/dbos-inc/dbos-transact-golang/dbos"
	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/api"
	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/s3store"
	"github.com/gregidonut/sqldev/packages/functions/internal/imagor"
	"github.com/gregidonut/sqldev/packages/functions/internal/jobs"
	"github.com/gregidonut/sqldev/packages/functions/internal/queue"
	"github.com/gregidonut/sqldev/packages/functions/internal/result"
	"github.com/gregidonut/sqldev/packages/functions/internal/sqldb"
	"github.com/gregidonut/sqldev/packages/functions/internal/status"
	"github.com/gregidonut/sqldev/packages/functions/internal/worker"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "migrate" {
		if err := migrate(context.Background()); err != nil {
			slog.Error("migrate", "error", err)
			os.Exit(1)
		}
		return
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := serve(ctx); err != nil && ctx.Err() == nil {
		slog.Error("worker stopped", "error", err)
		os.Exit(1)
	}
}

func serve(ctx context.Context) error {
	databaseURL := os.Getenv("DBOS_SYSTEM_DATABASE_URL")
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	dbosCtx, err := dbos.NewContext(ctx, dbos.Config{
		AppName:        "sqldev",
		SystemDBPool:   pool,
		DatabaseSchema: "dbos",
		SkipMigrations: os.Getenv("SKIP_DBOS_MIGRATIONS") == "true",
	})
	if err != nil {
		return err
	}
	source, err := dbos.NewDataSource(dbosCtx, pool, dbos.WithDataSourceName("sqldev"))
	if err != nil {
		return err
	}
	objects, err := s3store.New(ctx)
	if err != nil {
		return err
	}
	jobsStore, err := status.NewDynamo(ctx, os.Getenv("JOB_TABLE_NAME"))
	if err != nil {
		return err
	}
	results, err := result.NewS3(ctx, os.Getenv("JOB_RESULT_BUCKET"))
	if err != nil {
		return err
	}
	imageClient, err := imagor.NewFromEnv()
	if err != nil {
		return err
	}
	var images api.ImageRenderer
	if imageClient != nil {
		images = imageClient
	}
	processor := &processor{
		source: source,
		server: &api.Server{
			Objects: objects,
			Bucket:  os.Getenv("APP_BUCKET"),
			Jobs:    jobsStore,
			Results: results,
			Images:  images,
		},
	}
	dbos.RegisterWorkflow(dbosCtx, processor.Run)
	jobQueue, err := dbos.RegisterQueue(dbosCtx, "ec2-jobs",
		dbos.WithGlobalConcurrency(1),
		dbos.WithWorkerConcurrency(1),
	)
	if err != nil {
		return err
	}
	processor.queue = jobQueue
	processor.dbos = dbosCtx
	if err := dbos.Launch(dbosCtx); err != nil {
		return err
	}
	defer dbos.Shutdown(dbosCtx, 30*time.Second)
	receiver, err := queue.NewSQS(ctx, os.Getenv("JOB_QUEUE_URL"))
	if err != nil {
		return err
	}
	return worker.Poll(ctx, receiver, processor)
}

type processor struct {
	source *dbos.DataSource
	queue  dbos.Queue
	dbos   dbos.Context
	server *api.Server
}

func (p *processor) Run(ctx dbos.Context, envelope jobs.Envelope) (jobs.Outcome, error) {
	if err := p.server.Jobs.Update(context.Background(), status.Record{
		JobID:  envelope.JobID,
		Owner:  envelope.Claims.Subject,
		Kind:   envelope.Kind,
		Status: status.Running,
	}); err != nil {
		slog.Error("mark job running", "jobId", envelope.JobID, "error", err)
	}
	outcome, err := p.execute(ctx, envelope)
	if err != nil {
		outcome = jobs.Outcome{HTTPStatus: 500, Message: "internal error"}
	}
	// DBOS records this outcome, so a later replay of the same key can tell an
	// identical request from a conflicting one even after the status record expires.
	outcome.Fingerprint = envelope.Fingerprint
	if finishErr := p.server.Finish(context.Background(), envelope, outcome); finishErr != nil {
		// A job left running can never be resubmitted, because only failed
		// image jobs reopen under a new workflow id.
		if markErr := p.server.Jobs.Update(context.Background(), status.Record{
			JobID:      envelope.JobID,
			Owner:      envelope.Claims.Subject,
			Kind:       envelope.Kind,
			Status:     status.Failed,
			HTTPStatus: 500,
			Message:    "internal error",
		}); markErr != nil {
			slog.Error("mark job failed", "jobId", envelope.JobID, "error", markErr)
		}
		return withoutImageBytes(outcome), finishErr
	}
	outcome = withoutImageBytes(outcome)
	if err != nil {
		return outcome, err
	}
	return outcome, nil
}

func withoutImageBytes(outcome jobs.Outcome) jobs.Outcome {
	if outcome.Artifact == nil {
		return outcome
	}
	outcome.Artifact = &jobs.Artifact{
		Key:         outcome.Artifact.Key,
		ContentType: outcome.Artifact.ContentType,
	}
	return outcome
}

func (p *processor) execute(ctx dbos.Context, envelope jobs.Envelope) (jobs.Outcome, error) {
	if envelope.Kind == jobs.KindImagor {
		return p.executeImagor(ctx, envelope)
	}
	return dbos.RunAsTransaction(ctx, p.source, func(txCtx context.Context, tx dbos.Tx) (jobs.Outcome, error) {
		session := sqldb.New(tx, envelope.Claims)
		server := *p.server
		server.DB = session
		outcome, err := server.Execute(api.WithBearer(txCtx, "job"), envelope)
		if err != nil {
			return outcome, err
		}
		return outcome, session.Restore(txCtx)
	})
}

type imagePrep struct {
	Request imagor.Request
	Outcome jobs.Outcome
}

// executeImagor authorizes inside the database transaction, then calls Imagor
// only after that transaction has committed.
func (p *processor) executeImagor(ctx dbos.Context, envelope jobs.Envelope) (jobs.Outcome, error) {
	prepared, err := dbos.RunAsTransaction(ctx, p.source, func(txCtx context.Context, tx dbos.Tx) (imagePrep, error) {
		session := sqldb.New(tx, envelope.Claims)
		server := *p.server
		server.DB = session
		request, outcome := server.PrepareImage(api.WithBearer(txCtx, "job"), envelope)
		if err := session.Restore(txCtx); err != nil {
			return imagePrep{}, err
		}
		return imagePrep{Request: request, Outcome: outcome}, nil
	})
	if err != nil {
		return jobs.Outcome{}, err
	}
	return imageOutcome(prepared, func(request imagor.Request) (jobs.Outcome, error) {
		return p.server.RenderImage(ctx, envelope, request)
	})
}

func imageOutcome(prepared imagePrep, render func(imagor.Request) (jobs.Outcome, error)) (jobs.Outcome, error) {
	if prepared.Outcome.HTTPStatus != 0 {
		return prepared.Outcome, nil
	}
	return render(prepared.Request)
}

func (p *processor) Accept(ctx context.Context, envelope jobs.Envelope) error {
	record, err := p.server.Jobs.Get(ctx, envelope.JobID)
	if err != nil && !errors.Is(err, status.ErrNotFound) {
		return err
	}
	found := err == nil
	workflowID, err := chooseWorkflowID(envelope, record, found, p.lookupWorkflow)
	if err != nil {
		return err
	}
	outcome, settled, err := reconcileOutcome(envelope, record, found, workflowID, p.lookupWorkflow, p.workflowOutcome)
	if err != nil {
		return err
	}
	if settled {
		// The work already ran under this workflow id. Report what it recorded and
		// run nothing again: a mutation must happen once per idempotency key.
		return p.server.Finish(ctx, envelope, outcome)
	}
	_, err = dbos.RunWorkflow(p.dbos, p.Run, envelope,
		dbos.WithWorkflowID(workflowID),
		dbos.WithQueue(p.queue),
	)
	return err
}

// workflowLookup reports the state of the DBOS workflow with one id. The bool
// is false when no such workflow exists.
type workflowLookup func(id string) (dbos.WorkflowStatusType, bool, error)

// chooseWorkflowID picks the DBOS workflow id for one queue message.
//
// DBOS treats a workflow id as an idempotency key: running a finished id again
// returns the recorded result and ignores the new input. Job ids are stable per
// idempotency key, but their status record expires after 24 hours while the
// workflow row does not. A thumbnail requested again after that window gets a
// fresh "pending" record, and the worker would attach it to the old finished
// workflow, so nothing would ever update the record. Normal completion always
// moves the record out of "pending" before the workflow ends, so a finished
// workflow paired with a pending record means the record was recreated. Such a
// job runs under an id tied to that record's expiry. The id is the same for
// every duplicate message of the same record, so duplicates still collapse.
//
// Only Imagor jobs are renewed. They render a derived copy and are safe to run
// again, while a mutation must not run twice for one idempotency key.
func chooseWorkflowID(envelope jobs.Envelope, record status.Record, found bool, lookup workflowLookup) (string, error) {
	id := envelope.JobID
	if !found {
		return id, nil
	}
	if record.Attempt > 1 {
		id = fmt.Sprintf("%s:%d", id, record.Attempt)
	}
	if envelope.Kind != jobs.KindImagor || record.Status != status.Pending {
		return id, nil
	}
	state, exists, err := lookup(id)
	if err != nil {
		return "", err
	}
	if !exists || !workflowFinished(state) {
		return id, nil
	}
	return fmt.Sprintf("%s:e%d", id, record.ExpiresAt.Unix()), nil
}

// workflowOutcome reads the outcome a finished workflow recorded.
type workflowOutcome func(id string) (jobs.Outcome, error)

// reconcileOutcome settles a recreated job record for the fingerprinted kinds.
//
// The status record expires after 24 hours but DBOS keeps the workflow row, and a
// finished workflow id is never run again. A key reused after the record expired
// therefore gets a fresh "pending" record whose workflow already finished, and
// nothing would ever update it. Normal completion always moves the record out of
// "pending" before the workflow ends, so a finished workflow behind a pending
// record means the record was recreated.
//
// The recorded outcome is reported when the request body is the same, and an
// idempotency conflict when it differs. The mutation is never executed again.
func reconcileOutcome(envelope jobs.Envelope, record status.Record, found bool, workflowID string,
	lookup workflowLookup, recorded workflowOutcome) (jobs.Outcome, bool, error) {
	if !found || !jobs.Fingerprinted(envelope.Kind) || record.Status != status.Pending {
		return jobs.Outcome{}, false, nil
	}
	state, exists, err := lookup(workflowID)
	if err != nil {
		return jobs.Outcome{}, false, err
	}
	if !exists || !workflowFinished(state) {
		return jobs.Outcome{}, false, nil
	}
	previous, err := recorded(workflowID)
	if err != nil {
		// The workflow ended in an error, so that is the answer for this key.
		return jobs.Outcome{HTTPStatus: 500, Message: "internal error", Fingerprint: envelope.Fingerprint}, true, nil
	}
	if previous.Fingerprint != envelope.Fingerprint {
		body, err := json.Marshal(api.OperationRejectedResult{Kind: api.Rejected, Reason: api.RejectionReasonIdempotencyConflict})
		if err != nil {
			return jobs.Outcome{}, false, err
		}
		return jobs.Outcome{HTTPStatus: 200, Body: body, Fingerprint: envelope.Fingerprint}, true, nil
	}
	return previous, true, nil
}

func workflowFinished(state dbos.WorkflowStatusType) bool {
	switch state {
	case dbos.WorkflowStatusSuccess,
		dbos.WorkflowStatusError,
		dbos.WorkflowStatusCancelled,
		dbos.WorkflowStatusMaxRecoveryAttemptsExceeded:
		return true
	default:
		return false
	}
}

func (p *processor) workflowOutcome(id string) (jobs.Outcome, error) {
	handle, err := dbos.RetrieveWorkflow[jobs.Outcome](p.dbos, id)
	if err != nil {
		return jobs.Outcome{}, err
	}
	return handle.GetResult()
}

func (p *processor) lookupWorkflow(id string) (dbos.WorkflowStatusType, bool, error) {
	handle, err := dbos.RetrieveWorkflow[jobs.Outcome](p.dbos, id)
	if err != nil {
		var dbosErr *dbos.Error
		if errors.As(err, &dbosErr) && dbosErr.Code == dbos.ErrorCodeNonExistentWorkflow {
			return "", false, nil
		}
		return "", false, err
	}
	current, err := handle.GetStatus()
	if err != nil {
		return "", false, err
	}
	return current.Status, true, nil
}
