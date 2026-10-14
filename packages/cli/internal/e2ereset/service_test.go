package e2ereset

import (
	"context"
	"errors"
	"testing"
)

// recordingHost records the order of host operations and injects failures.
type recordingHost struct {
	calls        []string
	quiesceErr   error
	sqlErr       error
	restartErr   error
	sqlCommitted bool
}

func (r *recordingHost) ProbeIdentity(context.Context, string) (HostRuntimeIdentity, error) {
	r.calls = append(r.calls, "probe")
	return HostRuntimeIdentity{}, nil
}
func (r *recordingHost) QuiesceWorker(context.Context, string) error {
	r.calls = append(r.calls, "quiesce")
	return r.quiesceErr
}
func (r *recordingHost) ExecuteCanonicalSQL(context.Context, string) (DatabaseResult, error) {
	r.calls = append(r.calls, "sql")
	if r.sqlErr != nil {
		return DatabaseResult{}, r.sqlErr
	}
	return DatabaseResult{Committed: true}, nil
}
func (r *recordingHost) RestartWorker(context.Context, string) error {
	r.calls = append(r.calls, "restart")
	return r.restartErr
}

type recordingBucket struct {
	called bool
	result BucketResult
	err    error
}

func (r *recordingBucket) EmptyAndVerify(context.Context, BucketIdentity) (BucketResult, error) {
	r.called = true
	return r.result, r.err
}

func samplePlan() ResetPlan {
	p, err := BuildResetPlan(validInputs())
	if err != nil {
		panic(err)
	}
	return p
}

func TestExecuteHappyPathOrdersPhases(t *testing.T) {
	host := &recordingHost{}
	bucket := &recordingBucket{result: BucketResult{Deleted: 3, Empty: true}}
	svc := &Service{Host: host, Bucket: bucket}

	res, err := svc.Execute(context.Background(), samplePlan())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := []string{"quiesce", "sql", "restart"}
	if len(host.calls) != 3 || host.calls[0] != want[0] || host.calls[1] != want[1] || host.calls[2] != want[2] {
		t.Fatalf("phase order = %v, want %v", host.calls, want)
	}
	if !res.DatabaseCommitted || !res.BucketEmptied || !res.WorkerRestarted || res.BucketDeleted != 3 {
		t.Errorf("result = %+v", res)
	}
}

func TestExecuteDatabaseFailureSkipsBucketButRestartsWorker(t *testing.T) {
	host := &recordingHost{sqlErr: errors.New("sql boom")}
	bucket := &recordingBucket{}
	svc := &Service{Host: host, Bucket: bucket}

	_, err := svc.Execute(context.Background(), samplePlan())
	if err == nil {
		t.Fatal("expected database error")
	}
	if bucket.called {
		t.Error("bucket must not be touched when the database fails")
	}
	if host.calls[len(host.calls)-1] != "restart" {
		t.Errorf("worker must be restarted even on DB failure; calls=%v", host.calls)
	}
}

func TestExecuteQuiesceFailureDoesNotMutate(t *testing.T) {
	host := &recordingHost{quiesceErr: errors.New("stuck")}
	bucket := &recordingBucket{}
	svc := &Service{Host: host, Bucket: bucket}

	_, err := svc.Execute(context.Background(), samplePlan())
	if err == nil {
		t.Fatal("expected quiesce error")
	}
	for _, c := range host.calls {
		if c == "sql" || c == "restart" {
			t.Errorf("no mutation or restart expected after quiesce failure; calls=%v", host.calls)
		}
	}
	if bucket.called {
		t.Error("bucket must not be touched when quiesce fails")
	}
}

// Property 12: Partial Failure Reporting Reflects Completed Effects.
// Feature: stage-aware-cypress-harness, Property 12: Partial Failure Reporting Reflects Completed Effects
func TestProperty12PartialFailureReporting(t *testing.T) {
	// Enumerate phase outcomes and assert the reported result reflects exactly
	// the completed effects.
	type scenario struct {
		sqlErr     error
		bucketErr  error
		restartErr error
		deleted    int
		empty      bool
	}
	scenarios := []scenario{
		{nil, nil, nil, 5, true},
		{errors.New("sql"), nil, nil, 0, false},
		{nil, errors.New("bucket"), nil, 2, false},
		{nil, nil, errors.New("restart"), 4, true},
		{nil, errors.New("bucket"), errors.New("restart"), 1, false},
	}
	for i, s := range scenarios {
		host := &recordingHost{sqlErr: s.sqlErr, restartErr: s.restartErr}
		bucket := &recordingBucket{
			result: BucketResult{Deleted: s.deleted, Empty: s.empty},
			err:    s.bucketErr,
		}
		svc := &Service{Host: host, Bucket: bucket}
		res, err := svc.Execute(context.Background(), samplePlan())

		if s.sqlErr != nil {
			if err == nil || res.DatabaseCommitted {
				t.Errorf("scenario %d: sql failure must not report commit", i)
			}
			continue
		}
		// SQL committed in all remaining scenarios.
		if !res.DatabaseCommitted {
			t.Errorf("scenario %d: expected DB commit", i)
		}
		if res.BucketDeleted != s.deleted {
			t.Errorf("scenario %d: deleted=%d want %d", i, res.BucketDeleted, s.deleted)
		}
		if s.bucketErr != nil && err == nil {
			t.Errorf("scenario %d: bucket failure must surface an error", i)
		}
		if s.bucketErr == nil && s.restartErr == nil && err != nil {
			t.Errorf("scenario %d: clean run must not error: %v", i, err)
		}
		if s.restartErr != nil && res.WorkerRestarted {
			t.Errorf("scenario %d: restart failure must not report restarted", i)
		}
	}
}
