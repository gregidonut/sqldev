/**
 * Representative, Goldmark-compatible starter document. It uses only the
 * supported CommonMark subset: headings, emphasis, lists, a block quote, a
 * safe link, inline code, and a fenced code block.
 */
export const SAMPLE_MARKDOWN = `# MDXEditor Goldmark demo

Edit this Markdown with the **visual editor**, or toggle *Vim source mode* to
edit with CodeMirror and \`vim\` keybindings.

## Features

- CommonMark that round-trips to the Go gateway's Goldmark renderer
- A safe [link](https://commonmark.org)
- Inline \`code\` and fenced blocks

> Click **Render Markdown** to send this to the server and inspect the output.

\`\`\`
function hello() {
  return "world";
}
\`\`\`
`;
