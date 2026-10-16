import { afterEach, describe, expect, test } from "bun:test";
import React, { act } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fc from "fast-check";
import { OBJECTS_TABS, type ObjectsTab } from "@/utils/storage/objectsTab";
import { StorageActionMenu } from "../StorageActionMenu.tsx";
import type { StorageRow } from "../../queryOptions/types.ts";
import {
    visibilityActionFor,
    type StorageVisibilityMenu,
} from "./visibilityAction.ts";

afterEach(() => cleanup());

function row(isPublic: boolean, version: number): StorageRow {
    return {
        storage_object_id: "5b1f7f0e-0c4a-4f7e-9a63-2f4f6a1d9b11",
        user_id: "11111111-1111-4111-8111-111111111111",
        clerk_user_id: "user_1",
        created_at: "2026-10-14T00:00:00Z",
        updated_at: "2026-10-14T00:00:00Z",
        s3_object_key: "u/o/d/report.pdf",
        file_name: "report.pdf",
        public: isPublic,
        config_version: version,
    };
}

type Invocation = { row: StorageRow; trigger: HTMLElement | null };

function menuFor(tab: ObjectsTab, calls: Invocation[]): StorageVisibilityMenu {
    return {
        // The same selector the table uses on every tab.
        actionFor: (r) => visibilityActionFor(tab, r),
        isPending: () => false,
        invoke: (r, trigger) => calls.push({ row: r, trigger }),
    };
}

function renderMenu(tab: ObjectsTab, item: StorageRow, calls: Invocation[]) {
    return render(
        <QueryClientProvider client={new QueryClient()}>
            <StorageActionMenu
                item={item}
                bucketName="bucket"
                userId="user_1"
                canDelete={tab === "mine"}
                onCopy={() => {}}
                onDelete={() => {}}
                onError={() => {}}
                visibility={menuFor(tab, calls)}
            />
        </QueryClientProvider>,
    );
}

function openMenu(): HTMLElement {
    const trigger = document.body.querySelector<HTMLElement>(
        'button[aria-label^="Actions for"]',
    );
    expect(trigger).not.toBeNull();
    act(() => {
        fireEvent.click(trigger!);
    });
    return trigger!;
}

function visibilityItems(): HTMLElement[] {
    return Array.from(
        document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).filter((el) =>
        /^(Make public…|Make private)$/.test(el.textContent?.trim() ?? ""),
    );
}

describe("visibility menu action", () => {
    test("Feature: storage-visibility-confirmation, Property 1: Menu action is a total function of route and visibility", () => {
        fc.assert(
            fc.property(
                fc.constantFrom<ObjectsTab>(...OBJECTS_TABS),
                fc.boolean(),
                fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
                (tab, isPublic, version) => {
                    // The pure selector.
                    const expected =
                        tab !== "mine"
                            ? null
                            : isPublic
                              ? "make-private"
                              : "make-public";
                    expect(visibilityActionFor(tab, { public: isPublic })).toBe(
                        expected,
                    );

                    // The rendered menu.
                    const calls: Invocation[] = [];
                    const item = row(isPublic, version);
                    renderMenu(tab, item, calls);
                    const trigger = openMenu();
                    const items = visibilityItems();

                    if (expected === null) {
                        expect(items).toHaveLength(0);
                    } else {
                        const label = isPublic
                            ? "Make private"
                            : "Make public…";
                        const opposite = isPublic
                            ? "Make public…"
                            : "Make private";
                        expect(items).toHaveLength(1);
                        expect(items[0]!.textContent?.trim()).toBe(label);
                        expect(
                            items[0]!.getAttribute("aria-disabled"),
                        ).not.toBe("true");
                        expect(
                            items.some(
                                (el) => el.textContent?.trim() === opposite,
                            ),
                        ).toBe(false);

                        act(() => {
                            fireEvent.click(items[0]!);
                        });
                        // Invoking passes the row's own id and the revision the list showed.
                        expect(calls).toHaveLength(1);
                        expect(calls[0]!.row.storage_object_id).toBe(
                            item.storage_object_id,
                        );
                        expect(calls[0]!.row.config_version).toBe(version);
                        expect(calls[0]!.trigger).toBe(trigger);
                    }
                    cleanup();
                },
            ),
            { numRuns: 100 },
        );
    });

    test("a menu without a visibility object offers nothing", () => {
        const calls: Invocation[] = [];
        render(
            <QueryClientProvider client={new QueryClient()}>
                <StorageActionMenu
                    item={row(false, 1)}
                    bucketName="bucket"
                    userId="user_1"
                    canDelete
                    onCopy={() => {}}
                    onDelete={() => {}}
                    onError={() => {}}
                />
            </QueryClientProvider>,
        );
        openMenu();
        expect(visibilityItems()).toHaveLength(0);
        expect(calls).toHaveLength(0);
    });

    test("a pending change disables the item so it cannot be repeated", () => {
        const calls: Invocation[] = [];
        render(
            <QueryClientProvider client={new QueryClient()}>
                <StorageActionMenu
                    item={row(true, 4)}
                    bucketName="bucket"
                    userId="user_1"
                    canDelete
                    onCopy={() => {}}
                    onDelete={() => {}}
                    onError={() => {}}
                    visibility={{
                        actionFor: () => "make-private",
                        isPending: () => true,
                        invoke: (r, trigger) => calls.push({ row: r, trigger }),
                    }}
                />
            </QueryClientProvider>,
        );
        openMenu();
        const [item] = visibilityItems();
        expect(item?.getAttribute("aria-disabled")).toBe("true");
        act(() => {
            fireEvent.click(item!);
        });
        expect(calls).toHaveLength(0);
    });
});
