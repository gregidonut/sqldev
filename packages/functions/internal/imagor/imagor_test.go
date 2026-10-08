package imagor

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSignMatchesTruncatedSHA256(t *testing.T) {
	t.Parallel()
	const secret = "secret"
	const path = "fit-in/10x10/filters:format(jpeg):quality(80)/a"
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(path))
	want := base64.URLEncoding.EncodeToString(mac.Sum(nil))[:SignerTruncate]
	if got := Sign(secret, path); got != want {
		t.Fatalf("signature = %s, want %s", got, want)
	}
	if strings.Contains(want, "/") || strings.Contains(want, "+") {
		t.Fatalf("signature is not safe in a URL path: %s", want)
	}
}

func TestPathUsesOnlyTypedOptions(t *testing.T) {
	t.Parallel()
	key := "11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333/my photo.jpg"
	path, err := Path(Request{
		SourceKey: key,
		Width:     200,
		Height:    100,
		Fit:       FitContain,
		Format:    FormatJPEG,
		Quality:   80,
	})
	if err != nil {
		t.Fatal(err)
	}
	want := "fit-in/200x100/filters:format(jpeg):quality(80)/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333/my%20photo.jpg"
	if path != want {
		t.Fatalf("path = %s", path)
	}
	cover, err := Path(Request{
		SourceKey: strings.Replace(key, "my photo.jpg", "photo.jpg", 1),
		Width:     20,
		Height:    10,
		Fit:       FitCover,
		Format:    FormatWebP,
		Quality:   60,
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(cover, "fit-in/") || !strings.HasPrefix(cover, "20x10/filters:format(webp):quality(60)/") {
		t.Fatalf("cover path = %s", cover)
	}
}

func TestPathBuildsPreviewFilters(t *testing.T) {
	t.Parallel()
	const owner = "11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333/"
	base := Request{Width: 512, Height: 320, Fit: FitCover, Format: FormatWebP, Quality: 80}
	tests := []struct {
		name    string
		preview string
		file    string
		want    string
	}{
		{
			name:    "pdf first page",
			preview: PreviewPDF,
			file:    "notes.pdf",
			want:    "512x320/filters:page(1):format(webp):quality(80)/" + owner + "notes.pdf",
		},
		{
			name:    "video poster",
			preview: PreviewVideo,
			file:    "clip.mp4",
			want:    "512x320/filters:format(webp):quality(80)/" + owner + "clip.mp4",
		},
		{
			name:    "animated webp",
			preview: PreviewAnimation,
			file:    "clip.MP4",
			want:    "512x320/filters:seek(0.1):gif(3s,6):format(webp):quality(80)/" + owner + "clip.MP4",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			request := base
			request.Preview = test.preview
			request.SourceKey = owner + test.file
			path, err := Path(request)
			if err != nil {
				t.Fatal(err)
			}
			if path != test.want {
				t.Fatalf("path = %s", path)
			}
			if strings.Contains(path, "unsafe") || strings.Contains(path, "://") {
				t.Fatalf("path is not a signed local transform: %s", path)
			}
		})
	}
}

func TestPathRejectsPreviewMismatch(t *testing.T) {
	t.Parallel()
	const key = "11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333/"
	base := Request{Width: 20, Height: 10, Fit: FitCover, Format: FormatWebP, Quality: 80}
	tests := []struct {
		name    string
		preview string
		file    string
		format  string
	}{
		{name: "unknown preview", preview: "gif(99)", file: "clip.mp4"},
		{name: "animation jpeg", preview: PreviewAnimation, file: "clip.mp4", format: FormatJPEG},
		{name: "pdf image", preview: PreviewPDF, file: "photo.jpg"},
		{name: "animation pdf", preview: PreviewAnimation, file: "notes.pdf"},
		{name: "video text", preview: PreviewVideo, file: "notes.txt"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			request := base
			request.Preview = test.preview
			request.SourceKey = key + test.file
			if test.format != "" {
				request.Format = test.format
			}
			if _, err := Path(request); !errors.Is(err, ErrInvalid) {
				t.Fatalf("error = %v", err)
			}
		})
	}
}

