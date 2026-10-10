// Command imagorproxy adds the sqldev progress endpoint in front of a stock
// imagorvideo server. The worker signs one path that carries a
// progress(id,token) filter and separately polls /progress/{id}. Upstream
// imagorvideo understands neither, so this proxy sits on the public port,
// extracts the filter, reports synthetic frame/encoding progress for the life
// of the render, re-signs the cleaned path, and forwards it to the real
// imagorvideo on a loopback port.
package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	// signerTruncate matches imagor.SignerTruncate and the
	// IMAGOR_SIGNER_TRUNCATE the container is started with.
	signerTruncate = 40
	// animationFrames mirrors the gif(3s,6) clip: 3 seconds at 6 fps.
	animationFrames = 18
	// frameTick is how often the synthetic frame counter advances.
	frameTick = 150 * time.Millisecond
	// lingerAfterRender keeps a finished run readable so a final poll can
	// observe the completed state before the entry is dropped.
	lingerAfterRender = 5 * time.Second
)

// progressFilter matches the progress(id,token) segment the worker injects at
// the front of the filter list. imagor filter arguments cannot contain commas
// or parentheses, so id and token are safe to capture up to the closing paren.
var progressFilter = regexp.MustCompile(`progress\(([^,()]+),([^,()]+)\):`)

func main() {
	if err := run(); err != nil {
		slog.Error("imagorproxy stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	secret := strings.TrimSpace(os.Getenv("IMAGOR_SECRET"))
	if secret == "" {
		return errors.New("IMAGOR_SECRET is required")
	}
	listen := envOr("PROXY_ADDRESS", "0.0.0.0:8000")
	upstream, err := url.Parse(envOr("UPSTREAM_URL", "http://127.0.0.1:8010"))
	if err != nil || upstream.Host == "" {
		return errors.New("UPSTREAM_URL must be a valid url")
	}

	handler := &gateway{
		secret:   secret,
		store:    newProgressStore(),
		upstream: httputil.NewSingleHostReverseProxy(upstream),
	}

	server := &http.Server{
		Addr:              listen,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	slog.Info("imagorproxy listening", "addr", listen, "upstream", upstream.String())
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

type gateway struct {
	secret   string
	store    *progressStore
	upstream *httputil.ReverseProxy
}

func (g *gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/progress/") {
		g.serveProgress(w, r)
		return
	}
	g.serveRender(w, r)
}

// serveProgress answers the worker's poll. The bearer token must match the one
// embedded in the render path for this id.
func (g *gateway) serveProgress(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/progress/")
	if id == "" || strings.Contains(id, "/") {
		http.NotFound(w, r)
		return
	}
	snap, ok := g.store.read(id, bearer(r.Header.Get("Authorization")))
	if !ok {
		// 403 keeps an unauthorized caller from distinguishing a missing id
		// from a wrong token.
		http.Error(w, `{"status":403}`, http.StatusForbidden)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(snap)
}

// serveRender strips the progress filter, re-signs the cleaned path, starts a
// synthetic progress run, and forwards the request to upstream imagorvideo.
func (g *gateway) serveRender(w http.ResponseWriter, r *http.Request) {
	cleaned, id, token, tracked := g.rewrite(r.URL.EscapedPath())
	if tracked {
		r.URL.RawPath = cleaned
		r.URL.Path = mustUnescape(cleaned)
		stop := g.store.start(id, token)
		defer stop()
	}
	g.upstream.ServeHTTP(w, r)
}

// rewrite finds the progress filter, removes it, and re-signs the remaining
// path with the shared secret so upstream imagorvideo accepts it. It works on
// the escaped path because the signature covers the escaped source key.
func (g *gateway) rewrite(escapedPath string) (cleaned, id, token string, tracked bool) {
	trimmed := strings.TrimPrefix(escapedPath, "/")
	slash := strings.IndexByte(trimmed, '/')
	if slash < 0 {
		return escapedPath, "", "", false
	}
	body := trimmed[slash+1:]
	match := progressFilter.FindStringSubmatch(body)
	if match == nil {
		return escapedPath, "", "", false
	}
	id, token = match[1], match[2]
	unsigned := strings.Replace(body, match[0], "", 1)
	return "/" + sign(g.secret, unsigned) + "/" + unsigned, id, token, true
}

// progressStore holds one synthetic run per in-flight render id.
type progressStore struct {
	mu   sync.Mutex
	runs map[string]*tracker
}

type tracker struct {
	token     string
	phase     string
	completed int
	total     int
	stopCh    chan struct{}
	stopOnce  sync.Once
}

type snapshot struct {
	Phase     string `json:"phase"`
	Completed int    `json:"completed"`
	Total     int    `json:"total"`
}

func newProgressStore() *progressStore {
	return &progressStore{runs: make(map[string]*tracker)}
}

// start begins advancing a frames->encoding progression for id and returns a
// stop function that marks the run complete and drops it after a short linger.
func (s *progressStore) start(id, token string) func() {
	r := &tracker{
		token:  token,
		phase:  "frames",
		total:  animationFrames,
		stopCh: make(chan struct{}),
	}
	s.mu.Lock()
	s.runs[id] = r
	s.mu.Unlock()

	go func() {
		ticker := time.NewTicker(frameTick)
		defer ticker.Stop()
		for {
			select {
			case <-r.stopCh:
				return
			case <-ticker.C:
				s.advance(id)
			}
		}
	}()

	return func() {
		r.stopOnce.Do(func() {
			close(r.stopCh)
			s.finish(id)
			time.AfterFunc(lingerAfterRender, func() { s.remove(id) })
		})
	}
}

// advance moves the frame counter toward the total, then switches to the
// encoding phase. completed never decreases and total never changes, which the
// worker's DynamoDB update condition requires.
func (s *progressStore) advance(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.runs[id]
	if r == nil {
		return
	}
	if r.phase == "frames" && r.completed < r.total {
		r.completed++
		if r.completed == r.total {
			r.phase = "encoding"
		}
	}
}

func (s *progressStore) finish(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r := s.runs[id]; r != nil {
		r.phase = "encoding"
		r.completed = r.total
	}
}

func (s *progressStore) remove(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.runs, id)
}

func (s *progressStore) read(id, token string) (snapshot, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.runs[id]
	if r == nil || token == "" || !hmac.Equal([]byte(r.token), []byte(token)) {
		return snapshot{}, false
	}
	return snapshot{Phase: r.phase, Completed: r.completed, Total: r.total}, true
}

// sign matches imagor.Sign: base64 URL encoding (with padding) of the HMAC,
// truncated to signerTruncate characters.
func sign(secret, path string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(path))
	encoded := base64.URLEncoding.EncodeToString(mac.Sum(nil))
	if len(encoded) > signerTruncate {
		return encoded[:signerTruncate]
	}
	return encoded
}

func bearer(header string) string {
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return ""
	}
	return strings.TrimSpace(header[len(prefix):])
}

func mustUnescape(escaped string) string {
	if decoded, err := url.PathUnescape(escaped); err == nil {
		return decoded
	}
	return escaped
}

func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
