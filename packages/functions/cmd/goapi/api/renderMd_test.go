package api

import (
	"context"
	"strings"
	"sync"
	"testing"
)

// renderMd is a small helper that invokes the handler and returns the HTML
// string, failing the test on an unexpected error or missing body.
func renderMd(t *testing.T, markdown string) string {
	t.Helper()
	var s Server
	resp, err := s.RenderMd(context.Background(), RenderMdRequestObject{
		Body: &RenderMdJSONRequestBody{Text: markdown},
	})
	if err != nil {
		t.Fatalf("RenderMd returned unexpected error: %v", err)
	}
	ok, isOK := resp.(RenderMd200JSONResponse)
	if !isOK {
		t.Fatalf("RenderMd returned %T, want RenderMd200JSONResponse", resp)
	}
	if ok.Html == nil {
		t.Fatal("RenderMd200JSONResponse.Html is nil")
	}
	return *ok.Html
}

// Table 1: default Goldmark conversion for the supported CommonMark subset.
func TestRenderMd_DefaultGoldmarkConversion(t *testing.T) {
	cases := []struct {
		name     string
		markdown string
		contains []string
	}{
		{"paragraph", "hello world", []string{"<p>hello world</p>"}},
		{"heading", "# Title", []string{"<h1>Title</h1>"}},
		{"emphasis", "*em* and **strong**", []string{"<em>em</em>", "<strong>strong</strong>"}},
		{"unordered-list", "- a\n- b", []string{"<ul>", "<li>a</li>", "<li>b</li>"}},
		{"ordered-list", "1. a\n2. b", []string{"<ol>", "<li>a</li>", "<li>b</li>"}},
		{"blockquote", "> quoted", []string{"<blockquote>", "quoted"}},
		{"inline-code", "`code`", []string{"<code>code</code>"}},
		{"fenced-code", "```\nfoo()\n```", []string{"<pre>", "<code>", "foo()"}},
		{"safe-link", "[x](https://example.com)", []string{`href="https://example.com"`, ">x</a>"}},
		{"image", "![alt](https://example.com/a.png)", []string{`src="https://example.com/a.png"`, `alt="alt"`}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := renderMd(t, tc.markdown)
			for _, want := range tc.contains {
				if !strings.Contains(got, want) {
					t.Errorf("output missing %q\ngot: %s", want, got)
				}
			}
		})
	}
}

// Table 2: GFM-only / extended syntax is NOT interpreted (no extensions).
func TestRenderMd_NoExtensionSemantics(t *testing.T) {
	cases := []struct {
		name       string
		markdown   string
		notContain []string
	}{
		{"table", "| a | b |\n| - | - |\n| 1 | 2 |", []string{"<table", "<td"}},
		{"strikethrough", "~~gone~~", []string{"<del>", "<s>"}},
		{"task-list", "- [ ] todo", []string{`type="checkbox"`}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := renderMd(t, tc.markdown)
			for _, bad := range tc.notContain {
				if strings.Contains(got, bad) {
					t.Errorf("output should not contain extension markup %q\ngot: %s", bad, got)
				}
			}
		})
	}
}

// Table 3: safe UGC is preserved after sanitization.
func TestRenderMd_SafeUGCPreserved(t *testing.T) {
	md := strings.Join([]string{
		"# Heading",
		"",
		"A paragraph with *em*, **strong**, and `code`.",
		"",
		"- item one",
		"- item two",
		"",
		"> a quote",
		"",
		"[link](https://example.com)",
		"",
		"![pic](https://example.com/p.png)",
		"",
		"```",
		"fenced()",
		"```",
	}, "\n")
	got := renderMd(t, md)
	for _, want := range []string{
		"<h1>Heading</h1>",
		"<em>em</em>",
		"<strong>strong</strong>",
		"<code>code</code>",
		"<li>item one</li>",
		"<blockquote>",
		`href="https://example.com"`,
		`src="https://example.com/p.png"`,
		"fenced()",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("sanitized output dropped safe UGC %q\ngot: %s", want, got)
		}
	}
}

