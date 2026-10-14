/// <reference types="cypress" />

// Shared, verified Cypress interaction helpers for the reusable MDX editor
// (packages/frontend/src/components/react/MdxEditor). Specs must use these
// instead of ad-hoc selectors so the known pitfalls cannot regress separately.

const VISUAL_EDITOR_CY = "[data-cy='mdx-visual-editor']";

// MDXEditor applies `contentEditableClassName` (`mdx-visual-editor__content`)
// to BOTH the real contenteditable and the empty-state placeholder, so the bare
// class matches two elements while the document is empty. Only the real
// editable surface has `contenteditable='true'`. (CodeMirror code blocks in the
// demo also carry contenteditable, but not this class.)
const VISUAL_EDITABLE =
  ".mdx-visual-editor__content[contenteditable='true']";

/**
 * Resolves the single Lexical editable surface of the Visual editor.
 *
 * @param fieldCy `data-cy` of the surrounding field wrapper (for example
 * `p_text_content_field` or `edit_p_text_content_field`). Omit it for the demo
 * page, which renders the editor without a field wrapper.
 */
export function visualEditable(
  fieldCy?: string,
): Cypress.Chainable<JQuery<HTMLElement>> {
  const scope = fieldCy === undefined ? "" : `[data-cy='${fieldCy}'] `;
  return cy
    .get(`${scope}${VISUAL_EDITOR_CY} ${VISUAL_EDITABLE}`)
    .should("have.length", 1);
}

/**
 * Replaces the whole Visual-editor document with `text`.
 *
 * Select-all and the replacement MUST stay in one `type()` call. Never split
 * them (for example `type("{selectall}{del}")` then `type(text)`): Lexical does
 * not receive Cypress's simulated Delete as a deletion, and a second `type()`
 * re-positions the caret at the end, so the text is appended instead of
 * replaced.
 */
export function replaceVisualText(
  fieldCy: string,
  text: string,
): Cypress.Chainable<JQuery<HTMLElement>> {
  return visualEditable(fieldCy).type(`{selectall}${text}`);
}

/**
 * Types a Vim Ex command (for example "w" or "wq") into the focused
 * CodeMirror editor and submits it with a real Enter key.
 *
 * The command text is typed with special sequences off (it contains no keys),
 * but Enter MUST be a separate `type("{enter}")` with special sequences parsed:
 * combining `:w{enter}` with `parseSpecialCharSequences: false` types the
 * literal characters "{enter}" into the command line.
 */
export function runExCommand(command: string): void {
  cy.focused().type("{esc}");
  cy.focused().type(`:${command}`, {
    delay: 0,
    parseSpecialCharSequences: false,
  });
  cy.focused().type("{enter}");
}
