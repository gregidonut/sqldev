package main

import (
	"errors"
	"testing"
	"time"

	"github.com/dbos-inc/dbos-transact-golang/dbos"
	"github.com/gregidonut/sqldev/packages/functions/internal/imagor"
	"github.com/gregidonut/sqldev/packages/functions/internal/jobs"
	"github.com/gregidonut/sqldev/packages/functions/internal/status"
)

func TestImageOutcomeSkipsRenderAfterAuthorizationFailure(t *testing.T) {
	called := false
	outcome, err := imageOutcome(imagePrep{
		Outcome: jobs.Outcome{HTTPStatus: 403, Message: "Forbidden"},
	}, func(imagor.Request) (jobs.Outcome, error) {
		called = true
		return jobs.Outcome{HTTPStatus: 200}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if called || outcome.HTTPStatus != 403 {
		t.Fatalf("called = %v outcome = %+v", called, outcome)
	}
}

func TestWithoutImageBytesDropsThePayload(t *testing.T) {
	outcome := withoutImageBytes(jobs.Outcome{
		HTTPStatus: 200,
		Artifact: &jobs.Artifact{
			Key:         "images/user/job",
			ContentType: "image/jpeg",
			Body:        []byte("jpeg-bytes"),
		},
	})
	if outcome.Artifact == nil || len(outcome.Artifact.Body) != 0 || outcome.Artifact.Key != "images/user/job" {
		t.Fatalf("outcome = %+v", outcome.Artifact)
	}
}

func TestImageOutcomeRendersAnAuthorizedRequest(t *testing.T) {
	outcome, err := imageOutcome(imagePrep{
		Request: imagor.Request{SourceKey: "source"},
	}, func(request imagor.Request) (jobs.Outcome, error) {
		if request.SourceKey != "source" {
			t.Fatalf("request = %+v", request)
		}
		return jobs.Outcome{HTTPStatus: 200}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if outcome.HTTPStatus != 200 {
		t.Fatalf("status = %d", outcome.HTTPStatus)
	}
}

func workflowStates(states map[string]dbos.WorkflowStatusType) workflowLookup {
	return func(id string) (dbos.WorkflowStatusType, bool, error) {
		state, ok := states[id]
		return state, ok, nil
	}
}

func imagorEnvelope() jobs.Envelope {
	return jobs.Envelope{JobID: "job-1", Kind: jobs.KindImagor}
}

func TestChooseWorkflowIDKeepsTheJobIDWhenNothingRanBefore(t *testing.T) {
	record := status.Record{JobID: "job-1", Status: status.Pending, ExpiresAt: time.Unix(1_000, 0)}
	id, err := chooseWorkflowID(imagorEnvelope(), record, true, workflowStates(nil))
	if err != nil || id != "job-1" {
		t.Fatalf("id = %q err = %v", id, err)
	}
}

func TestChooseWorkflowIDKeepsTheJobIDWithoutARecord(t *testing.T) {
	id, err := chooseWorkflowID(imagorEnvelope(), status.Record{}, false, func(string) (dbos.WorkflowStatusType, bool, error) {
		t.Fatal("lookup must not run without a record")
		return "", false, nil
	})
	if err != nil || id != "job-1" {
		t.Fatalf("id = %q err = %v", id, err)
	}
}

// A pending record next to a finished workflow means the record expired and was
// created again. Reusing the id would attach the new record to the old result.
func TestChooseWorkflowIDRenewsAFinishedWorkflowBehindAPendingRecord(t *testing.T) {
	record := status.Record{JobID: "job-1", Status: status.Pending, ExpiresAt: time.Unix(2_000, 0)}
	for _, finished := range []dbos.WorkflowStatusType{
		dbos.WorkflowStatusSuccess,
		dbos.WorkflowStatusError,
		dbos.WorkflowStatusCancelled,
		dbos.WorkflowStatusMaxRecoveryAttemptsExceeded,
	} {
		lookup := workflowStates(map[string]dbos.WorkflowStatusType{"job-1": finished})
		first, err := chooseWorkflowID(imagorEnvelope(), record, true, lookup)
		if err != nil {
			t.Fatal(err)
		}
		if first == "job-1" {
			t.Fatalf("%s: a finished workflow id was reused", finished)
		}
		second, err := chooseWorkflowID(imagorEnvelope(), record, true, lookup)
		if err != nil || second != first {
			t.Fatalf("%s: duplicate message got %q, want %q (err %v)", finished, second, first, err)
		}
	}
}

func TestChooseWorkflowIDGivesEachRecordIncarnationItsOwnWorkflow(t *testing.T) {
	lookup := workflowStates(map[string]dbos.WorkflowStatusType{"job-1": dbos.WorkflowStatusSuccess})
	older, _ := chooseWorkflowID(imagorEnvelope(), status.Record{Status: status.Pending, ExpiresAt: time.Unix(2_000, 0)}, true, lookup)
	newer, _ := chooseWorkflowID(imagorEnvelope(), status.Record{Status: status.Pending, ExpiresAt: time.Unix(90_000, 0)}, true, lookup)
	if older == newer {
		t.Fatalf("two incarnations share workflow id %q", older)
	}
}

func TestChooseWorkflowIDDedupesAWorkflowStillInFlight(t *testing.T) {
	record := status.Record{JobID: "job-1", Status: status.Pending, ExpiresAt: time.Unix(2_000, 0)}
	for _, live := range []dbos.WorkflowStatusType{
		dbos.WorkflowStatusEnqueued,
		dbos.WorkflowStatusPending,
		dbos.WorkflowStatusDelayed,
	} {
		lookup := workflowStates(map[string]dbos.WorkflowStatusType{"job-1": live})
		id, err := chooseWorkflowID(imagorEnvelope(), record, true, lookup)
		if err != nil || id != "job-1" {
			t.Fatalf("%s: id = %q err = %v", live, id, err)
		}
	}
}

func TestChooseWorkflowIDLeavesSettledRecordsAlone(t *testing.T) {
	lookup := workflowStates(map[string]dbos.WorkflowStatusType{"job-1": dbos.WorkflowStatusSuccess})
	for _, settled := range []string{status.Running, status.Completed, status.Failed} {
		record := status.Record{JobID: "job-1", Status: settled, ExpiresAt: time.Unix(2_000, 0)}
		id, err := chooseWorkflowID(imagorEnvelope(), record, true, lookup)
		if err != nil || id != "job-1" {
			t.Fatalf("%s: id = %q err = %v", settled, id, err)
		}
	}
}

// Mutations stay exactly-once per idempotency key, so only Imagor renews.
func TestChooseWorkflowIDNeverRenewsAMutation(t *testing.T) {
	lookup := workflowStates(map[string]dbos.WorkflowStatusType{"job-1": dbos.WorkflowStatusSuccess})
	envelope := jobs.Envelope{JobID: "job-1", Kind: jobs.KindCreateViewItem}
	record := status.Record{JobID: "job-1", Status: status.Pending, ExpiresAt: time.Unix(2_000, 0)}
	id, err := chooseWorkflowID(envelope, record, true, lookup)
	if err != nil || id != "job-1" {
		t.Fatalf("id = %q err = %v", id, err)
	}
}

func TestChooseWorkflowIDKeepsTheRetryAttemptSuffix(t *testing.T) {
	record := status.Record{JobID: "job-1", Status: status.Pending, Attempt: 2, ExpiresAt: time.Unix(2_000, 0)}
	id, err := chooseWorkflowID(imagorEnvelope(), record, true, workflowStates(nil))
	if err != nil || id != "job-1:2" {
		t.Fatalf("id = %q err = %v", id, err)
	}
	lookup := workflowStates(map[string]dbos.WorkflowStatusType{"job-1:2": dbos.WorkflowStatusSuccess})
	renewed, err := chooseWorkflowID(imagorEnvelope(), record, true, lookup)
	if err != nil || renewed == "job-1:2" || renewed == "job-1" {
		t.Fatalf("renewed = %q err = %v", renewed, err)
	}
}

func TestChooseWorkflowIDReturnsALookupFailureSoTheMessageIsRetried(t *testing.T) {
	record := status.Record{JobID: "job-1", Status: status.Pending, ExpiresAt: time.Unix(2_000, 0)}
	boom := errors.New("system database unavailable")
	_, err := chooseWorkflowID(imagorEnvelope(), record, true, func(string) (dbos.WorkflowStatusType, bool, error) {
		return "", false, boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v", err)
	}
}
