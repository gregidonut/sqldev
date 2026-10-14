package e2ereset

import (
	"context"
	"errors"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
)

const deleteBatchSize = 1000

// BucketResult reports the outcome of the application-bucket phase.
type BucketResult struct {
	Deleted int
	Empty   bool
}

// S3API is the subset of the S3 client the cleaner uses, so tests can fake it.
type S3API interface {
	ListObjectsV2(ctx context.Context, in *s3.ListObjectsV2Input, opts ...func(*s3.Options)) (*s3.ListObjectsV2Output, error)
	DeleteObjects(ctx context.Context, in *s3.DeleteObjectsInput, opts ...func(*s3.Options)) (*s3.DeleteObjectsOutput, error)
	GetBucketVersioning(ctx context.Context, in *s3.GetBucketVersioningInput, opts ...func(*s3.Options)) (*s3.GetBucketVersioningOutput, error)
}

// BucketCleaner empties exactly one application bucket and verifies emptiness.
// It never targets the job-result bucket; the plan guarantees they differ.
type BucketCleaner struct {
	Client S3API
}

// EmptyAndVerify deletes every object in the application bucket, then lists it
// again and requires zero objects. It refuses a versioned bucket, because this
// application bucket is not a versioned retention store and a plain empty would
// leave hidden versions. Partial deletion is reported, never silently rolled
// back (S3 deletion is not transactional).
func (c *BucketCleaner) EmptyAndVerify(ctx context.Context, bucket BucketIdentity) (BucketResult, error) {
	if bucket.Name == "" {
		return BucketResult{}, errors.New("application bucket is unresolved")
	}

	ver, err := c.Client.GetBucketVersioning(ctx, &s3.GetBucketVersioningInput{
		Bucket: aws.String(bucket.Name),
	})
	if err != nil {
		return BucketResult{}, errors.New("could not read application bucket versioning")
	}
	if ver.Status == s3types.BucketVersioningStatusEnabled {
		return BucketResult{}, errors.New("refusing to empty a versioned application bucket")
	}

	deleted := 0
	paginator := s3.NewListObjectsV2Paginator(c.Client, &s3.ListObjectsV2Input{
		Bucket: aws.String(bucket.Name),
	})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return BucketResult{Deleted: deleted}, errors.New("could not list the application bucket")
		}
		objects := make([]s3types.ObjectIdentifier, 0, len(page.Contents))
		for _, obj := range page.Contents {
			if obj.Key != nil {
				objects = append(objects, s3types.ObjectIdentifier{Key: obj.Key})
			}
		}
		for start := 0; start < len(objects); start += deleteBatchSize {
			end := start + deleteBatchSize
			if end > len(objects) {
				end = len(objects)
			}
			batch := objects[start:end]
			out, err := c.Client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
				Bucket: aws.String(bucket.Name),
				Delete: &s3types.Delete{Objects: batch, Quiet: aws.Bool(true)},
			})
			if err != nil {
				return BucketResult{Deleted: deleted}, errors.New("application bucket delete failed")
			}
			if len(out.Errors) > 0 {
				return BucketResult{Deleted: deleted}, errors.New("application bucket delete reported object errors")
			}
			deleted += len(batch)
		}
	}

	// Verify zero objects remain.
	verify, err := c.Client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
		Bucket: aws.String(bucket.Name),
	})
	if err != nil {
		return BucketResult{Deleted: deleted}, errors.New("could not verify the application bucket is empty")
	}
	remaining := len(verify.Contents)
	if remaining > 0 {
		return BucketResult{Deleted: deleted, Empty: false}, errors.New("application bucket still contains objects after cleanup")
	}
	return BucketResult{Deleted: deleted, Empty: true}, nil
}
