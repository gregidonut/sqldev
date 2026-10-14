package e2ereset

import (
	"context"
	"errors"
)

// hostOps is the host side of a reset, satisfied by *HostExecutor and by test
// fakes.
type hostOps interface {
	ProbeIdentity(ctx context.Context, instanceID string) (HostRuntimeIdentity, error)
	QuiesceWorker(ctx context.Context, instanceID string) error
	ExecuteCanonicalSQL(ctx context.Context, instanceID string) (DatabaseResult, error)
	RestartWorker(ctx context.Context, instanceID string) error
}

// bucketOps is the S3 side of a reset.
type bucketOps interface {
	EmptyAndVerify(ctx context.Context, bucket BucketIdentity) (BucketResult, error)
}

// ResetResult reports the completed effects of a reset, so a partial failure is
// visible. S3 deletions are never rolled back after they occur.
type ResetResult struct {
	DatabaseCommitted bool
	BucketDeleted     int
	BucketEmptied     bool
	WorkerRestarted   bool
}

// Service orchestrates the reset phases: quiesce worker, run SQL, empty bucket,
// then always attempt to restart the worker. Database failure aborts before any
// bucket deletion.
type Service struct {
	Host   hostOps
	Bucket bucketOps
}

// Execute runs the reset for an authorized plan. The worker is restarted from
// every post-quiesce exit path.
func (s *Service) Execute(ctx context.Context, plan ResetPlan) (result ResetResult, err error) {
	if err := s.Host.QuiesceWorker(ctx, plan.Host.InstanceID); err != nil {
		return ResetResult{}, err
	}

	// Always attempt to restart the worker after quiescing, regardless of what
	// happens next, and surface a restart failure if the primary path succeeded.
	defer func() {
		if restartErr := s.Host.RestartWorker(ctx, plan.Host.InstanceID); restartErr != nil {
			if err == nil {
				err = errors.New("reset completed but the worker did not restart; a host-local fallback will restart it")
			}
			return
		}
		result.WorkerRestarted = true
	}()

	dbRes, dbErr := s.Host.ExecuteCanonicalSQL(ctx, plan.Host.InstanceID)
	if dbErr != nil {
		return ResetResult{}, dbErr
	}
	result.DatabaseCommitted = dbRes.Committed

	bucketRes, bucketErr := s.Bucket.EmptyAndVerify(ctx, plan.Application)
	result.BucketDeleted = bucketRes.Deleted
	result.BucketEmptied = bucketRes.Empty
	if bucketErr != nil {
		// Database is already committed; S3 may be partially deleted. Report
		// the completed effects without claiming any rollback.
		return result, bucketErr
	}

	return result, nil
}
