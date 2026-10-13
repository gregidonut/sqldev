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

The editor is now a reusable component; the demo is one consumer.

| Concern | Authored source |
| --- | --- |
| Page (auth + island mount) | `packages/frontend/src/pages/components/mdxEditor/index.astro` (`requirePageAuth` + `ComponentPage` + `client:only="react"`) |
| Island + module-scoped QueryClient | `.../mdxEditor/_components/react/index.tsx` (imports the reusable `mdxEditor.css` and demo-local preview CSS) |
| Demo form, render mutation, mode/output, status/error | `.../_components/react/MdxEditorDemo.tsx` (uses `MdxEditor` with fixed `100%` sizing) |
| Non-persisted demo UI + last-success store | `.../_components/react/mdxEditorStore.ts` |
| Output tabs + single preview sink | `.../_components/react/OutputTabs.tsx` (demo-local; only `dangerouslySetInnerHTML`) |
| Demo preview-only CSS | `.../_components/react/mdxEditorDemo.css` |
| Reusable controlled editor | `packages/frontend/src/components/react/MdxEditor/MdxEditor.tsx` |
| RHF field adapter | `.../MdxEditor/MdxEditorField.tsx` |
| Sizing union + pure helpers | `.../MdxEditor/types.ts` (`EditorSizing`, `toSizingStyle`, `assertValidSizing`) |
| Shared editor contract | `.../MdxEditor/editors/MarkdownEditor.ts` (re-exports from `types.ts`) |
| MDXEditor adapter (Goldmark subset) | `.../MdxEditor/editors/VisualMarkdownEditor.tsx` |
| CodeMirror Vim adapter | `.../MdxEditor/editors/VimMarkdownEditor.tsx` (`vim()` first, `Mod-Enter` after, sizing `Compartment`) |
| Submit-shortcut classifier | `.../MdxEditor/editors/submitShortcut.ts` |
| Lazy per-mode boundaries | `.../MdxEditor/editors/LazyEditors.tsx` |
| CodeMirror Dracula theme | `.../MdxEditor/editors/codeMirrorTheme.ts` |
| Scoped authoring CSS | `.../MdxEditor/mdxEditor.css` (no preview sink) |
| Typed render client + `SanitizedHtml` brand | `.../MdxEditor/queryOptions/renderMarkdownClient.ts` |
| Pure render/create/fetch-one/update options | `.../MdxEditor/queryOptions/*.ts` |
| Guarded submit context | `packages/frontend/src/components/react/MutationForm/MutationFormContext.ts` + `MutationForm.tsx` (`submit`) |
| Instagram create consumer | `packages/frontend/src/pages/instagreg/home/_components/react/PostArea/FormSection/index.tsx` |
| Instagram edit consumer | `packages/frontend/src/components/react/DDrvList/DDrvListUI/ItemEditForm.tsx` |
| Exact proxy rewrite | `packages/frontend/src/server/mapBrowserApiPath.ts`, applied in `goApiProxy.ts` |
| Go render + sanitize | `packages/functions/cmd/goapi/api/renderMd.go` |
| Cypress E2E | `packages/e2et/cypress/e2e/mdxEditor.cy.ts`, `.../mdxEditorLayout.cy.ts`, `.../instagreg.cy.ts`, `.../doubleSubmit.cy.ts` |

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
  only after Vim mode is first requested. Verified in the build: the Visual
  chunk contains zero `@replit/codemirror-vim` references.
- **Reusable, controlled editor.** `MdxEditor` is controlled and mounts exactly
  one adapter for its `mode`. The caller owns `value`, `mode`, sizing, toolbar
  width, and the submit-shortcut callback. The RHF `MdxEditorField` keeps mode
  as ephemeral local state and never moves the draft out of React Hook Form.
- **Valid-state sizing.** Sizing is a discriminated union: `fixed{height}`
  (internal scroll) or `content{minRows}` (page scroll, no internal vertical
  scrollbar). A content config asserts in development for a non-safe-integer or
  sub-one `minRows`. The demo uses fixed `100%`; Instagram uses content
  `minRows: 4` with a full-width wrapping toolbar.
- **One guarded submit.** Native submit, the submit button, and the editor's
  Ctrl/Cmd+Enter all route through the single `MutationForm` context `submit`:
  validate once, admit at most one unsettled mutation, reset on success, release
  the duplicate guard on settlement. Plain Enter stays a newline.
- **Pure query factories.** The `MdxEditor/queryOptions/` builders take explicit
  `QueryClient`/view/user/item dependencies and perform no React hook call or
  Zustand read. Instagram invalidation uses the caller-supplied
  `listQueryClient`. Todo modules must not import `MdxEditor/queryOptions`;
  `DDrvList/viewMap.types.ts` isolates the pure `ViewMap`/data maps from
  `ListItemUI` so type-only consumers do not pull in the editor.

## Dependencies

Frontend (exact-pinned via Bun): `@mdxeditor/editor`, `@codemirror/state|view|commands|language|lang-markdown`, `@lezer/highlight`, `@replit/codemirror-vim`. Go: `github.com/microcosm-cc/bluemonday`.

Dev/test (exact-pinned via Bun): `happy-dom` + `@happy-dom/global-registrator`, `@testing-library/react` + `@testing-library/dom`, and `fast-check` back the component and property tests. Bun registers the DOM through `packages/frontend/test/setup.ts`, wired in `packages/frontend/bunfig.toml`. Heavy editor behaviour (real MDXEditor/CodeMirror/Vim) is verified in Cypress, not happy-dom.
