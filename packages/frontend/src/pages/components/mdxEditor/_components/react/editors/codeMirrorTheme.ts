import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/**
 * Dracula palette, mirrored from the `--color-drac-*` tokens declared in
 * `src/styles/global.css`. CodeMirror's theme system is CSS-in-JS, so the
 * token values are referenced here rather than through CSS variables.
 */
const drac = {
    background: "#282a36",
    currentLine: "#44475a",
    selection: "#44475a",
    foreground: "#f8f8f2",
    comment: "#6272a4",
    cyan: "#8be9fd",
    green: "#50fa7b",
    orange: "#ffb86c",
    pink: "#ff79c6",
    purple: "#bd93f9",
    red: "#ff5555",
    yellow: "#f1fa8c",
} as const;

/** Editor surface, gutter, caret, selection, and focus styling. */
export const draculaEditorTheme: Extension = EditorView.theme(
    {
        "&": {
            color: drac.foreground,
            backgroundColor: drac.background,
            height: "100%",
        },
        ".cm-content": {
            caretColor: drac.cyan,
            fontFamily:
                "'JetBrains Mono Variable', ui-monospace, SFMono-Regular, monospace",
        },
        "&.cm-focused": {
            outline: `2px solid ${drac.cyan}`,
            outlineOffset: "-2px",
        },
        "&.cm-focused .cm-cursor": {
            borderLeftColor: drac.cyan,
        },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
            {
                backgroundColor: drac.selection,
            },
        ".cm-gutters": {
            backgroundColor: drac.background,
            color: drac.comment,
            border: "none",
        },
        ".cm-activeLine": {
            backgroundColor: "color-mix(in srgb, #44475a 35%, transparent)",
        },
        ".cm-activeLineGutter": {
            backgroundColor: "color-mix(in srgb, #44475a 35%, transparent)",
        },
        ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
            outline: `1px solid ${drac.cyan}`,
            backgroundColor: "transparent",
        },
        ".cm-scroller": {
            overflow: "auto",
        },
    },
    { dark: true },
);

/** Markdown syntax token colours mapped to the Dracula palette. */
export const draculaHighlightStyle = HighlightStyle.define([
    { tag: tags.heading, color: drac.purple, fontWeight: "bold" },
    { tag: tags.strong, color: drac.orange, fontWeight: "bold" },
    { tag: tags.emphasis, color: drac.yellow, fontStyle: "italic" },
    { tag: tags.link, color: drac.cyan, textDecoration: "underline" },
    { tag: tags.url, color: drac.cyan },
    { tag: [tags.monospace, tags.content], color: drac.foreground },
    { tag: tags.quote, color: drac.comment, fontStyle: "italic" },
    { tag: tags.list, color: drac.pink },
    { tag: tags.comment, color: drac.comment, fontStyle: "italic" },
    { tag: tags.keyword, color: drac.pink },
    { tag: tags.string, color: drac.yellow },
    { tag: tags.processingInstruction, color: drac.pink },
]);

/** Combined Dracula theme extension for the Vim Markdown editor. */
export const draculaCodeMirror: Extension = [
    draculaEditorTheme,
    syntaxHighlighting(draculaHighlightStyle),
];
