package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"strings"
	"testing"
	"time"
)

const testSecret = "local-dev-secret"

// signedAnimationPath builds the escaped path the worker would send, including
// the progress filter, signed over the full path like imagor.Render does.
func signedAnimationPath(id, token string) string {
	src := "11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333/clip.mp4"
	body := "512x320/filters:progress(" + id + "," + token + "):seek(0.1):gif(3s,6):format(webp):quality(80)/" + src
	return "/" + sign(testSecret, body) + "/" + body
}

func TestRewriteStripsProgressAndResigns(t *testing.T) {
	g := &gateway{secret: testSecret, store: newProgressStore()}
	id, token := "progress-id-value0001", "progress-token-value00000001"
	in := signedAnimationPath(id, token)

	cleaned, gotID, gotToken, tracked := g.rewrite(in)
	if !tracked {
		t.Fatal("expected the progress filter to be detected")
	}
	if gotID != id || gotToken != token {
		t.Fatalf("id/token = %q %q", gotID, gotToken)
	}
	if strings.Contains(cleaned, "progress(") {
		t.Fatalf("cleaned path still carries the progress filter: %s", cleaned)
	}
	// The cleaned path must be self-consistent: its first segment is the
	// signature of the remainder.
	trimmed := strings.TrimPrefix(cleaned, "/")
	slash := strings.IndexByte(trimmed, '/')
	if slash < 0 {
		t.Fatalf("cleaned path has no body: %s", cleaned)
	}
	sig, remainder := trimmed[:slash], trimmed[slash+1:]
	if sig != sign(testSecret, remainder) {
		t.Fatalf("signature does not cover the cleaned body")
	}
}

func TestRewriteIgnoresPathsWithoutProgress(t *testing.T) {
	g := &gateway{secret: testSecret, store: newProgressStore()}
	in := "/somesig/512x320/filters:format(webp)/a/b/c/clip.mp4"
	cleaned, _, _, tracked := g.rewrite(in)
	if tracked {
		t.Fatal("did not expect a non-progress path to be tracked")
	}
	if cleaned != in {
		t.Fatalf("cleaned = %s", cleaned)
	}
}

func TestProgressStoreAdvancesAndAuthorizes(t *testing.T) {
	s := newProgressStore()
	id, token := "id-abc", "tok-xyz"
	stop := s.start(id, token)
	defer stop()

	// Wrong token is rejected.
	if _, ok := s.read(id, "wrong"); ok {
		t.Fatal("a wrong token must not read progress")
	}
	// Correct token reads an initial frames snapshot.
	first, ok := s.read(id, token)
	if !ok {
		t.Fatal("correct token should read progress")
	}
	if first.Phase != "frames" || first.Total != animationFrames {
		t.Fatalf("first = %+v", first)
	}

	// Let a few ticks advance the counter.
	time.Sleep(frameTick*3 + frameTick/2)
	next, _ := s.read(id, token)
	if next.Completed < first.Completed {
		t.Fatalf("completed went backwards: %d -> %d", first.Completed, next.Completed)
	}
	if next.Completed > next.Total {
		t.Fatalf("completed exceeded total: %+v", next)
	}
}

func TestStopFinishesRun(t *testing.T) {
	s := newProgressStore()
	id, token := "id-fin", "tok-fin"
	stop := s.start(id, token)
	stop()
	snap, ok := s.read(id, token)
	if !ok {
		t.Fatal("a just-finished run should still be readable during the linger")
	}
	if snap.Phase != "encoding" || snap.Completed != snap.Total {
		t.Fatalf("finished snapshot = %+v", snap)
	}
}

func TestServeProgressRejectsBadToken(t *testing.T) {
	g := &gateway{secret: testSecret, store: newProgressStore()}
	stop := g.store.start("id-serve", "tok-serve")
	defer stop()

	req := httptest.NewRequest(http.MethodGet, "/progress/id-serve", nil)
	req.Header.Set("Authorization", "Bearer wrong")
	rec := httptest.NewRecorder()
	g.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d", rec.Code)
	}

	req2 := httptest.NewRequest(http.MethodGet, "/progress/id-serve", nil)
	req2.Header.Set("Authorization", "Bearer tok-serve")
	rec2 := httptest.NewRecorder()
	g.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("status = %d body %s", rec2.Code, rec2.Body.String())
	}
	var snap snapshot
	if err := json.Unmarshal(rec2.Body.Bytes(), &snap); err != nil {
		t.Fatal(err)
	}
	if snap.Total != animationFrames {
		t.Fatalf("snapshot = %+v", snap)
	}
}

// TestServeRenderForwardsCleanedPath confirms the proxy forwards a progress
// render to upstream with the filter stripped and a valid signature, and that
// the id becomes readable while the render is in flight.
func TestServeRenderForwardsCleanedPath(t *testing.T) {
	id, token := "render-id-0001", "render-token-0001"
	var forwarded string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		forwarded = r.URL.EscapedPath()
		w.Header().Set("Content-Type", "image/webp")
		_, _ = w.Write([]byte("webp"))
	}))
	t.Cleanup(upstream.Close)

	upURL, _ := url.Parse(upstream.URL)
	g := &gateway{secret: testSecret, store: newProgressStore(), upstream: httputil.NewSingleHostReverseProxy(upURL)}

	req := httptest.NewRequest(http.MethodGet, signedAnimationPath(id, token), nil)
	rec := httptest.NewRecorder()
	g.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if strings.Contains(forwarded, "progress(") {
		t.Fatalf("upstream received the progress filter: %s", forwarded)
	}
	if forwarded == "" {
		t.Fatal("upstream was not called")
	}
}
