// Package storage ports the former packages/core S3 helpers: emptying the
// linked SQLDevBucket and deleting a specific set of object keys. The exact
// deduplication, batching, and production-safety behavior is preserved.
package storage

import (
	"context"
	"errors"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// deleteBatchSize is the DeleteObjects maximum from the original helper.
const deleteBatchSize = 1000

// AssertNotProduction mirrors the original S3 guard: it refuses only the exact
// stages "prod" and "production".
func AssertNotProduction(stage string) error {
	if stage == "production" || stage == "prod" {
		return errors.New("refusing to modify SQLDevBucket on production")
	}
	return nil
}

// S3API is the subset of the S3 client the storage operations use, so tests can
// substitute a fake.
type S3API interface {
	ListObjectsV2(ctx context.Context, in *s3.ListObjectsV2Input, opts ...func(*s3.Options)) (*s3.ListObjectsV2Output, error)
	DeleteObjects(ctx context.Context, in *s3.DeleteObjectsInput, opts ...func(*s3.Options)) (*s3.DeleteObjectsOutput, error)
}

// Service performs bucket operations against a bucket using an S3 client.
type Service struct {
	Client S3API
	Bucket string
}

// NewService builds a Service with a real S3 client configured for region.
func NewService(ctx context.Context, bucket, region string) (*Service, error) {
	cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(region))
	if err != nil {
		return nil, err
	}
	return &Service{Client: s3.NewFromConfig(cfg), Bucket: bucket}, nil
}

// DeleteObjectKeys deletes the given keys, preserving the original helper's
// semantics: drop empty keys, deduplicate preserving first-seen order, return
// zero without calling AWS when nothing remains, delete in batches of 1000 with
// Quiet set, and fail on the first per-object error. The returned count is the
// number of unique non-empty keys requested, matching the original.
func (s *Service) DeleteObjectKeys(ctx context.Context, keys []string) (int, error) {
	unique := dedupeNonEmpty(keys)
	if len(unique) == 0 {
		return 0, nil
	}
	deleted := 0
	for start := 0; start < len(unique); start += deleteBatchSize {
		end := start + deleteBatchSize
		if end > len(unique) {
			end = len(unique)
		}
		batch := unique[start:end]
		objects := make([]s3types.ObjectIdentifier, len(batch))
		for i, key := range batch {
			objects[i] = s3types.ObjectIdentifier{Key: aws.String(key)}
		}
		out, err := s.Client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: aws.String(s.Bucket),
			Delete: &s3types.Delete{Objects: objects, Quiet: aws.Bool(true)},
		})
		if err != nil {
			return deleted, err
		}
		if len(out.Errors) > 0 {
			return deleted, firstDeleteError(out.Errors)
		}
		deleted += len(objects)
	}
	return deleted, nil
}

// EmptyBucket paginates the bucket and deletes every current object. It
// preserves the original batching and first-error behavior.
func (s *Service) EmptyBucket(ctx context.Context) (int, error) {
	deleted := 0
	paginator := s3.NewListObjectsV2Paginator(s.Client, &s3.ListObjectsV2Input{
		Bucket: aws.String(s.Bucket),
	})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return deleted, err
		}
		objects := make([]s3types.ObjectIdentifier, 0, len(page.Contents))
		for _, obj := range page.Contents {
			if obj.Key != nil {
				objects = append(objects, s3types.ObjectIdentifier{Key: obj.Key})
			}
		}
		if len(objects) == 0 {
			continue
		}
		out, err := s.Client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: aws.String(s.Bucket),
			Delete: &s3types.Delete{Objects: objects, Quiet: aws.Bool(true)},
		})
		if err != nil {
			return deleted, err
		}
		if len(out.Errors) > 0 {
			return deleted, firstDeleteError(out.Errors)
		}
		deleted += len(objects)
	}
	return deleted, nil
}

func dedupeNonEmpty(keys []string) []string {
	seen := make(map[string]struct{}, len(keys))
	out := make([]string, 0, len(keys))
	for _, key := range keys {
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, key)
	}
	return out
}

func firstDeleteError(errs []s3types.Error) error {
	first := errs[0]
	if first.Message != nil && *first.Message != "" {
		return errors.New(*first.Message)
	}
	return fmt.Errorf("DeleteObjects failed")
}
