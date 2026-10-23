import React from "react";
import { cy } from "@/utils/cy";
import { splitStorageHtml } from "./splitStorageHtml.ts";
import { StorageReferenceTile } from "./StorageReferenceTile.tsx";

export function RenderedPostBody({
    html,
    instanceScope,
}: {
    html: string;
    instanceScope: string;
}): React.ReactNode {
    const parts = splitStorageHtml(html);
    return (
        <div
            className="prose prose-invert text-drac-foreground prose-stone"
            {...cy("ig_post_body")}
        >
            {parts.map(function (part, index) {
                if (part.kind === "html") {
                    if (part.html === "") {
                        return null;
                    }
                    return (
                        <div
                            key={`html-${index}`}
                            dangerouslySetInnerHTML={{ __html: part.html }}
                        />
                    );
                }
                return (
                    <StorageReferenceTile
                        key={`${instanceScope}:${index}:${part.storageObjectId}`}
                        storageObjectId={part.storageObjectId}
                        label={part.label}
                        instanceKey={`${instanceScope}:${index}:${part.storageObjectId}`}
                    />
                );
            })}
        </div>
    );
}
