package api

import (
	"fmt"
	"io"
	"mime"
	"net/http"
	"path"
	"strings"
)

// downloadObjectResponse is a custom strict-server response that sets
// Content-Disposition so browsers/Postman save with the real filename.
type downloadObjectResponse struct {
	Body          io.Reader
	ContentLength int64
	ContentType   string
	Filename      string
}

func (response downloadObjectResponse) VisitDownloadObjectResponse(w http.ResponseWriter) error {
	contentType := response.ContentType
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)

	if response.Filename != "" {
		w.Header().Set("Content-Disposition", contentDispositionAttachment(response.Filename))
	}

	if response.ContentLength != 0 {
		w.Header().Set("Content-Length", fmt.Sprint(response.ContentLength))
	}
	w.WriteHeader(http.StatusOK)

	if closer, ok := response.Body.(io.ReadCloser); ok {
		defer closer.Close()
	}
	_, err := io.Copy(w, response.Body)
	return err
}

func objectFilename(key string) string {
	name := path.Base(strings.TrimSpace(key))
	if name == "" || name == "." || name == "/" {
		return "download"
	}
	return name
}

func contentTypeForObject(key string, s3ContentType *string) string {
	if s3ContentType != nil {
		if ct := strings.TrimSpace(*s3ContentType); ct != "" && ct != "binary/octet-stream" && ct != "application/octet-stream" {
			return ct
		}
	}
	if ext := path.Ext(key); ext != "" {
		if ct := mime.TypeByExtension(ext); ct != "" {
			return ct
		}
	}
	return "application/octet-stream"
}

func contentDispositionAttachment(filename string) string {
	// Escape quotes/backslashes for a quoted filename parameter.
	escaped := strings.ReplaceAll(filename, `\`, `\\`)
	escaped = strings.ReplaceAll(escaped, `"`, `\"`)
	return fmt.Sprintf(`attachment; filename="%s"`, escaped)
}
