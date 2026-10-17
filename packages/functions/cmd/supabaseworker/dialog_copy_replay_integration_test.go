//go:build integration

package main

// Production-path replay of the authoritative dialog copy (spec confirmation-dialog-copy,
// task 3.6): API handler -> status store -> queue message -> processor.Accept -> real DBOS
// -> sqldb.Session -> begin_d_storage_make_public, against local Supabase.
//
// The one registry row is edited with the allowed copy-column UPDATE on a dedicated
// connection so the edit is visible to the worker's connections. The exact original copy is
// restored in t.Cleanup (and verified), registry_id is never written, and the registry id
// sequence is only read.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"log/slog"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/gregidonut/sqldev/packages/functions/internal/jobs"
	"github.com/gregidonut/sqldev/packages/functions/internal/status"
)

const (
	copyFeature         = "confirmation-dialog-copy"
	makePublicKind      = "storage.visibility.make_public"
	registryTokenMarker = "{{targetLabel}}"
)

// copyProperty names a subtest the way the validation script collects it.
func copyProperty(t *testing.T, n int, title string, fn func(t *testing.T)) {
	t.Helper()
	t.Run(fmt.Sprintf("Feature: %s, Property %d: %s", copyFeature, n, title), fn)
}

// logSink collects everything the DBOS logger and the default logger write during the
// package run, so a test can inspect only what was logged while it ran.
type logSink struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *logSink) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *logSink) Len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Len()
}

func (s *logSink) Since(offset int) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return string(s.b.Bytes()[offset:])
}

// rigLogs receives the DBOS logger output (see newRig) and the default logger while
// captureDefaultLogs is active.
var rigLogs logSink

// captureDefaultLogs routes slog and the standard log package into rigLogs (still echoed
// to stderr) and restores both afterwards. slog.SetDefault does not undo log.SetOutput,
// so the standard logger is reset explicitly.
func captureDefaultLogs(t *testing.T) {
	t.Helper()
	previous := slog.Default()
	writer, flags := log.Writer(), log.Flags()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.MultiWriter(os.Stderr, &rigLogs), &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() {
		slog.SetDefault(previous)
		log.SetOutput(writer)
		log.SetFlags(flags)
	})
}

// registryCopy is the registry identity and the three source-copy columns.
type registryCopy struct {
	ID           string
	Title        string
	Description  string
	ConfirmLabel string
}

func (c registryCopy) resolve(label string) map[string]any {
	return map[string]any{
		"title":        strings.Replace(c.Title, registryTokenMarker, label, 1),
		"description":  c.Description,
		"confirmLabel": c.ConfirmLabel,
	}
}

type registrySnapshot struct {
	rows       int
	copy       registryCopy
	seqLast    int64
	seqCalled  bool
	seqOptions string
}

func (r *rig) snapshotRegistry() registrySnapshot {
	r.t.Helper()
	var s registrySnapshot
	err := r.pool.QueryRow(context.Background(), `
		SELECT count(*) OVER (), registry_id::text, dialog_title_template, dialog_description, dialog_confirm_label
		FROM public.app_confirmable_operations WHERE operation_kind = $1`, makePublicKind,
	).Scan(&s.rows, &s.copy.ID, &s.copy.Title, &s.copy.Description, &s.copy.ConfirmLabel)
	if err != nil {
		r.t.Fatalf("read the registry row: %v", err)
	}
	// Read-only: the sequence is never advanced or set by this test.
	err = r.pool.QueryRow(context.Background(), `
		SELECT last_value, is_called FROM public.app_confirmable_operations_registry_id_seq`).Scan(&s.seqLast, &s.seqCalled)
	if err != nil {
		r.t.Fatalf("read the registry sequence: %v", err)
	}
	err = r.pool.QueryRow(context.Background(), `
		SELECT concat_ws(',', start_value, min_value, max_value, increment_by, cache_size, cycle)
		FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'app_confirmable_operations_registry_id_seq'`).Scan(&s.seqOptions)
	if err != nil {
		r.t.Fatalf("read the registry sequence options: %v", err)
	}
	return s
}

