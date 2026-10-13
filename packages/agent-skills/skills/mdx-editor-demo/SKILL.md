---
name: mdx-editor-demo
description: >
  Explains the MDXEditor Goldmark demo at /components/mdxEditor: its state
  ownership (React Hook Form owns the draft, TanStack Query owns request
  lifecycle, a non-persisted Zustand store owns editor mode / output tab / the
  atomic last-success snapshot), the interchangeable MDXEditor and CodeMirror
  Vim editors over one draft, the authenticated /api/renderMd proxy rewrite to
  the public Go /renderMd, and the server-side Goldmark+bluemonday trust
  boundary. Load before changing the demo page, its editors, its render path,
  or the /renderMd handler.
---

# MDX Editor Demo

An authenticated component demo at `/components/mdxEditor` that authors Markdown
in either a CommonMark/Goldmark-subset MDXEditor or a CodeMirror 6 Vim source
editor, renders it through the Go gateway, and shows synchronized Markdown,
sanitized HTML source, and a sanitized preview. Trust current source over this
document.

Governing skills — load them when touching this area:

- `valid-state-types` — the last-success snapshot is modeled so partial
  (markdown-only / html-only) states are unrepresentable.
- `react-aria` — the controls (toggle, tabs, form) and accessibility come from
  React Aria Components.
- `react-doctor` — run after any React change here and confirm the score does
  not regress (feature currently 100/100).

## Source of truth

| Concern | Authored source |
| --- | --- |
| Page (auth + island mount) | `packages/frontend/src/pages/components/mdxEditor/index.astro` (`requirePageAuth` + `ComponentPage` + `client:only="react"`) |
| Island + module-scoped QueryClient | `.../mdxEditor/_components/react/index.tsx` |
| Form, mutation, mode orchestration, status/error | `.../_components/react/MdxEditorDemo.tsx` |
| Non-persisted UI + last-success store | `.../_components/react/mdxEditorStore.ts` |
| Typed render client + `SanitizedHtml` brand | `.../_components/react/renderMarkdownClient.ts` |
| Output tabs + single preview sink | `.../_components/react/OutputTabs.tsx` |
| Shared editor adapter contract | `.../_components/react/editors/MarkdownEditor.ts` |
| MDXEditor adapter (Goldmark subset) | `.../_components/react/editors/VisualMarkdownEditor.tsx` |
| CodeMirror Vim adapter | `.../_components/react/editors/VimMarkdownEditor.tsx` |
| CodeMirror Dracula theme | `.../_components/react/editors/codeMirrorTheme.ts` |
| Lazy editor boundaries | `.../_components/react/editors/LazyEditors.tsx` |
| Feature-scoped Dracula CSS | `.../_components/react/mdxEditorDemo.css` |
| Exact proxy rewrite | `packages/frontend/src/server/mapBrowserApiPath.ts`, applied in `goApiProxy.ts` |
| Go render + sanitize | `packages/functions/cmd/goapi/api/renderMd.go` |
| Cypress E2E | `packages/e2et/cypress/e2e/mdxEditor.cy.ts` |

## Invariants

- **One draft authority.** React Hook Form owns the Markdown draft. Both editors
  are controlled views over the same field; neither keeps a durable copy. Mode
  switches preserve the draft byte-for-byte and move focus into the ready editor.
- **Lifecycle vs UI vs server state are separate.** TanStack Query owns
  pending/success/error. The Zustand store (`mdxEditorStore.ts`) is plain
  `create()` with NO persist and holds only `editorMode`, `selectedOutputTab`,
  and `lastSuccess`. Reload resets to `visual` / `markdown` / `empty`.
- **Atomic snapshot from mutation variables.** `onSuccess` commits
  `{ markdown: variables.text, html }` so the displayed Markdown always matches
  the HTML even if editing continued while pending. Pending/error never clear a
  prior successful snapshot.
- **Vim keymap priority.** In `VimMarkdownEditor.tsx`, `vim()` must precede every
  other keymap extension; external RHF value syncs are guarded with an
  `externalSync` annotation to avoid feedback loops; one `EditorView` per mount,
  destroyed on unmount.
- **Server is the trust boundary.** `renderMd.go` runs unextended
  `goldmark.Convert` then a single package-level `bluemonday.UGCPolicy()`
  (constructed once, never mutated, reused concurrently). The client
  `SanitizedHtml` brand is provenance only — introduced solely by a validated
  2xx response — and only `OutputTabs`'s single preview sink accepts it. Source
  tabs are text-only.
- **Exact proxy rewrite.** `mapBrowserApiPath` rewrites only `/api/renderMd` →
  `/renderMd`; all other `/api/**` paths and the query string are unchanged. The
  browser calls same-origin `/api/renderMd` (authenticated); the Go `/renderMd`
  stays public and its OpenAPI path is unchanged.
- **Lazy per-mode chunks.** MDXEditor and CodeMirror/Vim load in separate lazy
  chunks (`VisualMarkdownEditor.*`, `VimMarkdownEditor.*`); the Vim chunk loads
  only after Vim mode is first requested.

## Dependencies

Frontend (exact-pinned via Bun): `@mdxeditor/editor`, `@codemirror/state|view|commands|language|lang-markdown`, `@lezer/highlight`, `@replit/codemirror-vim`. Go: `github.com/microcosm-cc/bluemonday`.
