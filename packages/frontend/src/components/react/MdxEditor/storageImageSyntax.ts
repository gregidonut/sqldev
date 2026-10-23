const ESCAPED_STORAGE_IMAGE =
    /\\!\[([^\]\r\n]*)\]\(uploads:\/\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/g;

// The visual editor's link shortcut consumes `[label](uploads://…)`, leaving a
// literal `!` that Markdown export escapes. Put the image syntax back so the
// draft remains `![label](uploads://<uuid>)`.
export function unescapeStorageImageSyntax(markdown: string): string {
    return markdown.replace(
        ESCAPED_STORAGE_IMAGE,
        function (_match, label: string, id: string) {
            return `![${label}](uploads://${id.toLowerCase()})`;
        },
    );
}
