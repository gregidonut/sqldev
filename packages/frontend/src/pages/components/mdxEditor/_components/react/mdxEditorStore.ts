import { create } from "zustand";
import type { SanitizedHtml } from "@/components/react/MdxEditor";

/** Which editing surface is mounted. */
export type EditorMode = "visual" | "vim";

/** Which output representation is selected. */
export type OutputTab = "markdown" | "html-source" | "preview";

/**
 * One immutable, atomic result pairing the exact submitted Markdown with the
 * sanitized HTML returned for that same request.
 */
export type RenderSnapshot = Readonly<{
    markdown: string;
    html: SanitizedHtml;
}>;

/**
 * The last successful render. Modelled as a discriminated union so a partial
 * (markdown-only or html-only) result is unrepresentable.
 */
export type LastSuccess =
    | Readonly<{ kind: "empty" }>
    | Readonly<{ kind: "ready"; snapshot: RenderSnapshot }>;

export type MdxEditorUiState = Readonly<{
    editorMode: EditorMode;
    selectedOutputTab: OutputTab;
    lastSuccess: LastSuccess;
}>;

export type MdxEditorUiActions = {
    setEditorMode: (mode: EditorMode) => void;
    setSelectedOutputTab: (tab: OutputTab) => void;
    commitSuccess: (snapshot: RenderSnapshot) => void;
    resetDemo: () => void;
};

export type MdxEditorUiStore = MdxEditorUiState & MdxEditorUiActions;

/** The reload / initial defaults. The store is intentionally not persisted. */
export const DEFAULT_UI_STATE: MdxEditorUiState = {
    editorMode: "visual",
    selectedOutputTab: "markdown",
    lastSuccess: { kind: "empty" },
};

/**
 * Non-persisted Zustand store for ephemeral UI and the atomic last-success
 * snapshot. It holds no draft, mutation status, query data, editor instance,
 * ref, timer, or focus state — those belong to React Hook Form, TanStack
 * Query, and the editor adapters respectively.
 */
export const useMdxEditorUiStore = create<MdxEditorUiStore>()((set) => ({
    ...DEFAULT_UI_STATE,
    setEditorMode: (editorMode) => set({ editorMode }),
    setSelectedOutputTab: (selectedOutputTab) => set({ selectedOutputTab }),
    commitSuccess: (snapshot) =>
        set({ lastSuccess: { kind: "ready", snapshot } }),
    resetDemo: () => set({ ...DEFAULT_UI_STATE }),
}));
