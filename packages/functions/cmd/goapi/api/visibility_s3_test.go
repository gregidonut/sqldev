package api

import (
	"context"
	"encoding/json"
	"io"
	"math/rand"
	"sync/atomic"
	"testing"
	"testing/quick"

	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/s3store"
	"github.com/gregidonut/sqldev/packages/functions/internal/jobs"
	"github.com/gregidonut/sqldev/packages/functions/internal/queue"
)

// recordingObjects counts every call of every method. Visibility is an
// application-level flag; it must never reach S3 in any form (object ACL,
// bucket policy, copy, delete, presign, or even a read).
type recordingObjects struct{ calls atomic.Int64 }

func (r *recordingObjects) hit() { r.calls.Add(1) }

func (r *recordingObjects) BucketExists(context.Context, string) (bool, error) {
	r.hit()
	return true, nil
}
func (r *recordingObjects) Upload(context.Context, string, string, io.Reader, int64) error {
	r.hit()
	return nil
}
func (r *recordingObjects) Open(context.Context, string, string) (s3store.Opened, error) {
	r.hit()
	return s3store.Opened{}, nil
}
func (r *recordingObjects) Delete(context.Context, string, string, string, bool) error {
	r.hit()
	return nil
}
func (r *recordingObjects) DeleteMany(context.Context, string, []string, bool) error {
	r.hit()
	return nil
}
func (r *recordingObjects) Copy(context.Context, string, string, string, string) error {
	r.hit()
	return nil
}
func (r *recordingObjects) Exists(context.Context, string, string) (bool, error) {
	r.hit()
	return true, nil
}
func (r *recordingObjects) PresignPut(context.Context, string, string) (string, error) {
	r.hit()
	return "", nil
}
func (r *recordingObjects) PresignGet(context.Context, string, string) (string, error) {
	r.hit()
	return "", nil
}

func TestVisibilityChangesNeverTouchS3(t *testing.T) {
	t.Run("Feature: storage-visibility-confirmation, Property 13: Visibility changes preserve S3 state", func(t *testing.T) {
		results := []string{requiredResult, changedResult, rejectedResult,
			`{"kind":"rejected","reason":"expired_challenge"}`, `{"kind":"mystery"}`}
		check := func(seed int64) bool {
			rng := rand.New(rand.NewSource(seed))
			objects := &recordingObjects{}
			db := &fakeDB{rpcBody: json.RawMessage(results[rng.Intn(len(results))])}
			if rng.Intn(5) == 0 {
				db = &fakeDB{rpcErr: io.ErrUnexpectedEOF}
			}
			server := testServer(t, db, &fakeObjects{}, queue.NewMemory())
			server.Objects = objects

			var envelope jobs.Envelope
			switch rng.Intn(3) {
			case 0:
				envelope = executeEnvelope(jobs.KindSetStorageVisibility, setPublicPayload)
			case 1:
				envelope = executeEnvelope(jobs.KindSetStorageVisibility, setPrivatePayload)
			default:
				envelope = executeEnvelope(jobs.KindConfirmOperation, confirmJobPayload)
			}
			if _, err := server.Execute(jobContext(), envelope); err != nil {
				t.Errorf("seed %d: %v", seed, err)
				return false
			}
			if calls := objects.calls.Load(); calls != 0 {
				t.Errorf("seed %d: %s made %d S3 call(s), want 0", seed, envelope.Kind, calls)
				return false
			}
			return true
		}
		if err := quick.Check(check, &quick.Config{MaxCount: 200}); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("the HTTP handlers do not touch S3 either", func(t *testing.T) {
		objects := &recordingObjects{}
		server := testServer(t, &fakeDB{}, &fakeObjects{}, queue.NewMemory())
		server.Objects = objects
		requestWithKey(t, server, visibilityPathFor, testJWT, "a", visibilityBody("public", 1))
		requestWithKey(t, server, visibilityPathFor, testJWT, "b", visibilityBody("private", 1))
		requestWithKey(t, server, "/api/confirmations", testJWT, "c", confirmBody(1))
		if calls := objects.calls.Load(); calls != 0 {
			t.Fatalf("handlers made %d S3 call(s)", calls)
		}
	})
}
