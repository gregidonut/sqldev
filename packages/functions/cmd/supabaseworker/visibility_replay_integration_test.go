//go:build integration

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/dbos-inc/dbos-transact-golang/dbos"

	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/api"
	"github.com/gregidonut/sqldev/packages/functions/internal/jobs"
	"github.com/gregidonut/sqldev/packages/functions/internal/queue"
	"github.com/gregidonut/sqldev/packages/functions/internal/worker"
)

// replay posts the same request k times, delivers every message, waits for the
// one job, and returns its id. The bursts are optionally delivered concurrently.
func (r *rig) replay(o owner, path, key, body string, k int, concurrent bool) string {
	r.t.Helper()
	first := receiptID(r.t, r.post(o, path, key, body))
	for i := 1; i < k; i++ {
		if id := receiptID(r.t, r.post(o, path, key, body)); id != first {
			r.t.Fatalf("replay %d got job %s, want the same job %s", i, id, first)
		}
	}
	r.deliver(concurrent)
	r.wait(first)
	return first
}

func (r *rig) assertConflictBeforeQueue(o owner, path, key, changed string, before dbState) {
	r.t.Helper()
	sent := len(r.messages.Sent())
	response := r.post(o, path, key, changed)
	if response.Code != http.StatusConflict {
		r.t.Fatalf("a conflicting replay: status = %d body %s", response.Code, response.Body.String())
	}
	var body api.OperationRejectedResult
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || body.Reason != api.RejectionReasonIdempotencyConflict {
		r.t.Fatalf("conflict body = %s (%v)", response.Body.String(), err)
	}
	if got := len(r.messages.Sent()); got != sent {
		r.t.Fatalf("a conflicting replay queued %d message(s)", got-sent)
	}
	if after := r.state(o); after != before {
		r.t.Fatalf("a conflicting replay changed the database: %+v -> %+v", before, after)
	}
}

func TestIdempotentReplayHasAtMostOnceEffects(t *testing.T) {
	propertyTag(t, 8, "Idempotent replay has at-most-once effects", func(t *testing.T) {
		r := newRig(t)
		for i := 0; i < 36; i++ {
			seed := int64(8000 + i)
			rng := rand.New(rand.NewSource(seed))
			family := []string{"initiate", "confirm", "private"}[i%3]
			k := 2 + rng.Intn(4)
			concurrent := rng.Intn(2) == 0
			expired := rng.Intn(2) == 0
			label := fmt.Sprintf("seed %d family %s k=%d concurrent=%v expired=%v", seed, family, k, concurrent, expired)

			o := r.newOwner()
			var path, key, body, changed string
			var effectRows, effectChallenges, effectConsumed int

			switch family {
			case "initiate":
				path, key, body = r.visibilityPath(), "init-"+o.Sub, r.visibilityBody(o, "public", 1)
				changed = r.visibilityBody(o, "public", 2)
				effectRows, effectChallenges, effectConsumed = 1, 1, 0
			case "confirm":
				_, challenge := r.initiate(o, "setup-"+o.Sub, 1)
				path, key, body = "/api/confirmations", "confirm-"+o.Sub, r.confirmBody(o, challenge, 1)
				changed = strings.Replace(body, `"expectedRevision":1`, `"expectedRevision":2`, 1)
				effectRows, effectChallenges, effectConsumed = 2, 1, 1
			default:
				_, challenge := r.initiate(o, "setup-"+o.Sub, 1)
				done := receiptID(t, r.post(o, "/api/confirmations", "setup-confirm-"+o.Sub, r.confirmBody(o, challenge, 1)))
				r.deliver(false)
				r.wait(done)
				path, key, body = r.visibilityPath(), "private-"+o.Sub, r.visibilityBody(o, "private", 2)
				changed = r.visibilityBody(o, "private", 3)
				effectRows, effectChallenges, effectConsumed = 3, 1, 1
			}

			// Burst: k identical submissions, delivered sequentially or concurrently.
			jobID := r.replay(o, path, key, body, k, concurrent)
			want := r.result(o, jobID)
			if got := r.state(o); got.rows != effectRows || got.challenges != effectChallenges || got.consumed != effectConsumed {
				t.Fatalf("%s: after the burst %+v, want rows=%d challenges=%d consumed=%d", label, got, effectRows, effectChallenges, effectConsumed)
			}
			settled := r.state(o)

			// Late replays after completion observe the identical terminal result.
			r.replay(o, path, key, body, k, concurrent)
			if got := r.result(o, jobID); got != want {
				t.Fatalf("%s: a late replay changed the result:\n  %s\n  %s", label, want, got)
			}
			if got := r.state(o); got != settled {
				t.Fatalf("%s: a late replay had an effect: %+v -> %+v", label, settled, got)
			}

			if !expired {
				// While the record exists, a changed body is refused before the queue.
				r.assertConflictBeforeQueue(o, path, key, changed, settled)
				continue
			}

			// The status record expires (24h TTL) but DBOS keeps its workflow row.
			r.expireJobRecords()
			again := r.replay(o, path, key, body, k, concurrent)
			if again != jobID {
				t.Fatalf("%s: the job id changed after the record was recreated", label)
			}
			if got := r.result(o, again); got != want {
				t.Fatalf("%s: a recreated record did not get the recorded result:\n  %s\n  %s", label, want, got)
			}
			if got := r.state(o); got != settled {
				t.Fatalf("%s: a replay after expiry had an effect: %+v -> %+v", label, settled, got)
			}

			// A changed body under the same key surfaces as a completed idempotency conflict.
			r.expireJobRecords()
			conflictJob := receiptID(t, r.post(o, path, key, changed))
			r.deliver(false)
			r.wait(conflictJob)
			conflict := decodeMap(t, r.result(o, conflictJob))
			if conflict["kind"] != "rejected" || conflict["reason"] != "idempotency_conflict" {
				t.Fatalf("%s: a conflicting replay after expiry = %v", label, conflict)
			}
			if got := r.state(o); got != settled {
				t.Fatalf("%s: a conflicting replay after expiry had an effect: %+v -> %+v", label, settled, got)
			}
		}
	})
}

