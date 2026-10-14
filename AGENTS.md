<!-- intent-skills:start -->
## Skill Loading

Use the repository’s installed Intent. If it is unavailable, report the missing dependency instead of downloading a replacement.
Before editing files for a substantial task:
- Run `bunx --no-install --package @tanstack/intent intent list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `bunx --no-install --package @tanstack/intent intent load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

## Required project context

Before every repository task, read and follow `packages/agent-skills/skills/understanding-sqldev/SKILL.md`.

## Loading bar / thumbnail rail state

The "loading bar" is the thumbnail progress rail (`ThumbnailProgressRail` + `railView` in `packages/frontend/src/pages/drive/[driveTab]/_components/react/RACCRUDTable/storage/StorageThumbnail.tsx`). Its lifecycle state lives in a per-`sourceKey` Zustand store at `packages/frontend/src/pages/drive/[driveTab]/_components/react/RACCRUDTable/storage/store/thumbnailRailStore.ts` (no longer local React state). See `packages/frontend/AGENTS.md` for details.

## MDX editor

The reusable Markdown editor lives at
`packages/frontend/src/components/react/MdxEditor/`. It is a controlled
Visual/Vim editor (`MdxEditor.tsx`), an RHF field adapter (`MdxEditorField.tsx`),
a valid-state sizing union plus pure helpers (`types.ts`), scoped authoring CSS
(`mdxEditor.css`), lazy per-mode adapters under `editors/`, and the pure
TanStack Query option factories under `queryOptions/` (render client plus
Instagram create/fetch-one/update). The authenticated demo at
`/components/mdxEditor` is its first consumer; `/instagreg/home` post creation
(`PostArea/FormSection`) and the DDrvList edit form (`ItemEditForm`) reuse it.
Before changing that component, its demo, its render path, or the Go
`/renderMd` handler, load the
`packages/agent-skills/skills/mdx-editor-demo/SKILL.md` skill and see
`packages/frontend/AGENTS.md` for details.

Cypress specs for the editor must use the helpers in
`packages/e2et/cypress/support/mdxEditor.ts` (`visualEditable`,
`replaceVisualText`, `runExCommand`), not ad-hoc selectors. MDXEditor 4.3.2
applies `contentEditableClassName` to both the real contenteditable and the
empty-state placeholder, so target
`.mdx-visual-editor__content[contenteditable='true']`. Click the fixed-height
demo editor with `.click("top")`; replace text with one
`type("{selectall}<text>")`; send Vim `:w`/`:wq` through `runExCommand`. Run one
spec with `sqldev --stage dev cypress run --headless --browser chrome --spec cypress/e2e/<file>.cy.ts`
(path relative to `packages/e2et`). `drive.cy.ts`'s first-file upload test can
flake in `sst dev` when `GET /api/jobs/:id` returns 500 from the live-Lambda
bridge (`pollJob` in `src/server/requestJob.ts` does not retry non-2xx); it is
unrelated to the editor and is not a product bug. Details are in the
`mdx-editor-demo` skill.
