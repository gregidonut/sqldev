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
// initialization. The only addition to the UGC policy is the opaque storage
// placeholder attribute.
var renderMdSanitizer = newRenderMdSanitizer()

// renderMarkdown is immutable after initialization. Its only extension rewrites
// uploads:// object images into placeholders; every other construct stays on
// Goldmark's CommonMark defaults.
var renderMarkdown = goldmark.New(goldmark.WithExtensions(storageEmbedExtension{}))

func newRenderMdSanitizer() *bluemonday.Policy {
	policy := bluemonday.UGCPolicy()
	policy.AllowAttrs("data-sqldev-storage-object").Matching(storageObjectAttribute).OnElements("span")
	return policy
}

// RenderMd converts the request Markdown to HTML, then sanitizes the generated
// HTML with the reusable UGC policy before returning it. Conversion errors are
// returned rather than panicked.
func (s Server) RenderMd(ctx context.Context, request RenderMdRequestObject) (RenderMdResponseObject, error) {
	var buf bytes.Buffer
	if err := renderMarkdown.Convert([]byte(request.Body.Text), &buf); err != nil {
		return nil, err
	}
	res := renderMdSanitizer.Sanitize(buf.String())
	return RenderMd200JSONResponse{Html: &res}, nil
}
