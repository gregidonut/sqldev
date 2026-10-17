package main

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/dbos-inc/dbos-transact-golang/dbos"
	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/api"
	"github.com/gregidonut/sqldev/packages/functions/internal/jobs"
	"github.com/gregidonut/sqldev/packages/functions/internal/status"
)

func confirmEnvelope(fingerprint string) jobs.Envelope {
	return jobs.Envelope{JobID: "job-1", Kind: jobs.KindConfirmOperation, Fingerprint: fingerprint}
}

func recordedOutcome(outcome jobs.Outcome, err error) workflowOutcome {
	return func(string) (jobs.Outcome, error) { return outcome, err }
}

func neverRecorded(t *testing.T) workflowOutcome {
	return func(string) (jobs.Outcome, error) {
		t.Fatal("the recorded outcome must not be read")
		return jobs.Outcome{}, nil
	}
}

var pendingRecord = status.Record{JobID: "job-1", Status: status.Pending}

func TestReconcileSettlesARecreatedRecordWithTheRecordedOutcome(t *testing.T) {
	recorded := jobs.Outcome{HTTPStatus: 200, Body: json.RawMessage(`{"kind":"visibility_changed"}`), Fingerprint: "fp"}
	got, settled, err := reconcileOutcome(confirmEnvelope("fp"), pendingRecord, true, "job-1",
		workflowStates(map[string]dbos.WorkflowStatusType{"job-1": dbos.WorkflowStatusSuccess}), recordedOutcome(recorded, nil))
	if err != nil || !settled {
		t.Fatalf("settled = %v err = %v", settled, err)
	}
	if got.HTTPStatus != 200 || string(got.Body) != `{"kind":"visibility_changed"}` {
		t.Fatalf("outcome = %+v, want the recorded one", got)
	}
}

func TestReconcileReportsAConflictWhenTheFingerprintDiffers(t *testing.T) {
	recorded := jobs.Outcome{HTTPStatus: 200, Body: json.RawMessage(`{"kind":"visibility_changed"}`), Fingerprint: "fp-original"}
	got, settled, err := reconcileOutcome(confirmEnvelope("fp-different"), pendingRecord, true, "job-1",
		workflowStates(map[string]dbos.WorkflowStatusType{"job-1": dbos.WorkflowStatusSuccess}), recordedOutcome(recorded, nil))
	if err != nil || !settled {
		t.Fatalf("settled = %v err = %v", settled, err)
	}
	var body api.OperationRejectedResult
	if err := json.Unmarshal(got.Body, &body); err != nil || body.Reason != api.RejectionReasonIdempotencyConflict || got.HTTPStatus != 200 {
		t.Fatalf("outcome = %+v (%v)", got, err)
	}
}

func TestReconcileReportsAFailureWhenTheWorkflowEndedInError(t *testing.T) {
	got, settled, err := reconcileOutcome(confirmEnvelope("fp"), pendingRecord, true, "job-1",
		workflowStates(map[string]dbos.WorkflowStatusType{"job-1": dbos.WorkflowStatusError}),
		recordedOutcome(jobs.Outcome{}, errors.New("workflow failed")))
	if err != nil || !settled || got.HTTPStatus != 500 {
		t.Fatalf("outcome = %+v settled = %v err = %v", got, settled, err)
	}
}

func TestReconcileLeavesEverythingElseToTheNormalPath(t *testing.T) {
	finished := workflowStates(map[string]dbos.WorkflowStatusType{"job-1": dbos.WorkflowStatusSuccess})
	cases := map[string]struct {
		envelope jobs.Envelope
		record   status.Record
		found    bool
		lookup   workflowLookup
	}{
		"no record":              {confirmEnvelope("fp"), status.Record{}, false, finished},
		"a settled record":       {confirmEnvelope("fp"), status.Record{Status: status.Completed}, true, finished},
		"a failed record":        {confirmEnvelope("fp"), status.Record{Status: status.Failed}, true, finished},
		"a running record":       {confirmEnvelope("fp"), status.Record{Status: status.Running}, true, finished},
		"an imagor job":          {imagorEnvelope(), pendingRecord, true, finished},
		"a view mutation":        {jobs.Envelope{JobID: "job-1", Kind: jobs.KindCreateViewItem}, pendingRecord, true, finished},
		"no workflow yet":        {confirmEnvelope("fp"), pendingRecord, true, workflowStates(nil)},
		"a workflow in flight":   {confirmEnvelope("fp"), pendingRecord, true, workflowStates(map[string]dbos.WorkflowStatusType{"job-1": dbos.WorkflowStatusPending})},
		"a workflow still queue": {confirmEnvelope("fp"), pendingRecord, true, workflowStates(map[string]dbos.WorkflowStatusType{"job-1": dbos.WorkflowStatusEnqueued})},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			_, settled, err := reconcileOutcome(c.envelope, c.record, c.found, "job-1", c.lookup, neverRecorded(t))
			if err != nil || settled {
				t.Fatalf("settled = %v err = %v, want the normal path", settled, err)
			}
		})
	}
}

