package api

import (
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"net/http"
	"os"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"testing/quick"
	"time"

	"github.com/google/uuid"

	"github.com/gregidonut/sqldev/packages/functions/internal/jobs"
	"github.com/gregidonut/sqldev/packages/functions/internal/queue"
)

type contractCorpus struct {
	Valid     []json.RawMessage `json:"valid"`
	Legacy    []json.RawMessage `json:"legacy"`
	Malformed []struct {
		Name  string          `json:"name"`
		Value json.RawMessage `json:"value"`
	} `json:"malformed"`
}

func loadCorpus(t *testing.T) contractCorpus {
	t.Helper()
	raw, err := os.ReadFile("testdata/confirmable_results.json")
	if err != nil {
		t.Fatal(err)
	}
	var corpus contractCorpus
	if err := json.Unmarshal(raw, &corpus); err != nil {
		t.Fatal(err)
	}
	return corpus
}

// canonical decodes JSON into a comparable value, so key order and spacing do not matter.
func canonical(t *testing.T, raw []byte) any {
	t.Helper()
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatalf("%s: %v", raw, err)
	}
	return value
}

func randomProof(rng *rand.Rand) string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
	out := make([]byte, 43)
	for i := range out {
		out[i] = alphabet[rng.Intn(len(alphabet))]
	}
	return string(out)
}

func randomUUID(rng *rand.Rand) string {
	id, _ := uuid.NewRandomFromReader(rng)
	return id.String()
}

// randomCopyField builds a valid dialog copy field of 1..limit code points. The
// pool mixes markup-like text, quotes, backslashes, template tokens, astral
// code points, combining marks and right-to-left text, and may hold blank runes
// as long as one rune outside the blank class remains.
func randomCopyField(rng *rand.Rand, limit int) string {
	pool := []rune("abcXYZ019 <>&\"'\\{}/:;=#%$@!?-_.\t\u00a0\u0085\u3000\u0301\u05d0\u0627\u200b\ufeff😀𝔘\U0001F1EF")
	visible := []rune("abcXYZ019<>&\"'\\{}/😀𝔘\u05d0\u0301")
	var length int
	switch rng.Intn(4) {
	case 0:
		length = 1
	case 1:
		length = limit
	default:
		length = 1 + rng.Intn(limit)
	}
	out := make([]rune, length)
	for i := range out {
		out[i] = pool[rng.Intn(len(pool))]
	}
	out[rng.Intn(length)] = visible[rng.Intn(len(visible))]
	return string(out)
}

func randomRegistryID(rng *rand.Rand) string {
	switch rng.Intn(4) {
	case 0:
		return "1000"
	case 1:
		return "9223372036854775807"
	default:
		return strconv.FormatInt(minRegistryID+rng.Int63n(math.MaxInt64-minRegistryID), 10)
	}
}

// randomConfirmationRequired builds a current nine-key confirmation_required result.
func randomConfirmationRequired(rng *rand.Rand) map[string]any {
	expires := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).Add(time.Duration(rng.Int63n(1 << 50)))
	return map[string]any{
		"kind": "confirmation_required", "registryId": randomRegistryID(rng), "operationKind": "storage.visibility.make_public",
		"target":           map[string]any{"type": "storage_object", "id": randomUUID(rng)},
		"expectedRevision": 1 + rng.Int63n(maxConfigRevision), "challengeId": randomUUID(rng), "proof": randomProof(rng),
		"expiresAt": expires.Format(time.RFC3339Nano),
		"dialogCopy": map[string]any{
			"title":        randomCopyField(rng, maxCopyTitle),
			"description":  randomCopyField(rng, maxCopyDescription),
			"confirmLabel": randomCopyField(rng, maxCopyConfirmLabel),
		},
	}
}

