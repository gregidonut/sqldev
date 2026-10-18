import { useCallback, useEffect, useState } from "react";
import type { ObjectsTab } from "@/utils/storage/objectsTab.ts";
import {
    canonicalStorageViewPath,
    readStorageViewQuery,
    resolveStorageView,
    storageLocationPath,
    type StorageView,
} from "@/utils/storage/storageView.ts";
import { useStorageTableStore } from "./store/storageTableStore.ts";

export function useStorageView(tab: ObjectsTab): {
    readonly view: StorageView | null;
    readonly showViewOptions: boolean;
    readonly selectView: (view: StorageView) => void;
} {
    const preference = useStorageTableStore(function (state) {
        return state.view;
    });
    const hydrated = useStoragePreferenceHydrated();
    const [search, setSearch] = useState(function () {
        return window.location.search;
    });

    useEffect(function () {
        function syncFromHistory() {
            setSearch(function (current) {
                return current === window.location.search
                    ? current
                    : window.location.search;
            });
        }
        window.addEventListener("popstate", syncFromHistory);
        return function () {
            window.removeEventListener("popstate", syncFromHistory);
        };
    }, []);

    useEffect(
        function () {
            if (tab !== "public" && !hydrated) {
                return;
            }
            const resolution = resolveStorageView({
                tab,
                params: new URLSearchParams(window.location.search),
                preference: useStorageTableStore.getState().view,
            });
            if (resolution.rewrite !== "canonicalize") {
                return;
            }
            const nextPath = canonicalStorageViewPath(window.location, {
                tab,
                view: resolution.view,
            });
            if (nextPath === storageLocationPath(window.location)) {
                return;
            }
            window.history.replaceState(window.history.state, "", nextPath);
            setSearch(function (current) {
                return current === window.location.search
                    ? current
                    : window.location.search;
            });
        },
        [tab, hydrated, search],
    );

    const query = readStorageViewQuery(new URLSearchParams(search));
    const view = displayedStorageView(tab, query, hydrated, preference);

    const selectView = useCallback(
        function (next: StorageView) {
            if (tab === "public") {
                return;
            }
            useStorageTableStore.getState().setView(next);
            const nextPath = canonicalStorageViewPath(window.location, {
                tab,
                view: next,
            });
            if (nextPath === storageLocationPath(window.location)) {
                return;
            }
            window.history.pushState(window.history.state, "", nextPath);
            setSearch(window.location.search);
        },
        [tab],
    );

    return {
        view,
        showViewOptions: tab !== "public" && view !== null,
        selectView,
    };
}

function useStoragePreferenceHydrated(): boolean {
    const [hydrated, setHydrated] = useState(function () {
        return useStorageTableStore.persist.hasHydrated();
    });

    useEffect(function () {
        setHydrated(useStorageTableStore.persist.hasHydrated());
        return useStorageTableStore.persist.onFinishHydration(function () {
            setHydrated(true);
        });
    }, []);

    return hydrated;
}

function displayedStorageView(
    tab: ObjectsTab,
    query: ReturnType<typeof readStorageViewQuery>,
    hydrated: boolean,
    preference: StorageView,
): StorageView | null {
    if (tab === "public") {
        return "tiles";
    }
    if (query.kind === "chosen") {
        return query.view;
    }
    return hydrated ? preference : null;
}
