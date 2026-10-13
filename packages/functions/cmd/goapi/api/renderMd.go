package api

import (
	"bytes"
	"context"

	"github.com/microcosm-cc/bluemonday"
	"github.com/yuin/goldmark"
)

// renderMdSanitizer is the single, immutable user-generated-content policy used
// to sanitize generated HTML. It is constructed once at package initialization
// and is safe for concurrent use across requests; it must not be mutated after
// initialization.
var renderMdSanitizer = bluemonday.UGCPolicy()

// RenderMd converts the request Markdown to HTML with unextended default
// Goldmark, then sanitizes the generated HTML with the reusable UGC policy
// before returning it. Conversion errors are returned rather than panicked.
func (s Server) RenderMd(ctx context.Context, request RenderMdRequestObject) (RenderMdResponseObject, error) {
	var buf bytes.Buffer
	if err := goldmark.Convert([]byte(request.Body.Text), &buf); err != nil {
		return nil, err
	}
	res := renderMdSanitizer.Sanitize(buf.String())
	return RenderMd200JSONResponse{Html: &res}, nil
}