// Table 4: unsafe constructs are stripped or neutralized by the sanitizer.
func TestRenderMd_UnsafeConstructsRemoved(t *testing.T) {
	cases := []struct {
		name       string
		markdown   string
		notContain []string
	}{
		{"script", "<script>alert(1)</script>", []string{"<script", "alert(1)"}},
		{"event-handler", `<a href="https://x.test" onclick="evil()">x</a>`, []string{"onclick", "evil()"}},
		{"js-protocol", `<a href="javascript:evil()">x</a>`, []string{"javascript:"}},
		{"iframe", `<iframe src="https://evil.test"></iframe>`, []string{"<iframe"}},
		{"object", `<object data="x"></object>`, []string{"<object"}},
		{"embed", `<embed src="x">`, []string{"<embed"}},
		{"style-attr", `<p style="background:url(javascript:evil())">x</p>`, []string{"javascript:"}},
		{"style-tag", "<style>body{background:red}</style>", []string{"<style"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := renderMd(t, tc.markdown)
			for _, bad := range tc.notContain {
				if strings.Contains(got, bad) {
					t.Errorf("unsafe construct survived sanitization: %q\ngot: %s", bad, got)
				}
			}
		})
	}
}

// Table 5: empty input renders successfully.
func TestRenderMd_EmptyInput(t *testing.T) {
	got := renderMd(t, "")
	if strings.Contains(got, "<script") {
		t.Errorf("unexpected script in empty render: %s", got)
	}
}

// Table 7: concurrent calls reuse one initialized policy without data races.
func TestRenderMd_ConcurrentReuse(t *testing.T) {
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			var s Server
			resp, err := s.RenderMd(context.Background(), RenderMdRequestObject{
				Body: &RenderMdJSONRequestBody{Text: "# Title\n\n<script>x</script>"},
			})
			if err != nil {
				t.Errorf("concurrent RenderMd error: %v", err)
				return
			}
			ok := resp.(RenderMd200JSONResponse)
			if ok.Html == nil || strings.Contains(*ok.Html, "<script") {
				t.Errorf("concurrent render not sanitized: %v", ok.Html)
			}
		}()
	}
	wg.Wait()
}

// Table 8: handler returns 200 JSON and never panics on ordinary input.
func TestRenderMd_HandlerReturnsSanitizedJSON(t *testing.T) {
	got := renderMd(t, "# Public\n\n<script>bad()</script>safe")
	if !strings.Contains(got, "<h1>Public</h1>") {
		t.Errorf("expected heading, got: %s", got)
	}
	if strings.Contains(got, "bad()") || strings.Contains(got, "<script") {
		t.Errorf("expected sanitized output, got: %s", got)
	}
}

func TestRenderMd_StorageReferencePlaceholder(t *testing.T) {
	const id = "22222222-2222-4222-8222-222222222222"
	got := renderMd(t, "![Cape & Co](uploads://"+strings.ToUpper(id)+")")
	want := `<span data-sqldev-storage-object="` + id + `">Cape &amp; Co</span>`
	if !strings.Contains(got, want) {
		t.Fatalf("placeholder = %s", got)
	}
	hostile := renderMd(t, `![<img src=x onerror=alert(1)>](uploads://`+id+`)`)
	if strings.Contains(hostile, "<img") || strings.Contains(hostile, "onerror") || strings.Contains(hostile, "alert(1)") {
		t.Fatalf("label was not neutralized: %s", hostile)
	}
	if !strings.Contains(hostile, `data-sqldev-storage-object="`+id+`"`) {
		t.Fatalf("hostile label dropped the reference: %s", hostile)
	}
}

func TestRenderMd_StorageReferenceStaysInert(t *testing.T) {
	const id = "22222222-2222-4222-8222-222222222222"
	cases := []string{
		"![x](uploads://not-a-uuid)",
		"`![x](uploads://" + id + ")`",
		"```\n![x](uploads://" + id + ")\n```",
		`<span data-sqldev-storage-object="` + id + `">forged</span>`,
		"![x](https://example.com/a.png)",
	}
	for _, markdown := range cases {
		got := renderMd(t, markdown)
		if strings.Contains(got, `data-sqldev-storage-object="`+id+`"`) {
			t.Errorf("transformed %q\n%s", markdown, got)
		}
	}
}

func TestRenderMd_OrdinaryImageStillRenders(t *testing.T) {
	got := renderMd(t, "before ![x](uploads://22222222-2222-4222-8222-222222222222) ![pic](https://example.com/a.png)")
	if !strings.Contains(got, `data-sqldev-storage-object="22222222-2222-4222-8222-222222222222"`) {
		t.Fatalf("missing placeholder: %s", got)
	}
	if !strings.Contains(got, `src="https://example.com/a.png"`) {
		t.Fatalf("ordinary image changed: %s", got)
	}
}
