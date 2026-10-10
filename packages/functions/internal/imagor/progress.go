package imagor

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	progressIDPrefix   = "sqldev-progress-id\n"
	progressAuthPrefix = "sqldev-progress-auth\n"
	progressPoll       = 200 * time.Millisecond
)

// ProgressID is the opaque key for one job's animation progress.
func ProgressID(secret, jobID string) string {
	return progressCode(secret, progressIDPrefix+jobID, 22)
}

// ProgressToken authenticates reads and updates for a progress ID.
func ProgressToken(secret, id string) string {
	return progressCode(secret, progressAuthPrefix+id, 32)
}

// WithProgress inserts the internal progress filter into a signed Imagor path.
func WithProgress(path, id, token string) (string, error) {
	if !progressToken(id) || !progressToken(token) || !strings.Contains(path, "filters:") {
		return "", fmt.Errorf("%w: progress filter is invalid", ErrInvalid)
	}
	return strings.Replace(path, "filters:", "filters:progress("+id+","+token+"):", 1), nil
}

func (c *Client) watchProgress(ctx context.Context, id, token string, report func(Progress)) {
	ticker := time.NewTicker(progressPoll)
	defer ticker.Stop()
	var last Progress
	poll := func() {
		next, err := c.fetchProgress(ctx, id, token)
		if err != nil || !next.Valid() || next == last {
			return
		}
		last = next
		report(next)
	}
	poll()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			poll()
		}
	}
}

func (c *Client) fetchProgress(ctx context.Context, id, token string) (Progress, error) {
	endpoint := c.progressURL + "/progress/" + id
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return Progress{}, err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := c.progressHTTP.Do(request)
	if err != nil {
		return Progress{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1024))
		return Progress{}, fmt.Errorf("%w: progress status %d", ErrUpstream, response.StatusCode)
	}
	var payload struct {
		Phase     string `json:"phase"`
		Completed int    `json:"completed"`
		Total     int    `json:"total"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1024)).Decode(&payload); err != nil {
		return Progress{}, err
	}
	progress := Progress{Phase: payload.Phase, Completed: payload.Completed, Total: payload.Total}
	if !progress.Valid() {
		return Progress{}, fmt.Errorf("%w: progress is invalid", ErrInvalid)
	}
	return progress, nil
}

func progressCode(secret, value string, size int) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(value))
	encoded := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if len(encoded) > size {
		return encoded[:size]
	}
	return encoded
}

func progressToken(value string) bool {
	if len(value) < 16 || len(value) > 64 {
		return false
	}
	for _, char := range value {
		switch {
		case char >= 'a' && char <= 'z', char >= 'A' && char <= 'Z', char >= '0' && char <= '9', char == '-', char == '_':
		default:
			return false
		}
	}
	return true
}
