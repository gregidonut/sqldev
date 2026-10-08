// Package imagor signs typed image requests for the private Imagor server.
// Callers cannot supply a raw Imagor path or a remote URL.
package imagor

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	FitContain = "contain"
	FitCover   = "cover"

	FormatJPEG = "jpeg"
	FormatPNG  = "png"
	FormatWebP = "webp"

	MaxEdge        = 4096
	SignerTruncate = 40
	MaxImageBytes  = 8 << 20

	requestTimeout = 25 * time.Second
)

var (
	ErrUpstream  = errors.New("imagor request failed")
	ErrTooLarge  = errors.New("transformed image is too large")
	ErrMediaType = errors.New("transformed image type is not supported")
	ErrTimeout   = errors.New("imagor request timed out")
	ErrInvalid   = errors.New("image request is invalid")
)

// Request is the queued transform. Its JSON shape matches the public API.
type Request struct {
	SourceKey string `json:"sourceKey"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	Fit       string `json:"fit"`
	Format    string `json:"format"`
	Quality   int    `json:"quality"`
}

// Image is a bounded response from the private server.
type Image struct {
	ContentType string
	Body        []byte
}

// Client calls the loopback Imagor process. It never enables unsafe mode.
type Client struct {
	baseURL string
	secret  string
	http    *http.Client
}

// New rejects a non-local URL so the worker cannot be pointed at a public service.
func New(rawURL, secret string) (*Client, error) {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return nil, errors.New("imagor secret is required")
	}
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Host == "" || parsed.Scheme != "http" {
		return nil, errors.New("imagor url must be http on localhost")
	}
	host := parsed.Hostname()
	if host != "127.0.0.1" && host != "localhost" {
		return nil, errors.New("imagor url must be http on localhost")
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return &Client{
		baseURL: strings.TrimRight(parsed.String(), "/"),
		secret:  secret,
		http: &http.Client{
			Timeout: requestTimeout,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}, nil
}

// NewFromEnv returns a nil client when the host has no signing secret.
// The caller must not store that nil pointer in an interface.
func NewFromEnv() (*Client, error) {
	secret := strings.TrimSpace(os.Getenv("IMAGOR_SECRET"))
	if secret == "" {
		return nil, nil
	}
	rawURL := strings.TrimSpace(os.Getenv("IMAGOR_URL"))
	if rawURL == "" {
		rawURL = "http://127.0.0.1:8000"
	}
	return New(rawURL, secret)
}

// Validate checks the typed options and storage-key shape before a path is signed.
func Validate(request Request) error {
	if request.Width < 1 || request.Width > MaxEdge || request.Height < 1 || request.Height > MaxEdge {
		return fmt.Errorf("%w: dimensions are outside the allowed range", ErrInvalid)
	}
	if request.Fit != FitContain && request.Fit != FitCover {
		return fmt.Errorf("%w: fit is not supported", ErrInvalid)
	}
	if request.Format != FormatJPEG && request.Format != FormatPNG && request.Format != FormatWebP {
		return fmt.Errorf("%w: format is not supported", ErrInvalid)
	}
	if request.Quality < 1 || request.Quality > 100 {
		return fmt.Errorf("%w: quality is outside the allowed range", ErrInvalid)
	}
	if err := validateSourceKey(request.SourceKey); err != nil {
		return err
	}
	return nil
}

// Path builds the Imagor path that is covered by the signature.
func Path(request Request) (string, error) {
	if err := Validate(request); err != nil {
		return "", err
	}
	size := fmt.Sprintf("%dx%d", request.Width, request.Height)
	if request.Fit == FitContain {
		size = "fit-in/" + size
	}
	filters := fmt.Sprintf("filters:format(%s):quality(%d)", request.Format, request.Quality)
	return size + "/" + filters + "/" + escapeKey(request.SourceKey), nil
}

// Sign returns the truncated SHA-256 signature Imagor compares to the first path segment.
func Sign(secret, path string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(path))
	encoded := base64.URLEncoding.EncodeToString(mac.Sum(nil))
	if len(encoded) > SignerTruncate {
		return encoded[:SignerTruncate]
	}
	return encoded
}

// ResultKey is the owner-scoped object key for one job's transformed bytes.
func ResultKey(owner, jobID string) (string, error) {
	owner = strings.TrimSpace(owner)
	jobID = strings.TrimSpace(jobID)
	if owner == "" || jobID == "" || strings.ContainsAny(owner, "/\\?#") || strings.ContainsAny(jobID, "/\\?#") {
		return "", fmt.Errorf("%w: result key is not safe", ErrInvalid)
	}
	return "images/" + owner + "/" + jobID, nil
}

// ContentType returns the media type produced for a supported format.
func ContentType(format string) (string, error) {
	switch format {
	case FormatJPEG:
		return "image/jpeg", nil
	case FormatPNG:
		return "image/png", nil
	case FormatWebP:
		return "image/webp", nil
	default:
		return "", fmt.Errorf("%w: format is not supported", ErrInvalid)
	}
}

// Render signs the request and downloads the processed image from loopback.
func (c *Client) Render(ctx context.Context, request Request) (Image, error) {
	path, err := Path(request)
	if err != nil {
		return Image{}, err
	}
	expected, err := ContentType(request.Format)
	if err != nil {
		return Image{}, err
	}
	endpoint := c.baseURL + "/" + Sign(c.secret, path) + "/" + path
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return Image{}, fmt.Errorf("%w: build request", ErrUpstream)
	}
	response, err := c.http.Do(httpRequest)
	if err != nil {
		if isTimeout(err) {
			return Image{}, ErrTimeout
		}
		// The raw client error includes the signed URL, so it stays off the returned chain.
		return Image{}, ErrUpstream
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1024))
		return Image{}, fmt.Errorf("%w: status %d", ErrUpstream, response.StatusCode)
	}
	received := mediaType(response.Header.Get("Content-Type"))
	if received != expected {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1024))
		return Image{}, ErrMediaType
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, MaxImageBytes+1))
	if err != nil {
		return Image{}, fmt.Errorf("%w: read image", ErrUpstream)
	}
	if len(body) == 0 {
		return Image{}, ErrUpstream
	}
	if len(body) > MaxImageBytes {
		return Image{}, ErrTooLarge
	}
	return Image{ContentType: expected, Body: body}, nil
}

func validateSourceKey(key string) error {
	parts := strings.SplitN(strings.TrimSpace(key), "/", 4)
	if len(parts) != 4 {
		return fmt.Errorf("%w: source key is invalid", ErrInvalid)
	}
	for _, part := range parts[:3] {
		if _, err := uuid.Parse(part); err != nil {
			return fmt.Errorf("%w: source key is invalid", ErrInvalid)
		}
	}
	for _, segment := range strings.Split(parts[3], "/") {
		if segment == "" || segment == "." || segment == ".." {
			return fmt.Errorf("%w: source key is invalid", ErrInvalid)
		}
		lower := strings.ToLower(segment)
		if strings.Contains(segment, "\\") || strings.Contains(lower, "://") || strings.Contains(lower, "filters:") {
			return fmt.Errorf("%w: source key is invalid", ErrInvalid)
		}
		if strings.ContainsAny(segment, "\r\n\t") {
			return fmt.Errorf("%w: source key is invalid", ErrInvalid)
		}
	}
	return nil
}

func escapeKey(key string) string {
	parts := strings.Split(key, "/")
	for i, part := range parts {
		parts[i] = url.PathEscape(part)
	}
	return strings.Join(parts, "/")
}

func isTimeout(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return true
	}
	var urlErr *url.Error
	return errors.As(err, &urlErr) && urlErr.Timeout()
}

func mediaType(header string) string {
	value, _, _ := strings.Cut(header, ";")
	return strings.ToLower(strings.TrimSpace(value))
}
