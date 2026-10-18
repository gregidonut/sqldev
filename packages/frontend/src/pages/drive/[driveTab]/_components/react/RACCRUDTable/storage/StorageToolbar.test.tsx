import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import type { Selection } from "react-aria-components/Table";
import { StorageToolbar } from "./StorageToolbar.tsx";

const columns: Selection = new Set(["file_name"]);

function toolbar(showViewOptions: boolean) {
    return (
        <StorageToolbar
            canModify={false}
            selectedCount={0}
            isDeleting={false}
            view="tiles"
            visibleColumns={columns}
            bucketName="bucket"
            userId="user"
            onDeleteSelected={() => undefined}
            onViewChange={() => undefined}
            onVisibleColumnsChange={() => undefined}
            showViewOptions={showViewOptions}
        />
    );
}

afterEach(() => {
    cleanup();
});

describe("storage toolbar view options", () => {
    test("public hides the view menu and keeps the column menu", () => {
        render(toolbar(false));
        expect(
            screen.queryByRole("button", { name: "View options" }),
        ).toBeNull();
        expect(screen.getByRole("button", { name: "Columns" })).toBeTruthy();
    });

    test("a configurable tab offers the view menu", () => {
        render(toolbar(true));
        expect(
            screen.getByRole("button", { name: "View options" }),
        ).toBeTruthy();
    });
});
