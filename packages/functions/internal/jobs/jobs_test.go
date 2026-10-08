package jobs

import (
	"strings"
	"testing"
)

func TestStableIDRepeatsForTheSameCallerAndKey(t *testing.T) {
	first, err := StableID("user_a", KindCreateViewItem, "key-1")
	if err != nil {
		t.Fatal(err)
	}
	second, err := StableID("user_a", KindCreateViewItem, "key-1")
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatalf("id = %s, repeated as %s", first, second)
	}
	other, err := StableID("user_b", KindCreateViewItem, "key-1")
	if err != nil {
		t.Fatal(err)
	}
	if other == first {
		t.Fatal("a different caller reused the job id")
	}
}

func TestEnvelopeHasNoTokenField(t *testing.T) {
	body, err := (Envelope{
		Version: Version,
		JobID:   "11111111-1111-4111-8111-111111111111",
		Kind:    KindListView,
		Claims:  Claims{Subject: "user_a", Role: "authenticated"},
		Payload: []byte(`{"view":"igPosts"}`),
	}).Marshal()
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(body, "eyJ") || strings.Contains(strings.ToLower(body), "bearer") {
		t.Fatalf("envelope carried credential-shaped data: %s", body)
	}
}

func TestImagorReusesAnIdempotencyKey(t *testing.T) {
	if !Mutation(KindImagor) {
		t.Fatal("imagor retries must reuse the job id")
	}
	_, err := Parse(`{"version":1,"jobId":"11111111-1111-4111-8111-111111111111","kind":"imgproxy","claims":{"sub":"user_a","role":"authenticated"},"payload":{}}`)
	if err == nil || !strings.Contains(err.Error(), "unknown job kind") {
		t.Fatalf("error = %v", err)
	}
}

func TestParseRejectsUnknownVersion(t *testing.T) {
	_, err := Parse(`{"version":9,"jobId":"11111111-1111-4111-8111-111111111111","kind":"listView","claims":{"sub":"user_a","role":"authenticated"},"payload":{}}`)
	if err == nil || !strings.Contains(err.Error(), "version") {
		t.Fatalf("error = %v", err)
	}
}
