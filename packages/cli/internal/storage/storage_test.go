package storage

import (
	"context"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
)

func TestAssertNotProduction(t *testing.T) {
	for _, stage := range []string{"prod", "production"} {
		if err := AssertNotProduction(stage); err == nil {
			t.Errorf("stage %q should be refused", stage)
		}
	}
	for _, stage := range []string{"dev", "staging", "local", "development", ""} {
		if err := AssertNotProduction(stage); err != nil {
			t.Errorf("stage %q should be allowed, got %v", stage, err)
		}
	}
}

// fakeS3 records DeleteObjects batches and returns a scripted ListObjectsV2.
type fakeS3 struct {
	batches [][]string
	errs    []s3types.Error
	pages   [][]string
}

func (f *fakeS3) DeleteObjects(_ context.Context, in *s3.DeleteObjectsInput, _ ...func(*s3.Options)) (*s3.DeleteObjectsOutput, error) {
	var keys []string
	for _, obj := range in.Delete.Objects {
		keys = append(keys, *obj.Key)
	}
	f.batches = append(f.batches, keys)
	if in.Delete.Quiet == nil || !*in.Delete.Quiet {
		panic("DeleteObjects must set Quiet=true")
	}
	return &s3.DeleteObjectsOutput{Errors: f.errs}, nil
}

func (f *fakeS3) ListObjectsV2(_ context.Context, _ *s3.ListObjectsV2Input, _ ...func(*s3.Options)) (*s3.ListObjectsV2Output, error) {
	// Not used by DeleteObjectKeys tests.
	return &s3.ListObjectsV2Output{}, nil
}

func TestDeleteObjectKeysDedupesAndDropsEmpty(t *testing.T) {
	fake := &fakeS3{}
	svc := &Service{Client: fake, Bucket: "b"}
	deleted, err := svc.DeleteObjectKeys(context.Background(),
		[]string{"a", "", "b", "a", "c", "b", ""})
	if err != nil {
		t.Fatal(err)
	}
	if deleted != 3 {
		t.Errorf("deleted = %d, want 3", deleted)
	}
	if len(fake.batches) != 1 {
		t.Fatalf("batches = %d, want 1", len(fake.batches))
	}
	got := fake.batches[0]
	want := []string{"a", "b", "c"} // first-seen order preserved
	if len(got) != len(want) {
		t.Fatalf("batch = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("batch = %v, want %v", got, want)
		}
	}
}

func TestDeleteObjectKeysEmptyMakesNoCall(t *testing.T) {
	fake := &fakeS3{}
	svc := &Service{Client: fake, Bucket: "b"}
	deleted, err := svc.DeleteObjectKeys(context.Background(), []string{"", ""})
	if err != nil {
		t.Fatal(err)
	}
	if deleted != 0 {
		t.Errorf("deleted = %d, want 0", deleted)
	}
	if len(fake.batches) != 0 {
		t.Errorf("expected no DeleteObjects calls, got %d", len(fake.batches))
	}
}

func TestDeleteObjectKeysBatchesAt1000(t *testing.T) {
	fake := &fakeS3{}
	svc := &Service{Client: fake, Bucket: "b"}
	keys := make([]string, 2300)
	for i := range keys {
		keys[i] = key(i)
	}
	deleted, err := svc.DeleteObjectKeys(context.Background(), keys)
	if err != nil {
		t.Fatal(err)
	}
	if deleted != 2300 {
		t.Errorf("deleted = %d, want 2300", deleted)
	}
	wantSizes := []int{1000, 1000, 300}
	if len(fake.batches) != len(wantSizes) {
		t.Fatalf("batches = %d, want %d", len(fake.batches), len(wantSizes))
	}
	for i, size := range wantSizes {
		if len(fake.batches[i]) != size {
			t.Errorf("batch %d size = %d, want %d", i, len(fake.batches[i]), size)
		}
	}
}

func TestDeleteObjectKeysFailsOnFirstError(t *testing.T) {
	msg := "AccessDenied"
	fake := &fakeS3{errs: []s3types.Error{{Message: &msg}}}
	svc := &Service{Client: fake, Bucket: "b"}
	_, err := svc.DeleteObjectKeys(context.Background(), []string{"a"})
	if err == nil || err.Error() != msg {
		t.Fatalf("error = %v, want %q", err, msg)
	}
}

func key(i int) string {
	const digits = "0123456789"
	s := ""
	n := i
	for {
		s = string(digits[n%10]) + s
		n /= 10
		if n == 0 {
			break
		}
	}
	return "k" + s
}
