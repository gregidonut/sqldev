// Package dev ports the local development services: the Supabase worker and the
// local Imagor container. Both reproduce the exact environment and arguments
// the former scripts used.
package dev

import (
	"context"
	"os"

	"github.com/gregidonut/sqldev/packages/cli/internal/process"
	"github.com/gregidonut/sqldev/packages/cli/internal/sst"
)

// VIPSMaxResolution must stay in step with
// packages/backend/selfhost/bootstrap.sh. The imagor deploy_test.sh asserts
// this literal is present in this file.
const VIPSMaxResolution = "VIPS_MAX_RESOLUTION=67108864"

// RunWorker runs `go run ./cmd/supabaseworker` from the functions directory
// with the linked job resources, reproducing packages/scripts/src/worker.
func RunWorker(ctx context.Context, runner process.Runner, res sst.Resources, functionsDir, stage string) error {
	bucket, err := res.String("SQLDevBucket", "name")
	if err != nil {
		return err
	}
	queueURL, err := res.String("JobQueueUrl", "url")
	if err != nil {
		return err
	}
	tableName, err := res.String("JobStatusName", "name")
	if err != nil {
		return err
	}
	resultBucket, err := res.String("JobResultBucketName", "name")
	if err != nil {
		return err
	}

	env := append(os.Environ(),
		kv("CGO_ENABLED", envOr("CGO_ENABLED", "0")),
		kv("AWS_REGION", envOr("AWS_REGION", "ap-east-1")),
		kv("APP_NAME", envOr("APP_NAME", "sqldev")),
		kv("APP_STAGE", stageOr(stage)),
		kv("JOB_QUEUE_URL", queueURL),
		kv("JOB_TABLE_NAME", tableName),
		kv("JOB_RESULT_BUCKET", resultBucket),
		kv("APP_BUCKET", bucket),
		kv("IMAGOR_URL", envOr("IMAGOR_URL", "http://127.0.0.1:8000")),
		kv("PROGRESS_URL", envOr("PROGRESS_URL", "http://127.0.0.1:8000")),
		kv("IMAGOR_SECRET", envOrNonEmpty("IMAGOR_SECRET", "local-dev-secret")),
		kv("DBOS_SYSTEM_DATABASE_URL", envOr("DBOS_SYSTEM_DATABASE_URL",
			"postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable")),
	)

	return runner.Run(ctx, process.RunRequest{
		Program: "go",
		Args:    []string{"run", "./cmd/supabaseworker"},
		Dir:     functionsDir,
		Env:     env,
	})
}

// RunImagor removes any existing container then runs the local Imagor image,
// reproducing packages/scripts/src/imagor. The container env list is identical,
// including VIPS_MAX_RESOLUTION and FFMPEG_MAX_ANIMATION_FRAMES.
func RunImagor(ctx context.Context, runner process.Runner, res sst.Resources, image string) error {
	bucket, err := res.String("SQLDevBucket", "name")
	if err != nil {
		return err
	}
	if image == "" {
		image = envOrNonEmpty("IMAGOR_IMAGE", "sqldev-imagor:test")
	}
	secret := envOrNonEmpty("IMAGOR_SECRET", "local-dev-secret")

	envArgs := []string{
		"SERVER_ADDRESS=0.0.0.0",
		"PORT=8000",
		"IMAGOR_SECRET=" + secret,
		"IMAGOR_SIGNER_TYPE=sha256",
		"IMAGOR_SIGNER_TRUNCATE=40",
		"IMAGOR_DISABLE_PARAMS_ENDPOINT=1",
		"HTTP_LOADER_DISABLE=1",
		"FFMPEG_MAX_ANIMATION_FRAMES=18",
		// Keep in step with VIPS_MAX_RESOLUTION in packages/backend/selfhost/bootstrap.sh.
		VIPSMaxResolution,
		"AWS_REGION=ap-east-1",
		"S3_LOADER_BUCKET=" + bucket,
		"S3_SAFE_CHARS=--",
	}
	for _, name := range []string{"AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"} {
		if value := os.Getenv(name); value != "" {
			envArgs = append(envArgs, name+"="+value)
		}
	}

	// Best-effort removal of a previous container; ignore its failure, exactly
	// as the original `docker rm -f` did before starting.
	_ = runner.Run(ctx, process.RunRequest{
		Program: "docker",
		Args:    []string{"rm", "-f", "sqldev-imagor"},
	})

	args := []string{"run", "--rm", "--name", "sqldev-imagor", "-p", "127.0.0.1:8000:8000"}
	for _, entry := range envArgs {
		args = append(args, "-e", entry)
	}
	args = append(args, image)

	return runner.Run(ctx, process.RunRequest{Program: "docker", Args: args})
}

func kv(key, value string) string { return key + "=" + value }

// envOr returns the current value of key, or fallback when it is unset.
func envOr(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}

// envOrNonEmpty returns the current value of key only when it is non-empty,
// matching the `||` defaulting the original scripts used for secrets.
func envOrNonEmpty(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func stageOr(stage string) string {
	if stage != "" {
		return stage
	}
	return envOr("STAGE", envOr("SST_STAGE", "dev"))
}
