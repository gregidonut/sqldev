package e2ereset

import (
	"context"
	"fmt"
	"io"

	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/gregidonut/sqldev/packages/cli/internal/process"
)

// Options configures a reset run.
type Options struct {
	ConfiguredStage string
	Region          string
	Resources       ResourceReader
	Runner          process.Runner
	Preflight       bool
	Stdout          io.Writer
}

// Run performs the full exact-staging reset (or just preflight). It resolves
// linked values, discovers the unique staging host, validates the plan, and —
// unless Preflight — quiesces the worker, runs the audited SQL, empties the
// application bucket, and restarts the worker.
func Run(ctx context.Context, opts Options) error {
	inputs, err := StaticInputsFromResources(opts.ConfiguredStage, opts.Resources)
	if err != nil {
		return err
	}

	discoverer := &HostDiscoverer{Runner: opts.Runner, Region: opts.Region}
	host, err := discoverer.ResolveStagingHost(ctx, inputs.AppName)
	if err != nil {
		return err
	}
	inputs.Host = host
	inputs.Region = opts.Region

	plan, err := BuildResetPlan(inputs)
	if err != nil {
		return err
	}

	executor := NewHostExecutor(opts.Runner, opts.Region)

	// Harmless identity probe confirms SSM reachability and that the host's
	// own view agrees with the plan before any mutation.
	hostID, err := executor.ProbeIdentity(ctx, plan.Host.InstanceID)
	if err != nil {
		return err
	}
	if hostID.Stage != plan.Stage || hostID.AppName != plan.AppName || hostID.AppBucket != plan.Application.Name {
		return fmt.Errorf("staging host identity disagrees with the linked plan")
	}

	if opts.Preflight {
		fmt.Fprintf(opts.Stdout, "preflight ok: stage=%s origin=%s host=%s\n",
			plan.Stage, plan.ExpectedOrigin, plan.Host.InstanceID)
		return nil
	}

	cleaner, err := newBucketCleaner(ctx, opts.Region)
	if err != nil {
		return err
	}

	svc := &Service{Host: executor, Bucket: cleaner}
	res, err := svc.Execute(ctx, plan)
	report(opts.Stdout, res)
	return err
}

func newBucketCleaner(ctx context.Context, region string) (*BucketCleaner, error) {
	cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(region))
	if err != nil {
		return nil, err
	}
	return &BucketCleaner{Client: s3.NewFromConfig(cfg)}, nil
}

// ensure stdout nil-safety for the report path.
func report(w io.Writer, res ResetResult) {
	if w == nil {
		return
	}
	fmt.Fprintf(w, "reset: db_committed=%t bucket_deleted=%d bucket_empty=%t worker_restarted=%t\n",
		res.DatabaseCommitted, res.BucketDeleted, res.BucketEmptied, res.WorkerRestarted)
}
