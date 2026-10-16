package api

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"os"
	"reflect"
	"strings"
	"testing"
	"testing/quick"
	"time"

	"github.com/google/uuid"

	"github.com/gregidonut/sqldev/packages/functions/internal/queue"
)

type contractCorpus struct {
	Valid     []json.RawMessage `json:"valid"`
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

// randomValidResult builds a result the contract allows.
func randomValidResult(rng *rand.Rand) map[string]any {
	target := map[string]any{"type": "storage_object", "id": randomUUID(rng)}
	revision := 1 + rng.Int63n(maxConfigRevision)
	switch rng.Intn(3) {
	case 0:
		expires := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).Add(time.Duration(rng.Int63n(1 << 50)))
		return map[string]any{
			"kind": "confirmation_required", "operationKind": "storage.visibility.make_public", "target": target,
			"expectedRevision": revision, "challengeId": randomUUID(rng), "proof": randomProof(rng),
			"expiresAt": expires.Format(time.RFC3339Nano),
		}
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
		body string
	}{
		"visibility": {visibilityPathFor, visibilityBody("public", 1)},
		"confirm":    {"/api/confirmations", confirmBody(1)},
	}
	mutations := map[string]func(string) string{
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
				server := testServer(t, &fakeDB{}, &fakeObjects{}, messages)
				response := requestWithKey(t, server, base.path, testJWT, "k", apply(base.body))
				if response.Code != http.StatusBadRequest {
					t.Fatalf("status = %d body %s", response.Code, response.Body.String())
				}
				if len(messages.Sent()) != 0 {
					t.Fatalf("a malformed request submitted %d job(s)", len(messages.Sent()))
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
