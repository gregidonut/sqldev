import React from "react";
import { Tabs, TabList, Tab, TabPanel } from "react-aria-components";
import type { Key } from "react-aria-components";
import type { LastSuccess, OutputTab } from "./mdxEditorStore.ts";
import type { SanitizedHtml } from "./renderMarkdownClient.ts";

const EMPTY_PLACEHOLDER = "Render Markdown to create output";

/**
 * The single preview sink. It is the only place that injects server HTML into
 * the DOM, and its input type requires the {@link SanitizedHtml} brand so an
 * arbitrary string cannot reach `dangerouslySetInnerHTML`.
 */
function SanitizedPreview({
    html,
}: {
    html: SanitizedHtml;
}): React.JSX.Element {
    return (
        <div
            data-cy="mdx-preview"
            className="mdx-preview prose prose-invert max-w-none"
            // The value is branded SanitizedHtml produced only by a validated
            // server response; the server bluemonday policy is the trust boundary.
            dangerouslySetInnerHTML={{ __html: html }}
        />
    );
}

function SourceBlock({
    text,
    dataCy,
}: {
    text: string;
    dataCy: string;
}): React.JSX.Element {
    return (
        <pre
            data-cy={dataCy}
            className="h-full w-full overflow-auto whitespace-pre-wrap break-words bg-drac-background p-3 text-sm text-drac-foreground"
        >
            <code>{text}</code>
        </pre>
    );
}

export type OutputTabsProps = Readonly<{
    lastSuccess: LastSuccess;
    selectedOutputTab: OutputTab;
    onSelect: (tab: OutputTab) => void;
}>;

const TAB_ORDER: readonly OutputTab[] = [
    "markdown",
    "html-source",
    "preview",
] as const;

/**
 * Accessible React Aria tab set presenting the three synchronized views of the
 * last successful render. Source tabs are text-only; only the preview tab
 * injects sanitized HTML.
 */
export function OutputTabs({
    lastSuccess,
    selectedOutputTab,
    onSelect,
}: OutputTabsProps): React.JSX.Element {
    const ready = lastSuccess.kind === "ready" ? lastSuccess.snapshot : null;

    const handleSelection = (key: Key) => {
        if (TAB_ORDER.includes(key as OutputTab)) {
            onSelect(key as OutputTab);
        }
    };

    return (
        <Tabs
            className="flex h-full w-full flex-col"
            selectedKey={selectedOutputTab}
            onSelectionChange={handleSelection}
        >
            <TabList
                aria-label="Rendered output views"
                className="flex gap-1 border-b border-drac-selection"
            >
                <Tab
                    id="markdown"
                    data-cy="mdx-tab-markdown"
                    className="cursor-default px-3 py-2 text-drac-foreground outline-none selected:border-b-2 selected:border-drac-purple selected:text-drac-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-drac-cyan disabled:text-drac-comment"
                >
                    Markdown
                </Tab>
                <Tab
                    id="html-source"
                    data-cy="mdx-tab-html"
                    className="cursor-default px-3 py-2 text-drac-foreground outline-none selected:border-b-2 selected:border-drac-purple selected:text-drac-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-drac-cyan disabled:text-drac-comment"
                >
                    HTML Source
                </Tab>
                <Tab
                    id="preview"
                    data-cy="mdx-tab-preview"
                    className="cursor-default px-3 py-2 text-drac-foreground outline-none selected:border-b-2 selected:border-drac-purple selected:text-drac-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-drac-cyan disabled:text-drac-comment"
                >
                    Preview
                </Tab>
            </TabList>

            <TabPanel id="markdown" className="min-h-0 flex-1 outline-none">
                {ready ? (
                    <SourceBlock text={ready.markdown} dataCy="mdx-output-markdown" />
                ) : (
                    <p className="p-3 text-drac-comment">{EMPTY_PLACEHOLDER}</p>
                )}
            </TabPanel>
            <TabPanel id="html-source" className="min-h-0 flex-1 outline-none">
                {ready ? (
                    <SourceBlock text={ready.html} dataCy="mdx-output-html" />
                ) : (
                    <p className="p-3 text-drac-comment">{EMPTY_PLACEHOLDER}</p>
                )}
            </TabPanel>
            <TabPanel
                id="preview"
                className="min-h-0 flex-1 overflow-auto p-3 outline-none"
            >
                {ready ? (
                    <SanitizedPreview html={ready.html} />
                ) : (
                    <p className="text-drac-comment">{EMPTY_PLACEHOLDER}</p>
                )}
            </TabPanel>
        </Tabs>
    );
}

export default OutputTabs;