// guardRegistry records the registry row and registers a cleanup that writes back the
// exact original copy and verifies the row and the sequence are as they were. The returned
// function runs that restore at once (it runs only once), so the test can attribute a
// failure to itself.
func (r *rig) guardRegistry() (original registryCopy, restore func()) {
	r.t.Helper()
	before := r.snapshotRegistry()
	if before.rows != 1 {
		r.t.Fatalf("the registry holds %d rows, want exactly the make-public row", before.rows)
	}
	var once sync.Once
	restore = func() {
		once.Do(func() {
			_, err := r.pool.Exec(context.Background(), `
				UPDATE public.app_confirmable_operations
				SET dialog_title_template = $2, dialog_description = $3, dialog_confirm_label = $4
				WHERE operation_kind = $1`,
				makePublicKind, before.copy.Title, before.copy.Description, before.copy.ConfirmLabel)
			if err != nil {
				r.t.Errorf("RESTORE THE REGISTRY COPY BY HAND, the restore failed: %v", err)
				return
			}
			if after := r.snapshotRegistry(); after != before {
				r.t.Errorf("the registry or its sequence differs after the restore:\n  before %+v\n  after  %+v", before, after)
			}
		})
	}
	r.t.Cleanup(restore)
	return before.copy, restore
}

// editRegistryCopy changes only the three copy columns (never registry_id) and returns the
// copy now in force.
func (r *rig) editRegistryCopy(original registryCopy, edit registryCopy) registryCopy {
	r.t.Helper()
	tag, err := r.pool.Exec(context.Background(), `
		UPDATE public.app_confirmable_operations
		SET dialog_title_template = $2, dialog_description = $3, dialog_confirm_label = $4
		WHERE operation_kind = $1`,
		makePublicKind, edit.Title, edit.Description, edit.ConfirmLabel)
	if err != nil || tag.RowsAffected() != 1 {
		r.t.Fatalf("edit the registry copy: %v (rows %d)", err, tag.RowsAffected())
	}
	edit.ID = original.ID
	if now := r.snapshotRegistry(); now.copy != edit {
		r.t.Fatalf("the registry row after the edit = %+v, want %+v", now.copy, edit)
	}
	return edit
}

