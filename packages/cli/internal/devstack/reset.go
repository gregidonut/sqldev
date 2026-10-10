package devstack

import (
	"context"
	"fmt"
	"io"
	"os"

	"github.com/gregidonut/sqldev/packages/cli/internal/process"
	"github.com/gregidonut/sqldev/packages/cli/internal/sst"
	"github.com/gregidonut/sqldev/packages/cli/internal/storage"
)

// StorageEmptier empties the linked bucket. storage.Service satisfies it. It is
// an interface so reset tests use a fake instead of real S3.
type StorageEmptier interface {
	EmptyBucket(ctx context.Context) (int, error)
}

// StorageFactory builds a StorageEmptier for a bucket/region.
type StorageFactory func(ctx context.Context, bucket, region string) (StorageEmptier, error)

// DefaultStorageFactory builds the real S3-backed storage service.
func DefaultStorageFactory(ctx context.Context, bucket, region string) (StorageEmptier, error) {
	return storage.NewService(ctx, bucket, region)
}

// ResetService performs the combined destructive data reset: empty the linked
// SQLDevBucket, then run `supabase db reset --local --no-seed`. It assumes
// confirmation and SST links have already been handled by the caller.
type ResetService struct {
	Stage       string
	Region      string
	SupabaseDir string
	Runner      process.Runner
	Resources   sst.Resources
	NewStorage  StorageFactory
	Out         io.Writer
}

// Run executes the reset. S3 is emptied before the database reset so a failed
// bucket deletion never resets database references while old objects remain.
func (r *ResetService) Run(ctx context.Context) error {
	if err := AssertLocalStage(r.Stage); err != nil {
		return err
	}
	bucket, err := r.Resources.String("SQLDevBucket", "name")
	if err != nil {
		return fmt.Errorf("reset failed before changes: %w", err)
	}

	factory := r.NewStorage
	if factory == nil {
		factory = DefaultStorageFactory
	}
	svc, err := factory(ctx, bucket, r.Region)
	if err != nil {
		return fmt.Errorf("reset failed before changes: %w", err)
	}
	deleted, err := svc.EmptyBucket(ctx)
	if err != nil {
		return fmt.Errorf("S3 empty failed; Supabase reset not attempted: %w", err)
	}
	fmt.Fprintf(r.output(), "emptied %d objects from %s\n", deleted, bucket)

	if err := r.supabaseReset(ctx); err != nil {
		return fmt.Errorf("S3 emptied %d objects; Supabase reset failed: %w", deleted, err)
	}
	fmt.Fprintf(r.output(), "reset complete: %d objects deleted, local Supabase reset\n", deleted)
	return nil
}

func (r *ResetService) supabaseReset(ctx context.Context) error {
	env, err := r.supabaseEnv()
	if err != nil {
		return err
	}
	return r.Runner.Run(ctx, process.RunRequest{
		Program: "bunx",
		Args:    []string{"--no-install", "supabase", "db", "reset", "--local", "--no-seed"},
		Dir:     r.SupabaseDir,
		Env:     env,
	})
}

// supabaseEnv mirrors the passthrough Supabase environment so the vendor CLI
// behaves exactly as `sqldev supabase` would.
func (r *ResetService) supabaseEnv() ([]string, error) {
	clerkFeDomain, err := r.Resources.String("ClerkFeDomain", "value")
	if err != nil {
		return nil, err
	}
	notifySecret, err := r.Resources.String("NotifySecret", "value")
	if err != nil {
		return nil, err
	}
	goAPI, err := r.Resources.String("GoApi", "url")
	if err != nil {
		return nil, err
	}
	return append(baseEnviron(),
		"CLERK_FE_DOMAIN="+clerkFeDomain,
		"NOTIFY_IG_POSTS_VIEW_URL="+goAPI+"notify",
		"RENDER_MD_URL="+goAPI+"renderMd",
		"NOTIFY_SECRET="+notifySecret,
	), nil
}

func (r *ResetService) output() io.Writer {
	if r.Out != nil {
		return r.Out
	}
	return io.Discard
}

func baseEnviron() []string { return os.Environ() }