// randomValidResult builds a result the contract allows.
func randomValidResult(rng *rand.Rand) map[string]any {
	target := map[string]any{"type": "storage_object", "id": randomUUID(rng)}
	revision := 1 + rng.Int63n(maxConfigRevision)
	switch rng.Intn(3) {
	case 0:
		return randomConfirmationRequired(rng)
	case 1:
		return map[string]any{
			"kind": "visibility_changed", "target": target,
			"visibility": []string{"public", "private"}[rng.Intn(2)], "revision": revision,
		}
	default:
		reasons := []string{"forbidden", "stale_revision", "invalid_challenge", "expired_challenge",
			"consumed_challenge", "superseded_challenge", "idempotency_conflict"}
		return map[string]any{"kind": "rejected", "reason": reasons[rng.Intn(len(reasons))]}
	}
}

func TestContractRoundTripPreservesEveryValidResult(t *testing.T) {
	t.Run("Feature: storage-visibility-confirmation, Property 15: Contract round trip preserves every valid tagged result (Go binding)", func(t *testing.T) {
		corpus := loadCorpus(t)

		roundTrip := func(raw []byte) error {
			decoded, err := decodeOperationResult(raw)
			if err != nil {
				return err
			}
			again, err := json.Marshal(decoded)
			if err != nil {
				return err
			}
			var want, got any
			_ = json.Unmarshal(raw, &want)
			_ = json.Unmarshal(again, &got)
			if !reflect.DeepEqual(want, got) {
				return fmt.Errorf("round trip changed the value:\n  in  %s\n  out %s", raw, again)
			}
			return nil
		}

		for _, raw := range corpus.Valid {
			if err := roundTrip(raw); err != nil {
				t.Errorf("corpus valid case: %v", err)
			}
		}
		check := func(seed int64) bool {
			value := randomValidResult(rand.New(rand.NewSource(seed)))
			raw, _ := json.Marshal(value)
			if err := roundTrip(raw); err != nil {
				t.Errorf("seed %d: %v", seed, err)
				return false
			}
			return true
		}
		if err := quick.Check(check, &quick.Config{MaxCount: 200}); err != nil {
			t.Fatal(err)
		}

		for _, bad := range corpus.Malformed {
			if _, err := decodeOperationResult(bad.Value); err == nil {
				t.Errorf("malformed corpus case %q was accepted: %s", bad.Name, bad.Value)
			}
		}

		// Every single-step mutation of a valid result must be rejected.
		mutate := func(seed int64) bool {
			rng := rand.New(rand.NewSource(seed))
			value := randomValidResult(rng)
			keys := make([]string, 0, len(value))
			for key := range value {
				keys = append(keys, key)
			}
			choice := rng.Intn(3)
			key := keys[rng.Intn(len(keys))]
			switch choice {
			case 0: // drop a field
				delete(value, key)
			case 1: // add an unknown field
				value["unexpected"] = true
			default: // change a field to the wrong type
				value[key] = []any{value[key]}
			}
			raw, _ := json.Marshal(value)
			if _, err := decodeOperationResult(raw); err == nil {
				t.Errorf("seed %d: a mutated result was accepted (%d on %q): %s", seed, choice, key, raw)
				return false
			}
			return true
		}
		if err := quick.Check(mutate, &quick.Config{MaxCount: 300}); err != nil {
			t.Fatal(err)
		}
	})
}