func nineKeys() []string {
	keys := []string{"kind", "registryId", "operationKind", "target", "expectedRevision", "challengeId", "proof", "expiresAt", "dialogCopy"}
	sort.Strings(keys)
	return keys
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// assertCurrentResult checks the nine-key shape and that registryId and dialogCopy are
// the registry identity and the copy resolved from label.
func assertCurrentResult(t *testing.T, label string, got map[string]any, in registryCopy, fileName string) {
	t.Helper()
	if !reflect.DeepEqual(sortedKeys(got), nineKeys()) {
		t.Fatalf("%s: result keys = %v, want the nine current keys", label, sortedKeys(got))
	}
	if got["kind"] != "confirmation_required" || got["operationKind"] != makePublicKind {
		t.Fatalf("%s: result = %v", label, got)
	}
	if got["registryId"] != in.ID {
		t.Fatalf("%s: registryId = %#v, want the string %q", label, got["registryId"], in.ID)
	}
	if want := in.resolve(fileName); !reflect.DeepEqual(got["dialogCopy"], want) {
		t.Fatalf("%s: dialogCopy = %#v, want %#v", label, got["dialogCopy"], want)
	}
}

// metadata renders every status field except the inline result body, which is the one
// place the owner-scoped result lives.
func metadata(record status.Record) string {
	record.Body = nil
	return fmt.Sprintf("%+v", record)
}

type secret struct {
	name  string
	value string
}

// forms returns the value as written and as encoding/json writes it inside a string.
func (s secret) forms() []string {
	encoded, _ := json.Marshal(s.value)
	inner := string(encoded[1 : len(encoded)-1])
	if inner == s.value {
		return []string{s.value}
	}
	return []string{s.value, inner}
}

func assertNoSecret(t *testing.T, surface, text string, secrets []secret) {
	t.Helper()
	for _, s := range secrets {
		for _, form := range s.forms() {
			if form != "" && strings.Contains(text, form) {
				t.Errorf("%s contains the %s", surface, s.name)
			}
		}
	}
}

func (r *rig) jobBody(o owner, jobID string) (int, string) {
	r.t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/api/jobs/"+jobID, nil)
	request.Header.Set("Authorization", "Bearer tok-"+o.Sub)
	response := httptest.NewRecorder()
	r.handler.ServeHTTP(response, request)
	return response.Code, response.Body.String()
}

func TestDialogCopyReplayReturnsTheRecordedResult(t *testing.T) {
	copyProperty(t, 2, "PostgreSQL returns authoritative copy only to authorized initiations and preserves it on replay", func(t *testing.T) {
		r := newRig(t)
		logStart := rigLogs.Len()
		captureDefaultLogs(t)
		original, restore := r.guardRegistry()

		// Names stress literal substitution, JSON escaping and Unicode; the suffix keeps
		// every label unique so a leak is attributable.
		names := []string{
			`report "final" <b>x</b> & more`,
			`back\slash \1 $1 ` + registryTokenMarker,
			"emoji \U0001F600 e\u0301 \u0645\u0631\u062D\u0628\u0627",
			"plain",
			"<script>alert(1)</script> https://example.test/?a=1&b=2",
		}
		const randomRuns = 3
		for i := 0; i < randomRuns; i++ {
			names = append(names, fmt.Sprintf("random %d %x", i, rand.New(rand.NewSource(int64(2000+i))).Int63()))
		}

		var secrets []secret
		var metadataSeen []string
		var jobIDs []string
		add := func(name, value string) { secrets = append(secrets, secret{name, value}) }
		add("original title template", original.Title)
		add("original description", original.Description)
		add("original confirm label", original.ConfirmLabel)

		inForce := original // the copy the registry holds at the start of each iteration
		for i, base := range names {
			rng := rand.New(rand.NewSource(int64(3000 + i)))
			k := 2 + rng.Intn(3)
			concurrent := rng.Intn(2) == 0
			name := fmt.Sprintf("%s #%d %s", base, i, strings.ReplaceAll(fmt.Sprint(rng.Int63()), "-", ""))
			tag := fmt.Sprintf("iteration %d (k=%d concurrent=%v)", i, k, concurrent)

			o := r.newOwnerNamed(name)
			path, key, body := r.visibilityPath(), "copy-"+o.Sub, r.visibilityBody(o, "public", 1)

			// 1. The first result is recorded: k identical submissions, one job.
			jobID := r.replay(o, path, key, body, k, concurrent)
			jobIDs = append(jobIDs, jobID)
			want := r.result(o, jobID)
			first := decodeMap(t, want)
			assertCurrentResult(t, tag+": first result", first, inForce, name)
			settled := r.state(o)
			if settled.challenges != 1 || settled.rows != 1 || settled.consumed != 0 {
				t.Fatalf("%s: after the burst %+v, want one challenge, no config change", tag, settled)
			}
			original1, err := r.proc.server.Jobs.Get(context.Background(), jobID)
			if err != nil || original1.Status != status.Completed {
				t.Fatalf("%s: record = %+v (%v)", tag, original1, err)
			}
			metadataSeen = append(metadataSeen, metadata(original1))

			// 2. The registry copy changes after the first result. A different owner
			// initiating now proves the edit is live, so the replays below are not vacuous.
			edit := registryCopy{
				Title:        fmt.Sprintf("Edited %d “%s” & <i> \\ ?", i, registryTokenMarker),
				Description:  fmt.Sprintf("Edited description %d: a different sentence.", i),
				ConfirmLabel: fmt.Sprintf("Edited confirm %d", i),
			}
			edited := r.editRegistryCopy(original, edit)
			inForce = edited
			control := r.newOwnerNamed(name)
			controlJob, controlChallenge := r.initiate(control, "control-"+control.Sub, 1)
			jobIDs = append(jobIDs, controlJob)
			assertCurrentResult(t, tag+": control", controlChallenge, edited, name)
			if reflect.DeepEqual(controlChallenge["dialogCopy"], first["dialogCopy"]) {
				t.Fatalf("%s: the registry edit changed nothing for a fresh initiation", tag)
			}
			add("edited title template", edited.Title)
			add("edited description", edited.Description)
			add("edited confirm label", edited.ConfirmLabel)

			// 3. Replays after the edit return the recorded result field for field.
			assertReplayEqualsRecorded := func(phase string) {
				t.Helper()
				got := r.result(o, jobID)
				if got != want {
					t.Fatalf("%s: %s changed the result:\n  %s\n  %s", tag, phase, want, got)
				}
				replayed := decodeMap(t, got)
				for _, field := range nineKeys() {
					if !reflect.DeepEqual(replayed[field], first[field]) {
						t.Fatalf("%s: %s: %s = %#v, want %#v", tag, phase, field, replayed[field], first[field])
					}
				}
				if after := r.state(o); after != settled {
					t.Fatalf("%s: %s had an effect or made another challenge: %+v -> %+v", tag, phase, settled, after)
				}
			}
			if again := r.replay(o, path, key, body, k, concurrent); again != jobID {
				t.Fatalf("%s: a replay got job %s, want %s", tag, again, jobID)
			}
			assertReplayEqualsRecorded("a replay after the registry edit")

			// 4. A conflicting semantic reuse is refused before the queue, copy-free.
			r.assertConflictBeforeQueue(o, path, key, r.visibilityBody(o, "public", 2), settled)
			assertReplayEqualsRecorded("a conflicting reuse")

			// 5. The status record is recreated: the recorded body comes back from DBOS.
			r.expireJobRecords()
			if again := receiptID(t, r.post(o, path, key, body)); again != jobID {
				t.Fatalf("%s: the job id changed after the record was recreated", tag)
			}
			sent := r.messages.Sent()
			envelope, err := jobs.Parse(sent[len(sent)-1])
			if err != nil {
				t.Fatal(err)
			}
			recreated, err := r.proc.server.Jobs.Get(context.Background(), jobID)
			if err != nil || recreated.Status != status.Pending {
				t.Fatalf("%s: the recreated record = %+v (%v), want pending", tag, recreated, err)
			}
			workflowID, err := chooseWorkflowID(envelope, recreated, true, r.proc.lookupWorkflow)
			if err != nil {
				t.Fatal(err)
			}
			outcome, settledByDBOS, err := reconcileOutcome(envelope, recreated, true, workflowID, r.proc.lookupWorkflow, r.proc.workflowOutcome)
			if err != nil || !settledByDBOS {
				t.Fatalf("%s: reconcileOutcome = settled %v, err %v; want the recorded outcome", tag, settledByDBOS, err)
			}
			if outcome.HTTPStatus != http.StatusOK || outcome.Fingerprint != envelope.Fingerprint {
				t.Fatalf("%s: reconciled outcome = status %d fingerprint %q", tag, outcome.HTTPStatus, outcome.Fingerprint)
			}
			if !bytes.Equal(outcome.Body, original1.Body) {
				// Same value is what matters; the recorded bytes should also match.
				var canonical any
				if err := json.Unmarshal(outcome.Body, &canonical); err != nil {
					t.Fatalf("%s: reconciled body: %v", tag, err)
				}
				out, _ := json.Marshal(canonical)
				if string(out) != want {
					t.Fatalf("%s: reconcileOutcome returned a different body:\n  %s\n  %s", tag, want, out)
				}
				t.Errorf("%s: reconcileOutcome body is semantically equal but not byte-equal to the recorded body", tag)
			}
			metadataSeen = append(metadataSeen, metadata(recreated))
			// Now deliver the message the way the worker does: the record settles from DBOS.
			r.deliver(false)
			r.wait(jobID)
			assertReplayEqualsRecorded("a replay after the status record was recreated")

			// 6. Secrets of this iteration: the proof, the label and the resolved copy.
			add(fmt.Sprintf("proof of iteration %d", i), first["proof"].(string))
			add(fmt.Sprintf("control proof of iteration %d", i), controlChallenge["proof"].(string))
			add(fmt.Sprintf("target label of iteration %d", i), name)
			firstCopy := first["dialogCopy"].(map[string]any)
			add(fmt.Sprintf("resolved title of iteration %d", i), firstCopy["title"].(string))
			controlCopy := controlChallenge["dialogCopy"].(map[string]any)
			add(fmt.Sprintf("control resolved title of iteration %d", i), controlCopy["title"].(string))

			// Positive control: the owner-scoped result does carry them.
			if code, text := r.jobBody(o, jobID); code != http.StatusOK || !strings.Contains(text, "dialogCopy") {
				t.Fatalf("%s: the owner cannot read the result: %d %s", tag, code, text)
			}
			// A stranger cannot read the owner's job, and learns none of it.
			stranger := r.newOwner()
			code, text := r.jobBody(stranger, jobID)
			if code == http.StatusOK {
				t.Errorf("%s: another user read the owner's job: %s", tag, text)
			}
			assertNoSecret(t, tag+": a stranger's job response", text, secrets)

			// 7. After expiry a conflicting body is a completed idempotency_conflict with no copy.
			// This comes last: the job id is per key, so the key's record now holds the conflict.
			r.expireJobRecords()
			conflictJob := receiptID(t, r.post(o, path, key, r.visibilityBody(o, "public", 2)))
			r.deliver(false)
			r.wait(conflictJob)
			conflict := decodeMap(t, r.result(o, conflictJob))
			if conflict["kind"] != "rejected" || conflict["reason"] != "idempotency_conflict" {
				t.Fatalf("%s: a conflicting reuse after expiry = %v", tag, conflict)
			}
			if _, has := conflict["dialogCopy"]; has {
				t.Fatalf("%s: a rejection carries dialogCopy: %v", tag, conflict)
			}
			if _, has := conflict["registryId"]; has {
				t.Fatalf("%s: a rejection carries registryId: %v", tag, conflict)
			}
			// The key now maps to the conflict outcome; the recorded run itself is untouched.
			if after := r.state(o); after != settled {
				t.Fatalf("%s: a conflicting reuse after expiry had an effect: %+v -> %+v", tag, settled, after)
			}
			jobIDs = append(jobIDs, conflictJob)
			if record, err := r.proc.server.Jobs.Get(context.Background(), jobID); err == nil {
				metadataSeen = append(metadataSeen, metadata(record))
			}
		}

		// Outside the owner-scoped result: queue messages, status metadata and logs.
		for i, message := range r.messages.Sent() {
			assertNoSecret(t, fmt.Sprintf("queue message %d", i), message, secrets)
		}
		for i, text := range metadataSeen {
			assertNoSecret(t, fmt.Sprintf("status metadata %d", i), text, secrets)
		}
		for _, id := range jobIDs {
			if record, err := r.proc.server.Jobs.Get(context.Background(), id); err == nil {
				assertNoSecret(t, "current status metadata of "+id, metadata(record), secrets)
			}
		}
		assertNoSecret(t, "the logs", rigLogs.Since(logStart), secrets)

		// The registry is back to its exact original copy before the test ends.
		restore()
		if now := r.snapshotRegistry(); now.copy != original {
			t.Fatalf("the registry copy was not restored: %+v, want %+v", now.copy, original)
		}
	})
}
