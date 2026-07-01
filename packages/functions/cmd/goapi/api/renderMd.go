package api

import (
	"bytes"
	"context"

	"github.com/yuin/goldmark"
)

func (s Server) RenderMd(ctx context.Context, request RenderMdRequestObject) (RenderMdResponseObject, error) {
	var buf bytes.Buffer
	if err := goldmark.Convert([]byte(request.Body.Text), &buf); err != nil {
		panic(err)
	}
	res := buf.String()
	return RenderMd200JSONResponse{Html: &res}, nil
}