func TestStrictBodyRejectsEveryMalformedRequestBeforeAnyJob(t *testing.T) {
	good := map[string]struct {
		path string
		kind string
		body string
	}{
		"visibility": {visibilityPathFor, jobs.KindSetStorageVisibility, visibilityBody("public", 1)},
		"confirm":    {"/api/confirmations", jobs.KindConfirmOperation, confirmBody(1)},
	}
	const presentation = `"dialogCopy":{"title":"t","description":"d","confirmLabel":"c"}`
	mutations := map[string]func(string) string{
		"registryId at the top level": func(b string) string { return strings.Replace(b, `{`, `{"registryId":"1000",`, 1) },
		"registryId as a number":      func(b string) string { return strings.Replace(b, `{`, `{"registryId":1000,`, 1) },
		"dialogCopy at the top level": func(b string) string { return strings.Replace(b, `{`, `{`+presentation+`,`, 1) },
		"dialog_title_template at the top level": func(b string) string {
			return strings.Replace(b, `{`, `{"dialog_title_template":"Make {{targetLabel}} public?",`, 1)
		},
		"dialog_description at the top level":   func(b string) string { return strings.Replace(b, `{`, `{"dialog_description":"d",`, 1) },
		"dialog_confirm_label at the top level": func(b string) string { return strings.Replace(b, `{`, `{"dialog_confirm_label":"c",`, 1) },
		"registryId and dialogCopy together":    func(b string) string { return strings.Replace(b, `{`, `{"registryId":"1000",`+presentation+`,`, 1) },
		"registryId inside target": func(b string) string {
			return strings.Replace(b, `"type":"storage_object"`, `"type":"storage_object","registryId":"1000"`, 1)
		},
		"dialogCopy inside target": func(b string) string {
			return strings.Replace(b, `"type":"storage_object"`, `"type":"storage_object",`+presentation, 1)
		},
		"dialog_title_template inside target": func(b string) string {
			return strings.Replace(b, `"type":"storage_object"`, `"type":"storage_object","dialog_title_template":"x"`, 1)
		},
		"empty dialogCopy":        func(b string) string { return strings.Replace(b, `{`, `{"dialogCopy":{},`, 1) },
		"null dialogCopy":         func(b string) string { return strings.Replace(b, `{`, `{"dialogCopy":null,`, 1) },
		"unknown top-level field": func(b string) string { return strings.Replace(b, `{`, `{"extra":1,`, 1) },
		"unknown nested field": func(b string) string {
			return strings.Replace(b, `"type":"storage_object"`, `"type":"storage_object","name":"x"`, 1)
		},
		"missing target": func(b string) string {
			return strings.Replace(b, `"target":{"type":"storage_object","id":"`+vizObject+`"},`, ``, 1)
		},
		"missing nested id":   func(b string) string { return strings.Replace(b, `,"id":"`+vizObject+`"`, ``, 1) },
		"missing revision":    func(b string) string { return strings.Replace(b, `"expectedRevision":1,`, ``, 1) },
		"revision as string":  func(b string) string { return strings.Replace(b, `"expectedRevision":1`, `"expectedRevision":"1"`, 1) },
		"fractional revision": func(b string) string { return strings.Replace(b, `"expectedRevision":1`, `"expectedRevision":1.5`, 1) },
		"bad target uuid":     func(b string) string { return strings.Replace(b, vizObject, "not-a-uuid", 1) },
		"trailing data":       func(b string) string { return b + `{}` },
		"not an object":       func(string) string { return `[]` },
		"empty body":          func(string) string { return `` },
		"null body":           func(string) string { return `null` },
		"oversized body":      func(b string) string { return strings.Replace(b, `{`, `{"pad":"`+strings.Repeat("x", 5000)+`",`, 1) },
	}
	for name, base := range good {
		for mutation, apply := range mutations {
			t.Run(name+"/"+mutation, func(t *testing.T) {
				messages := queue.NewMemory()
				db := &fakeDB{}
				server := testServer(t, db, &fakeObjects{}, messages)
				response := requestWithKey(t, server, base.path, testJWT, "k", apply(base.body))
				if response.Code != http.StatusBadRequest {
					t.Fatalf("status = %d body %s", response.Code, response.Body.String())
				}
				if len(messages.Sent()) != 0 {
					t.Fatalf("a malformed request submitted %d job(s)", len(messages.Sent()))
				}
				if len(db.rpcs) != 0 {
					t.Fatalf("a malformed request reached the database: %v", db.rpcs)
				}
				jobID, err := jobs.StableID("user_test", base.kind, "k")
				if err != nil {
					t.Fatal(err)
				}
				if record, err := server.Jobs.Get(jobContext(), jobID); err == nil {
					t.Fatalf("a malformed request created a job record: %+v", record)
				}
			})
		}
	}

	handlerChecks := map[string]struct {
		path string
		body string
	}{
		"visibility: revision zero":      {visibilityPathFor, visibilityBody("public", 0)},
		"visibility: negative revision":  {visibilityPathFor, visibilityBody("public", -1)},
		"visibility: unsafe revision":    {visibilityPathFor, strings.Replace(visibilityBody("public", 1), `"expectedRevision":1`, `"expectedRevision":9007199254740992`, 1)},
		"visibility: unknown visibility": {visibilityPathFor, visibilityBody("internal", 1)},
		"visibility: wrong target type":  {visibilityPathFor, strings.Replace(visibilityBody("public", 1), "storage_object", "ig_post", 1)},
		"confirm: short proof":           {"/api/confirmations", strings.Replace(confirmBody(1), vizProof, "short", 1)},
		"confirm: forbidden characters":  {"/api/confirmations", strings.Replace(confirmBody(1), vizProof, strings.Repeat("+", 43), 1)},
		"confirm: unknown operation":     {"/api/confirmations", strings.Replace(confirmBody(1), "storage.visibility.make_public", "storage.visibility.destroy", 1)},
		"confirm: bad challenge id":      {"/api/confirmations", strings.Replace(confirmBody(1), vizChallenge, "123", 1)},
		"confirm: revision zero":         {"/api/confirmations", confirmBody(0)},
	}
	for name, c := range handlerChecks {
		t.Run(name, func(t *testing.T) {
			messages := queue.NewMemory()
			server := testServer(t, &fakeDB{}, &fakeObjects{}, messages)
			response := requestWithKey(t, server, c.path, testJWT, "k", c.body)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d body %s", response.Code, response.Body.String())
			}
			if len(messages.Sent()) != 0 {
				t.Fatalf("submitted %d job(s)", len(messages.Sent()))
			}
		})
	}

	t.Run("valid bodies are still accepted", func(t *testing.T) {
		for name, base := range good {
			messages := queue.NewMemory()
			server := testServer(t, &fakeDB{}, &fakeObjects{}, messages)
			response := requestWithKey(t, server, base.path, testJWT, "k", base.body)
			if response.Code != http.StatusAccepted || len(messages.Sent()) != 1 {
				t.Errorf("%s: status = %d sent = %d", name, response.Code, len(messages.Sent()))
			}
		}
	})
}

