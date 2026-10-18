import type { ObjectsTab } from "./objectsTab.ts";

/** Address-bar name for the drive layout. Values are `detailed` and `tiles`. */
export const STORAGE_VIEW_QUERY = "view";

export const STORAGE_VIEWS = ["detailed", "tiles"] as const;

export type StorageView = (typeof STORAGE_VIEWS)[number];

/** Used when the address bar and saved preference do not choose a view. */
export const DEFAULT_STORAGE_VIEW: StorageView = "tiles";

export function isStorageView(value: unknown): value is StorageView {
    return STORAGE_VIEWS.some(function (view) {
        return view === value;
    });
}

/** A saved preference survives only when it is one of the two layouts. */
export function persistedStorageView(value: unknown): StorageView {
    return isStorageView(value) ? value : DEFAULT_STORAGE_VIEW;
}

export type StorageViewQuery =
    | { readonly kind: "missing" }
    | { readonly kind: "chosen"; readonly view: StorageView }
    | { readonly kind: "unusable" };

/**
 * Accepts exactly one canonical value. Repeated keys are unusable even when
 * every copy is valid, so the caller does not have to guess which one wins.
 */
export function readStorageViewQuery(params: URLSearchParams): StorageViewQuery {
    const values = params.getAll(STORAGE_VIEW_QUERY);
    if (values.length === 0) {
        return { kind: "missing" };
    }
    const value = values[0];
    if (values.length === 1 && isStorageView(value)) {
        return { kind: "chosen", view: value };
    }
    return { kind: "unusable" };
}

export type StorageViewResolution = {
    readonly view: StorageView;
    readonly rewrite: "keep" | "canonicalize";
};

/**
 * Public is always tiles. Mine and Shared with me prefer one valid query
 * value, then the saved preference. Anything else is rewritten in place.
 */
export function resolveStorageView(input: {
    readonly tab: ObjectsTab;
    readonly params: URLSearchParams;
    readonly preference: StorageView;
}): StorageViewResolution {
    switch (input.tab) {
        case "public":
            return {
                view: "tiles",
                rewrite:
                    input.params.getAll(STORAGE_VIEW_QUERY).length > 0
                        ? "canonicalize"
                        : "keep",
            };
        case "mine":
        case "shared_with_me":
            return resolveConfigurableView(input.params, input.preference);
        default:
            return assertUnreachable(input.tab);
    }
}

function resolveConfigurableView(
    params: URLSearchParams,
    preference: StorageView,
): StorageViewResolution {
    const query = readStorageViewQuery(params);
    if (query.kind === "chosen") {
        return { view: query.view, rewrite: "keep" };
    }
    return { view: preference, rewrite: "canonicalize" };
}

export function storageLocationPath(location: {
    readonly pathname: string;
    readonly search: string;
    readonly hash: string;
}): string {
    return `${location.pathname}${location.search}${location.hash}`;
}

/** Returns a same-document path. Public drops `view`; other tabs set one value. */
export function canonicalStorageViewPath(
    location: {
        readonly pathname: string;
        readonly search: string;
        readonly hash: string;
    },
    input: { readonly tab: ObjectsTab; readonly view: StorageView },
): string {
    const url = new URL(
        storageLocationPath(location),
        "http://localhost",
    );
    if (input.tab === "public") {
        url.searchParams.delete(STORAGE_VIEW_QUERY);
    } else {
        url.searchParams.set(STORAGE_VIEW_QUERY, input.view);
    }
    return storageLocationPath(url);
}

function assertUnreachable(value: never): never {
    throw new Error(`Unexpected storage tab: ${String(value)}`);
}