func TestReconcilePropagatesALookupFailure(t *testing.T) {
	boom := errors.New("lookup failed")
	_, settled, err := reconcileOutcome(confirmEnvelope("fp"), pendingRecord, true, "job-1",
		func(string) (dbos.WorkflowStatusType, bool, error) { return "", false, boom }, neverRecorded(t))
	if !errors.Is(err, boom) || settled {
		t.Fatalf("settled = %v err = %v", settled, err)
	}
}

func TestReconcileNeverRunsTheMutationAgain(t *testing.T) {
	// Every settled path returns an outcome without ever being handed a way to execute.
	// The signature takes only read functions, so a replay cannot re-run the work.
	for _, state := range []dbos.WorkflowStatusType{
		dbos.WorkflowStatusSuccess, dbos.WorkflowStatusError, dbos.WorkflowStatusCancelled,
		dbos.WorkflowStatusMaxRecoveryAttemptsExceeded,
	} {
		_, settled, err := reconcileOutcome(confirmEnvelope("fp"), pendingRecord, true, "job-1",
			workflowStates(map[string]dbos.WorkflowStatusType{"job-1": state}),
			recordedOutcome(jobs.Outcome{HTTPStatus: 200, Fingerprint: "fp"}, nil))
		if err != nil || !settled {
			t.Errorf("state %s: settled = %v err = %v", state, settled, err)
		}
	}
}

// A recreated status record is settled with the nine-key confirmation_required
// body exactly as DBOS recorded it. The outcome survives the JSON encoding DBOS
// applies to a workflow result, and reconcileOutcome hands it back unchanged.
func TestReconcileReturnsTheRecordedNineKeyConfirmationBodyUnchanged(t *testing.T) {
	body := json.RawMessage(`{"kind":"confirmation_required","registryId":"1000","operationKind":"storage.visibility.make_public",` +
		`"target":{"type":"storage_object","id":"5b1f7f0e-0c4a-4f7e-9a63-2f4f6a1d9b11"},"expectedRevision":3,` +
		`"challengeId":"0d7e1c52-8b0e-4a53-b3a4-1c9d2a6f7e90","proof":"AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCde",` +
		`"expiresAt":"2026-10-14T15:50:20.944454Z","dialogCopy":{"title":"Make \u201creport.pdf\u201d public?",` +
		`"description":"Anyone signed in to SQLDev will be able to see and download this file. The stored file stays private in S3.",` +
		`"confirmLabel":"Make public"}}`)
	recorded := jobs.Outcome{HTTPStatus: 200, Body: body, Fingerprint: "fp"}

	encoded, err := json.Marshal(recorded)
	if err != nil {
		t.Fatal(err)
	}
	var stored jobs.Outcome
	if err := json.Unmarshal(encoded, &stored); err != nil {
		t.Fatal(err)
	}

	got, settled, err := reconcileOutcome(confirmEnvelope("fp"), pendingRecord, true, "job-1",
		workflowStates(map[string]dbos.WorkflowStatusType{"job-1": dbos.WorkflowStatusSuccess}), recordedOutcome(stored, nil))
	if err != nil || !settled {
		t.Fatalf("settled = %v err = %v", settled, err)
	}
	var want, have any
	if err := json.Unmarshal(body, &want); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(got.Body, &have); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(want, have) {
		t.Fatalf("the recorded body changed:\n  recorded %s\n  returned %s", body, got.Body)
	}
	var typed api.ConfirmationRequiredResult
	if err := json.Unmarshal(got.Body, &typed); err != nil || typed.RegistryId != "1000" ||
		typed.DialogCopy.ConfirmLabel != "Make public" || typed.DialogCopy.Title != "Make “report.pdf” public?" {
		t.Fatalf("the replayed body lost its registry identity or copy: %+v (%v)", typed, err)
	}
}
