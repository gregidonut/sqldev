package imagor

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestRenderReportsDynamicAnimationProgress(t *testing.T) {
	t.Parallel()
	request := Request{
		SourceKey: "11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333/clip.mp4",
		Width:     32,
		Height:    20,
		Fit:       FitCover,
		Format:    FormatWebP,
		Quality:   80,
		Preview:   PreviewAnimation,
	}
	const secret = "test-secret"
	const jobID = "job-progress"
	id := ProgressID(secret, jobID)
	token := ProgressToken(secret, id)
	path, err := Path(request)
	if err != nil {
		t.Fatal(err)
	}
	signedPath, err := WithProgress(path, id, token)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(signedPath, "18") {
		t.Fatal("progress path hardcoded a frame cap")
	}
	progress := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+token || r.URL.Path != "/progress/"+id {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"phase":"frames","completed":3,"total":7}`))
	}))
	t.Cleanup(progress.Close)
	ready := make(chan struct{})
	var once sync.Once
	var got Progress
	images := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Path, id) || !strings.Contains(r.URL.Path, token) {
			http.NotFound(w, r)
			return
		}
		select {
		case <-ready:
		case <-time.After(2 * time.Second):
			t.Error("timed out waiting for progress")
		}
		w.Header().Set("Content-Type", "image/webp")
		_, _ = w.Write([]byte("webp"))
	}))
	t.Cleanup(images.Close)
	client, err := New(images.URL, secret)
	if err != nil {
		t.Fatal(err)
	}
	if err := client.SetProgressURL(progress.URL); err != nil {
		t.Fatal(err)
	}
	image, err := client.Render(context.Background(), request, jobID, func(progress Progress) {
		once.Do(func() {
			got = progress
			close(ready)
		})
	})
	if err != nil {
		t.Fatal(err)
	}
	if string(image.Body) != "webp" {
		t.Fatalf("image = %q", image.Body)
	}
	if got.Completed != 3 || got.Total != 7 || got.Phase != "frames" {
		t.Fatalf("progress = %+v", got)
	}
}

func TestSetProgressURLRejectsRemoteHosts(t *testing.T) {
	t.Parallel()
	client, err := New("http://127.0.0.1:8000", "secret")
	if err != nil {
		t.Fatal(err)
	}
	if err := client.SetProgressURL("https://images.example/progress"); err == nil {
		t.Fatal("accepted a remote progress url")
	}
}