// cloneResult deep-copies a generated result so a mutation never leaks into the next one.
func cloneResult(value map[string]any) map[string]any {
	out := make(map[string]any, len(value))
	for key, field := range value {
		if nested, ok := field.(map[string]any); ok {
			out[key] = cloneResult(nested)
		} else {
			out[key] = field
		}
	}
	return out
}

// mutationLevels names the three object levels a confirmation_required result has.
var mutationLevels = []string{"", "target", "dialogCopy"}

// applyMutation changes one field at one level: 0 drops it, 1 adds an unknown
// sibling, 2 replaces the value with an array (a wrong type). It reports the
// mutated object so the caller can describe it.
func applyMutation(value map[string]any, level string, key string, step int) {
	object := value
	if level != "" {
		object = value[level].(map[string]any)
	}
	switch step {
	case 0:
		delete(object, key)
	case 1:
		object["unexpected"] = true
	default:
		object[key] = []any{object[key]}
	}
}

func objectKeys(value map[string]any, level string) []string {
	object := value
	if level != "" {
		object = value[level].(map[string]any)
	}
	keys := make([]string, 0, len(object))
	for key := range object {
		keys = append(keys, key)
	}
	return keys
}

func TestContractPropertyThreeConfirmationRequiredWithDialogCopy(t *testing.T) {
	t.Run("Feature: confirmation-dialog-copy, Property 3: Contract round trip preserves every valid confirmation-required result", func(t *testing.T) {
		corpus := loadCorpus(t)

		// decode(encode(result)) == result, compared both as typed fields and as canonical JSON.
		roundTrip := func(value map[string]any) error {
			raw, err := json.Marshal(value)
			if err != nil {
				return err
			}
			decoded, err := decodeOperationResult(raw)
			if err != nil {
				return fmt.Errorf("a valid result was rejected: %w\n%s", err, raw)
			}
			typed, ok := decoded.(ConfirmationRequiredResult)
			if !ok {
				return fmt.Errorf("decoded as %T", decoded)
			}
			copyFields := value["dialogCopy"].(map[string]any)
			if typed.RegistryId != value["registryId"] || typed.DialogCopy != (AuthoritativeDialogCopy{
				Title:        copyFields["title"].(string),
				Description:  copyFields["description"].(string),
				ConfirmLabel: copyFields["confirmLabel"].(string),
			}) {
				return fmt.Errorf("decoded fields differ from the input: %+v", typed)
			}
			again, err := json.Marshal(decoded)
			if err != nil {
				return err
			}
			if !reflect.DeepEqual(canonical(t, raw), canonical(t, again)) {
				return fmt.Errorf("round trip changed the value:\n  in  %s\n  out %s", raw, again)
			}
			return nil
		}
		roundTripCheck := func(seed int64) bool {
			if err := roundTrip(randomConfirmationRequired(rand.New(rand.NewSource(seed)))); err != nil {
				t.Errorf("seed %d: %v", seed, err)
				return false
			}
			return true
		}
		if err := quick.Check(roundTripCheck, &quick.Config{MaxCount: 300}); err != nil {
			t.Fatal(err)
		}

		// Every single-step mutation at every level of a valid result is rejected.
		exhaustive := rand.New(rand.NewSource(20261102))
		for i := 0; i < 20; i++ {
			base := randomConfirmationRequired(exhaustive)
			for _, level := range mutationLevels {
				for _, key := range objectKeys(base, level) {
					for step := 0; step < 3; step++ {
						value := cloneResult(base)
						applyMutation(value, level, key, step)
						raw, _ := json.Marshal(value)
						if _, err := decodeOperationResult(raw); err == nil {
							t.Fatalf("mutation %d of %q.%q was accepted: %s", step, level, key, raw)
						}
					}
				}
				// An unknown sibling is a mutation in its own right, whichever key is picked.
				value := cloneResult(base)
				applyMutation(value, level, "kind", 1)
				raw, _ := json.Marshal(value)
				if _, err := decodeOperationResult(raw); err == nil {
					t.Fatalf("an extra field at level %q was accepted: %s", level, raw)
				}
			}
		}
		mutationCheck := func(seed int64) bool {
			rng := rand.New(rand.NewSource(seed))
			value := randomConfirmationRequired(rng)
			level := mutationLevels[rng.Intn(len(mutationLevels))]
			keys := objectKeys(value, level)
			key, step := keys[rng.Intn(len(keys))], rng.Intn(3)
			applyMutation(value, level, key, step)
			raw, _ := json.Marshal(value)
			if _, err := decodeOperationResult(raw); err == nil {
				t.Errorf("seed %d: mutation %d of %q.%q was accepted: %s", seed, step, level, key, raw)
				return false
			}
			return true
		}
		if err := quick.Check(mutationCheck, &quick.Config{MaxCount: 500}); err != nil {
			t.Fatal(err)
		}

		// Every case of the shared corpus: valid decodes and round trips, legacy and malformed are rejected.
		if len(corpus.Valid) == 0 || len(corpus.Legacy) == 0 || len(corpus.Malformed) == 0 {
			t.Fatalf("the corpus is missing a section: valid %d legacy %d malformed %d", len(corpus.Valid), len(corpus.Legacy), len(corpus.Malformed))
		}
		for i, raw := range corpus.Valid {
			decoded, err := decodeOperationResult(raw)
			if err != nil {
				t.Errorf("corpus valid case %d was rejected: %v", i, err)
				continue
			}
			again, _ := json.Marshal(decoded)
			if !reflect.DeepEqual(canonical(t, raw), canonical(t, again)) {
				t.Errorf("corpus valid case %d changed in a round trip", i)
			}
		}
		for i, raw := range corpus.Legacy {
			if _, err := decodeOperationResult(raw); err == nil {
				t.Errorf("corpus legacy case %d (a seven-key result) was accepted", i)
			}
		}
		for _, bad := range corpus.Malformed {
			if _, err := decodeOperationResult(bad.Value); err == nil {
				t.Errorf("corpus malformed case %q was accepted", bad.Name)
			}
		}
	})
}
