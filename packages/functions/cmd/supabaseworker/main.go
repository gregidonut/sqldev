package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/dbos-inc/dbos-transact-golang/dbos"
	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/api"
	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/s3store"
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
	processor := &processor{
		source: source,
		server: &api.Server{
			Objects: objects,
			Bucket:  os.Getenv("APP_BUCKET"),
			Jobs:    jobsStore,
			Results: results,
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
	_ = p.server.Jobs.Update(context.Background(), status.Record{
		JobID:  envelope.JobID,
		Owner:  envelope.Claims.Subject,
		Kind:   envelope.Kind,
		Status: status.Running,
	})
	outcome, err := dbos.RunAsTransaction(ctx, p.source, func(txCtx context.Context, tx dbos.Tx) (jobs.Outcome, error) {
		session := sqldb.New(tx, envelope.Claims)
		server := *p.server
		server.DB = session
		outcome, err := server.Execute(api.WithBearer(txCtx, "job"), envelope)
		if err != nil {
			return outcome, err
		}
		return outcome, session.Restore(txCtx)
	})
	if err != nil {
		outcome = jobs.Outcome{HTTPStatus: 500, Message: "internal error"}
	}
	if finishErr := p.server.Finish(context.Background(), envelope, outcome); finishErr != nil {
		return outcome, finishErr
	}
	if err != nil {
		return outcome, err
	}
	return outcome, nil
}

func (p *processor) Accept(ctx context.Context, envelope jobs.Envelope) error {
	_, err := dbos.RunWorkflow(p.dbos, p.Run, envelope,
		dbos.WithWorkflowID(envelope.JobID),
		dbos.WithQueue(p.queue),
	)
	return err
}