func TestPathRejectsUnsafeSources(t *testing.T) {
	t.Parallel()
	base := Request{Width: 10, Height: 10, Fit: FitContain, Format: FormatPNG, Quality: 50}
	tests := []struct {
		name string
		key  string
	}{
		{name: "traversal", key: "11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333/../secret"},
		{name: "remote url", key: "11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333/https://evil.test/a.jpg"},
		{name: "filter injection", key: "11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333/filters:watermark(x)"},
		{name: "too wide", key: "11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333/a.jpg"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			request := base
			request.SourceKey = test.key
			if test.name == "too wide" {
				request.Width = MaxEdge + 1
			}
			if _, err := Path(request); !errors.Is(err, ErrInvalid) {
				t.Fatalf("error = %v", err)
			}
		})
	}
}

func TestNewRequiresLocalhost(t *testing.T) {
	t.Parallel()
	if _, err := New("https://images.example", "secret"); err == nil {
		t.Fatal("accepted a remote imagor url")
	}
	if _, err := New("http://127.0.0.1:8000", " "); err == nil {
		t.Fatal("accepted an empty secret")
	}
}

func TestRenderSignsAndLimitsTheResponse(t *testing.T) {
	t.Parallel()
	request := Request{
		SourceKey: "11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333/photo.jpg",
		Width:     20,
		Height:    10,
		Fit:       FitContain,
		Format:    FormatJPEG,
		Quality:   80,
	}
	path, err := Path(request)
	if err != nil {
		t.Fatal(err)
	}
	const secret = "test-secret"
	signature := Sign(secret, path)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.EscapedPath() != "/"+signature+"/"+path {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write([]byte("jpeg"))
	}))
	t.Cleanup(server.Close)
	client, err := New(server.URL, secret)
	if err != nil {
		t.Fatal(err)
	}
	image, err := client.Render(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if image.ContentType != "image/jpeg" || string(image.Body) != "jpeg" {
		t.Fatalf("image = %+v", image)
	}

	tests := []struct {
		name    string
		status  int
		media   string
		body    []byte
		wantErr error
	}{
		{name: "upstream", status: http.StatusInternalServerError, media: "text/plain", body: []byte("nope"), wantErr: ErrUpstream},
		{name: "media", status: http.StatusOK, media: "image/gif", body: []byte("gif"), wantErr: ErrMediaType},
		{name: "size", status: http.StatusOK, media: "image/jpeg", body: bytes.Repeat([]byte("a"), MaxImageBytes+1), wantErr: ErrTooLarge},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", test.media)
				w.WriteHeader(test.status)
				_, _ = w.Write(test.body)
			}))
			t.Cleanup(upstream.Close)
			limited, err := New(upstream.URL, secret)
			if err != nil {
				t.Fatal(err)
			}
			_, err = limited.Render(context.Background(), request)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("error = %v", err)
			}
			if strings.Contains(err.Error(), signature) {
				t.Fatalf("error leaked the signature: %v", err)
			}
		})
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = client.Render(ctx, request)
	if !errors.Is(err, ErrTimeout) {
		t.Fatalf("canceled error = %v", err)
	}
}

func TestResultKeyIsOwnerScoped(t *testing.T) {
	t.Parallel()
	key, err := ResultKey("user_test", "11111111-1111-4111-8111-111111111111")
	if err != nil {
		t.Fatal(err)
	}
	if key != "images/user_test/11111111-1111-4111-8111-111111111111" {
		t.Fatalf("key = %s", key)
	}
	if _, err := ResultKey("user/test", "11111111-1111-4111-8111-111111111111"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("error = %v", err)
	}
}
