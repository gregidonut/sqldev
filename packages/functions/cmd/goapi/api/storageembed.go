package api

import (
	"bytes"
	"fmt"
	"io"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

const uploadsScheme = "uploads://"

var (
	kindStorageEmbed       = ast.NewNodeKind("StorageEmbed")
	storageObjectAttribute = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
)

// storageEmbed is the opaque placeholder for one storage object. The label
// remains a child text node so Goldmark escapes it.
type storageEmbed struct {
	ast.BaseInline
	id string
}

func (n *storageEmbed) Kind() ast.NodeKind { return kindStorageEmbed }

func (n *storageEmbed) Dump(source []byte, level int) {
	ast.DumpHelper(n, source, level, map[string]string{"id": n.id}, nil)
}

type storageEmbedExtension struct{}

func (storageEmbedExtension) Extend(markdown goldmark.Markdown) {
	markdown.Parser().AddOptions(
		parser.WithASTTransformers(util.Prioritized(storageEmbedTransformer{}, 100)),
	)
	markdown.Renderer().AddOptions(
		renderer.WithNodeRenderers(util.Prioritized(storageEmbedRenderer{}, 100)),
	)
}

type storageEmbedTransformer struct{}

func (storageEmbedTransformer) Transform(document *ast.Document, _ text.Reader, _ parser.Context) {
	var images []*ast.Image
	_ = ast.Walk(document, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		image, ok := node.(*ast.Image)
		if !ok {
			return ast.WalkContinue, nil
		}
		images = append(images, image)
		return ast.WalkSkipChildren, nil
	})
	for _, image := range images {
		id, ok := storageObjectID(image.Destination)
		if !ok {
			continue
		}
		embed := &storageEmbed{id: id}
		for child := image.FirstChild(); child != nil; {
			next := child.NextSibling()
			embed.AppendChild(embed, child)
			child = next
		}
		parent := image.Parent()
		if parent == nil {
			continue
		}
		parent.ReplaceChild(parent, image, embed)
	}
}

type storageEmbedRenderer struct{}

func (storageEmbedRenderer) RegisterFuncs(registerer renderer.NodeRendererFuncRegisterer) {
	registerer.Register(kindStorageEmbed, renderStorageEmbed)
}

func renderStorageEmbed(writer util.BufWriter, _ []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	embed, ok := node.(*storageEmbed)
	if !ok || !storageObjectAttribute.MatchString(embed.id) {
		return ast.WalkContinue, nil
	}
	if entering {
		_, _ = fmt.Fprintf(writer, `<span data-sqldev-storage-object="%s">`, embed.id)
		return ast.WalkContinue, nil
	}
	_, _ = io.WriteString(writer, "</span>")
	return ast.WalkContinue, nil
}

// storageObjectID accepts uploads://<uuid> and returns the canonical id.
func storageObjectID(destination []byte) (string, bool) {
	raw := strings.TrimSpace(string(destination))
	if !strings.HasPrefix(raw, uploadsScheme) {
		return "", false
	}
	parsed, err := uuid.Parse(raw[len(uploadsScheme):])
	if err != nil || bytes.ContainsAny(destination, " \t\r\n") {
		return "", false
	}
	return parsed.String(), true
}