// idleInTransaction counts this rig's connections sitting inside an open transaction.
func (r *rig) idleInTransaction() int {
	r.t.Helper()
	var n int
	err := r.pool.QueryRow(context.Background(), `
		SELECT count(*) FROM pg_stat_activity
		WHERE application_name = $1 AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%'`, r.appName).Scan(&n)
	if err != nil {
		r.t.Fatal(err)
	}
	return n
}

func (r *rig) workflowState(jobID string) dbos.WorkflowStatusType {
	r.t.Helper()
	handle, err := dbos.RetrieveWorkflow[jobs.Outcome](r.proc.dbos, jobID)
	if err != nil {
		r.t.Fatalf("workflow %s: %v", jobID, err)
	}
	current, err := handle.GetStatus()
	if err != nil {
		r.t.Fatal(err)
	}
	return current.Status
}

func TestInitiationHoldsNothingWhileTheUserDecides(t *testing.T) {
	propertyTag(t, 10, "Initiation has no user-waiting backend state", func(t *testing.T) {
		t.Run("the workflow ends, the transaction closes, and the message is acknowledged", func(t *testing.T) {
			r := newRig(t)
			o := r.newOwner()
			jobID := receiptID(t, r.post(o, r.visibilityPath(), "k", r.visibilityBody(o, "public", 1)))

			// Run the real poll loop until it has deleted the message.
			ctx, cancel := context.WithCancel(context.Background())
			done := make(chan error, 1)
			go func() { done <- worker.Poll(ctx, r.messages, r.proc) }()
			deadline := time.Now().Add(20 * time.Second)
			for len(r.messages.Deleted()) < 1 && time.Now().Before(deadline) {
				time.Sleep(10 * time.Millisecond)
			}
			cancel()
			if err := <-done; !errors.Is(err, context.Canceled) {
				t.Fatalf("poll stopped with %v", err)
			}
			if len(r.messages.Deleted()) != 1 {
				t.Fatalf("deleted = %d, want the single initiation message acknowledged", len(r.messages.Deleted()))
			}
			if _, err := r.messages.Receive(context.Background()); !errors.Is(err, queue.ErrEmpty) {
				t.Fatalf("a message is still in flight: %v", err)
			}

			record := r.wait(jobID)
			if record.Status != "completed" || decodeMap(t, r.result(o, jobID))["kind"] != "confirmation_required" {
				t.Fatalf("record = %+v", record)
			}
			if state := r.workflowState(jobID); state != dbos.WorkflowStatusSuccess {
				t.Fatalf("workflow state = %s, want SUCCESS", state)
			}
			if n := r.idleInTransaction(); n != 0 {
				t.Fatalf("%d connection(s) idle in transaction after the initiation finished", n)
			}
		})

		t.Run("an unrelated job completes while a challenge is unanswered", func(t *testing.T) {
			r := newRig(t)
			slow, other := r.newOwner(), r.newOwner()
			_, challenge := r.initiate(slow, "slow", 1)
			time.Sleep(300 * time.Millisecond) // the user is thinking

			start := time.Now()
			second := receiptID(t, r.post(other, r.visibilityPath(), "other", r.visibilityBody(other, "public", 1)))
			r.deliver(false)
			r.wait(second)
			if elapsed := time.Since(start); elapsed > 5*time.Second {
				t.Fatalf("an unrelated job took %v while a challenge was open", elapsed)
			}
			if got := decodeMap(t, r.result(other, second)); got["kind"] != "confirmation_required" {
				t.Fatalf("other result = %v", got)
			}
			var state string
			if err := r.pool.QueryRow(context.Background(), `SELECT state::text FROM public.app_confirmation_challenges WHERE challenge_id = $1`, challenge["challengeId"]).Scan(&state); err != nil || state != "active" {
				t.Fatalf("the unanswered challenge is %s (%v), want active", state, err)
			}
			if n := r.idleInTransaction(); n != 0 {
				t.Fatalf("%d connection(s) idle in transaction", n)
			}
		})

		t.Run("confirming is a second, separate workflow", func(t *testing.T) {
			r := newRig(t)
			o := r.newOwner()
			initiation, challenge := r.initiate(o, "first", 1)
			confirmation := receiptID(t, r.post(o, "/api/confirmations", "second", r.confirmBody(o, challenge, 1)))
			if confirmation == initiation {
				t.Fatal("initiation and confirmation must be different jobs")
			}
			r.deliver(false)
			r.wait(confirmation)
			if got := decodeMap(t, r.result(o, confirmation)); got["kind"] != "visibility_changed" {
				t.Fatalf("confirmation result = %v", got)
			}
			for _, id := range []string{initiation, confirmation} {
				if state := r.workflowState(id); state != dbos.WorkflowStatusSuccess {
					t.Fatalf("workflow %s is %s, want SUCCESS", id, state)
				}
			}
			if n := r.idleInTransaction(); n != 0 {
				t.Fatalf("%d connection(s) idle in transaction", n)
			}
		})
	})
}
