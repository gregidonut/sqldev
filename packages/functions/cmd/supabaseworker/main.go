package main

import (
	"context"
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
	if finishErr := p.server.Finish(context.Background(), envelope, outcome); finishErr != nil {
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
	workflowID := envelope.JobID
	if record, err := p.server.Jobs.Get(ctx, envelope.JobID); err == nil && record.Attempt > 1 {
		workflowID = fmt.Sprintf("%s:%d", envelope.JobID, record.Attempt)
	}
	_, err := dbos.RunWorkflow(p.dbos, p.Run, envelope,
		dbos.WithWorkflowID(workflowID),
		dbos.WithQueue(p.queue),
	)
	return err
}
