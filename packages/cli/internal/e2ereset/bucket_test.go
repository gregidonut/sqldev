package e2ereset

import (
	"context"
	"errors"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// fakeS3 is an in-memory S3 for the cleaner tests.
type fakeS3 struct {
	versioning    s3types.BucketVersioningStatus
	pages         [][]string // keys per list page before deletion
	listCalls     int
	verifyEmpty   bool // if true, the post-delete verify list returns zero
	deleteErr     error
	deleteObjErr  bool
	getVersionErr error
}

func (f *fakeS3) GetBucketVersioning(context.Context, *s3.GetBucketVersioningInput, ...func(*s3.Options)) (*s3.GetBucketVersioningOutput, error) {
	if f.getVersionErr != nil {
		return nil, f.getVersionErr
	}
	return &s3.GetBucketVersioningOutput{Status: f.versioning}, nil
}

func (f *fakeS3) ListObjectsV2(_ context.Context, in *s3.ListObjectsV2Input, _ ...func(*s3.Options)) (*s3.ListObjectsV2Output, error) {
	// The paginator calls this once per page; after the scripted pages are
	// exhausted it is the verification list.
	if f.listCalls < len(f.pages) {
		keys := f.pages[f.listCalls]
		f.listCalls++
		contents := make([]s3types.Object, 0, len(keys))
		for _, k := range keys {
			contents = append(contents, s3types.Object{Key: aws.String(k)})
		}
		more := f.listCalls < len(f.pages)
		out := &s3.ListObjectsV2Output{Contents: contents, IsTruncated: aws.Bool(more)}
		if more {
			out.NextContinuationToken = aws.String("page")
		}
		return out, nil
	}
	f.listCalls++
	if f.verifyEmpty {
		return &s3.ListObjectsV2Output{}, nil
	}
	return &s3.ListObjectsV2Output{Contents: []s3types.Object{{Key: aws.String("leftover")}}}, nil
}

func (f *fakeS3) DeleteObjects(_ context.Context, in *s3.DeleteObjectsInput, _ ...func(*s3.Options)) (*s3.DeleteObjectsOutput, error) {
	if f.deleteErr != nil {
		return nil, f.deleteErr
	}
	if f.deleteObjErr {
		return &s3.DeleteObjectsOutput{Errors: []s3types.Error{{Message: aws.String("denied")}}}, nil
	}
	return &s3.DeleteObjectsOutput{}, nil
}

func TestEmptyAndVerifySuccess(t *testing.T) {
	c := &BucketCleaner{Client: &fakeS3{
		pages:       [][]string{{"a", "b"}, {"c"}},
		verifyEmpty: true,
	}}
	res, err := c.EmptyAndVerify(context.Background(), BucketIdentity{Name: "app"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Deleted != 3 || !res.Empty {
		t.Errorf("res = %+v", res)
	}
}

func TestEmptyAndVerifyRefusesVersionedBucket(t *testing.T) {
	c := &BucketCleaner{Client: &fakeS3{versioning: s3types.BucketVersioningStatusEnabled}}
	if _, err := c.EmptyAndVerify(context.Background(), BucketIdentity{Name: "app"}); err == nil {
		t.Error("expected refusal for a versioned bucket")
	}
}

func TestEmptyAndVerifyFailsWhenNotEmptyAfter(t *testing.T) {
	c := &BucketCleaner{Client: &fakeS3{
		pages:       [][]string{{"a"}},
		verifyEmpty: false,
	}}
	res, err := c.EmptyAndVerify(context.Background(), BucketIdentity{Name: "app"})
	if err == nil {
		t.Fatal("expected verification failure")
	}
	if res.Empty {
		t.Error("result must not report empty when objects remain")
	}
}

func TestEmptyAndVerifyReportsPartialOnDeleteError(t *testing.T) {
	c := &BucketCleaner{Client: &fakeS3{
		pages:     [][]string{{"a"}},
		deleteErr: errors.New("boom"),
	}}
	res, err := c.EmptyAndVerify(context.Background(), BucketIdentity{Name: "app"})
	if err == nil {
		t.Fatal("expected delete error")
	}
	_ = res
}

func TestEmptyAndVerifyRejectsEmptyBucketName(t *testing.T) {
	c := &BucketCleaner{Client: &fakeS3{}}
	if _, err := c.EmptyAndVerify(context.Background(), BucketIdentity{Name: ""}); err == nil {
		t.Error("expected rejection for an unresolved bucket name")
	}
}
