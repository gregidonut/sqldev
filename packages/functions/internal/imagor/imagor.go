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

	// PreviewImage resizes a still image. An empty preview means the same thing.
	PreviewImage = "image"
	// PreviewPDF renders the first page.
	PreviewPDF = "pdf"
	// PreviewVideo asks imagorvideo to choose one representative frame.
	PreviewVideo = "video"
	// PreviewAnimation renders a short looping WebP clip from a video.
	PreviewAnimation = "animation"

	animationSeek = "0.1"
	animationClip = "3s"
	animationFPS  = "6"

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
	Preview   string `json:"preview,omitempty"`
}

// Image is a bounded response from the private server.
type Image struct {
	ContentType string
	Body        []byte
}

// Progress is one observation from the private animation endpoint.
type Progress struct {
	Phase     string
	Completed int
	Total     int
}

// Valid reports whether the observation can drive a determinate progress bar.
func (p Progress) Valid() bool {
	if p.Phase != "frames" && p.Phase != "encoding" {
		return false
	}
	return p.Total > 0 && p.Completed >= 0 && p.Completed <= p.Total
}

// Client calls the loopback Imagor process. It never enables unsafe mode.
type Client struct {
	baseURL      string
	progressURL  string
	secret       string
	http         *http.Client
	progressHTTP *http.Client
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
		baseURL:     strings.TrimRight(parsed.String(), "/"),
		progressURL: "http://127.0.0.1:8001",
		secret:      secret,
		http: &http.Client{
			Timeout: requestTimeout,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		progressHTTP: &http.Client{
			Timeout: 2 * time.Second,
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
	client, err := New(rawURL, secret)
	if err != nil {
		return nil, err
	}
	if progressURL := strings.TrimSpace(os.Getenv("PROGRESS_URL")); progressURL != "" {
		if err := client.SetProgressURL(progressURL); err != nil {
			return nil, err
		}
	}
	return client, nil
}

// SetProgressURL sets the loopback progress endpoint. An empty value keeps the default.
func (c *Client) SetProgressURL(rawURL string) error {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Host == "" || parsed.Scheme != "http" {
		return errors.New("progress url must be http on localhost")
	}
	host := parsed.Hostname()
	if host != "127.0.0.1" && host != "localhost" {
		return errors.New("progress url must be http on localhost")
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	c.progressURL = strings.TrimRight(parsed.String(), "/")
	return nil
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
	preview := normalizePreview(request.Preview)
	if preview == "" {
		return fmt.Errorf("%w: preview is not supported", ErrInvalid)
	}
	if preview == PreviewAnimation && request.Format != FormatWebP {
		return fmt.Errorf("%w: animation must be webp", ErrInvalid)
	}
	if err := validateSourceKey(request.SourceKey); err != nil {
		return err
	}
	if !previewMatches(preview, sourceExtension(request.SourceKey)) {
		return fmt.Errorf("%w: preview does not match the file", ErrInvalid)
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
	filters := previewFilters(normalizePreview(request.Preview), request.Format, request.Quality)
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
// report receives changed animation progress until the image response finishes.
func (c *Client) Render(ctx context.Context, request Request, jobID string, report func(Progress)) (Image, error) {
	path, err := Path(request)
	if err != nil {
		return Image{}, err
	}
	var progressID, progressToken string
	if report != nil && normalizePreview(request.Preview) == PreviewAnimation {
		progressID = ProgressID(c.secret, jobID)
		progressToken = ProgressToken(c.secret, progressID)
		path, err = WithProgress(path, progressID, progressToken)
		if err != nil {
			return Image{}, err
		}
	}
	expected, err := ContentType(request.Format)
	if err != nil {
		return Image{}, err
	}
	if progressID != "" {
		watchCtx, cancel := context.WithCancel(ctx)
		done := make(chan struct{})
		go func() {
			defer close(done)
			c.watchProgress(watchCtx, progressID, progressToken, report)
		}()
		defer func() {
			cancel()
			<-done
		}()
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

func normalizePreview(preview string) string {
	if preview == "" {
		return PreviewImage
	}
	switch preview {
	case PreviewImage, PreviewPDF, PreviewVideo, PreviewAnimation:
		return preview
	default:
		return ""
	}
}

func previewFilters(preview, format string, quality int) string {
	output := fmt.Sprintf("format(%s):quality(%d)", format, quality)
	switch preview {
	case PreviewPDF:
		return "filters:page(1):" + output
	case PreviewAnimation:
		return "filters:seek(" + animationSeek + "):gif(" + animationClip + "," + animationFPS + "):" + output
	default:
		return "filters:" + output
	}
}

func previewMatches(preview, extension string) bool {
	switch preview {
	case PreviewImage:
		return imageExtensions[extension]
	case PreviewPDF:
		return extension == "pdf"
	case PreviewVideo, PreviewAnimation:
		return videoExtensions[extension]
	default:
		return false
	}
}

func sourceExtension(key string) string {
	name := key
	if slash := strings.LastIndex(key, "/"); slash >= 0 {
		name = key[slash+1:]
	}
	dot := strings.LastIndex(name, ".")
	if dot < 0 || dot == len(name)-1 {
		return ""
	}
	return strings.ToLower(name[dot+1:])
}

var imageExtensions = map[string]bool{
	"avif": true,
	"bmp":  true,
	"gif":  true,
	"heic": true,
	"heif": true,
	"jpeg": true,
	"jpg":  true,
	"png":  true,
	"tif":  true,
	"tiff": true,
	"webp": true,
}

var videoExtensions = map[string]bool{
	"avi":  true,
	"m4v":  true,
	"mkv":  true,
	"mov":  true,
	"mp4":  true,
	"mpeg": true,
	"mpg":  true,
	"webm": true,
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
