const STORAGE_OBJECT_ID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const PLACEHOLDER =
    /<span data-sqldev-storage-object="([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})">([\s\S]*?)<\/span>/g;

export type HtmlPart =
    | { readonly kind: "html"; readonly html: string }
    | {
          readonly kind: "reference";
          readonly storageObjectId: string;
          readonly label: string;
      };

export function isStorageObjectId(value: string): boolean {
    return STORAGE_OBJECT_ID.test(value);
}

// Splits sanitized HTML into ordinary markup and storage placeholders. The
// label is text, never markup, and a non-canonical id is left in the HTML.
export function splitStorageHtml(html: string): readonly HtmlPart[] {
    const parts: HtmlPart[] = [];
    const pattern = new RegExp(PLACEHOLDER.source, "g");
    let cursor = 0;
    for (const match of html.matchAll(pattern)) {
        const index = match.index ?? 0;
        if (index > cursor) {
            parts.push({ kind: "html", html: html.slice(cursor, index) });
        }
        const storageObjectId = match[1] ?? "";
        if (!isStorageObjectId(storageObjectId)) {
            continue;
        }
        parts.push({
            kind: "reference",
            storageObjectId,
            label: textFromHtml(match[2] ?? ""),
        });
        cursor = index + match[0].length;
    }
    if (cursor < html.length) {
        parts.push({ kind: "html", html: html.slice(cursor) });
    }
    if (parts.length === 0) {
        return [{ kind: "html", html }];
    }
    return parts;
}

function textFromHtml(fragment: string): string {
    const parsed =
        typeof DOMParser === "undefined"
            ? fragment.replace(/<[^>]*>/g, "")
            : (new DOMParser().parseFromString(fragment, "text/html").body
                  .textContent ?? "");
    return decodeCaption(parsed);
}

function decodeCaption(value: string): string {
    return value
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&#39;", "'")
        .replaceAll("&amp;", "&");
}
