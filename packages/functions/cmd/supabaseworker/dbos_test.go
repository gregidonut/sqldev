//go:build integration

package main

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/dbos-inc/dbos-transact-golang/dbos"
	_ "github.com/dbos-inc/dbos-transact-golang/dbos/driver/sqlite"
)

func TestDBOSQueueIsSingleFlightAndDeduplicated(t *testing.T) {
	ctx := context.Background()
	dbosCtx, err := dbos.NewContext(ctx, dbos.Config{
		AppName:     "sqldev",
		DatabaseURL: "sqlite:" + t.TempDir() + "/dbos.sqlite",
	})
	if err != nil {
		t.Fatal(err)
	}
	var current atomic.Int32
	var maximum atomic.Int32
	var runs atomic.Int32
	work := func(ctx dbos.Context, id string) (string, error) {
		runs.Add(1)
		now := current.Add(1)
		for {
			seen := maximum.Load()
			if now <= seen || maximum.CompareAndSwap(seen, now) {
				break
			}
		}
		time.Sleep(40 * time.Millisecond)
		current.Add(-1)
		return id, nil
	}
	dbos.RegisterWorkflow(dbosCtx, work)
	jobQueue, err := dbos.RegisterQueue(dbosCtx, "ec2-jobs",
		dbos.WithGlobalConcurrency(1),
		dbos.WithWorkerConcurrency(1),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := dbos.Launch(dbosCtx); err != nil {
		t.Fatal(err)
	}
	defer dbos.Shutdown(dbosCtx, 10*time.Second)

	handles := make([]dbos.WorkflowHandle[string], 3)
	for i := range handles {
		handles[i], err = dbos.RunWorkflow(dbosCtx, work, fmt.Sprintf("job-%d", i),
			dbos.WithWorkflowID(fmt.Sprintf("11111111-1111-4111-8111-11111111111%d", i)),
			dbos.WithQueue(jobQueue),
		)
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, handle := range handles {
		if _, err := handle.GetResult(); err != nil {
			t.Fatal(err)
		}
	}
	if maximum.Load() != 1 {
		t.Fatalf("max concurrency = %d", maximum.Load())
	}
	before := runs.Load()
	duplicate, err := dbos.RunWorkflow(dbosCtx, work, "job-0",
		dbos.WithWorkflowID("11111111-1111-4111-8111-111111111110"),
		dbos.WithQueue(jobQueue),
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := duplicate.GetResult(); err != nil {
		t.Fatal(err)
	}
	if runs.Load() != before {
		t.Fatalf("duplicate delivery ran again: %d -> %d", before, runs.Load())
	}
}
