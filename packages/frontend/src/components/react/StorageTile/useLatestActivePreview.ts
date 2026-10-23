import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";

// Private ownership lifecycle for the single latest-active preview tile.
// `pending` is a candidate that has been chosen but is still inside its
// one-animation-frame coalescing window; `active` is a candidate that survived
// that window and now owns the enabled animation query.
type PreviewOwner =
    | { readonly state: "idle" }
    | {
          readonly state: "pending";
          readonly instanceKey: string;
          readonly epoch: number;
      }
    | {
          readonly state: "active";
          readonly instanceKey: string;
          readonly epoch: number;
      };

export type AnimationRegistration = (
    instanceKey: string,
    queryKey: QueryKey | null,
) => void;

// One latest-active preview for a grid or a feed.
//
// Each tile reports whether a pointer or keyboard focus is within it. Rapid
// candidates are coalesced over one animation frame. Only the active tile may
// own an enabled animation query. Superseding a tile cancels that tile's
// animation query. Cancellation defaults to `revert`, so a prior successful
// animation stays cached.
export function useLatestActivePreview(): {
    activeInstanceKey: string | null;
    onActiveChange: (instanceKey: string, active: boolean) => void;
    registerAnimation: AnimationRegistration;
} {
    const orderRef = useRef(0);
    const candidatesRef = useRef<Map<string, number>>(new Map());
    const animationKeys = useRef<Map<string, QueryKey>>(new Map());
    const ownerRef = useRef<PreviewOwner>({ state: "idle" });
    const epochRef = useRef(0);
    const rafRef = useRef<number | null>(null);
    const [activeInstanceKey, setActiveInstanceKey] = useState<string | null>(
        null,
    );
    const queryClient = useQueryClient();

    const registerAnimation = useCallback<AnimationRegistration>(function (
        instanceKey,
        queryKey,
    ) {
        if (queryKey === null) {
            animationKeys.current.delete(instanceKey);
            return;
        }
        animationKeys.current.set(instanceKey, queryKey);
    }, []);

    const cancelAnimation = useCallback(
        function (instanceKey: string) {
            const queryKey = animationKeys.current.get(instanceKey);
            if (queryKey === undefined) {
                return;
            }
            void queryClient.cancelQueries({ queryKey, exact: true });
        },
        [queryClient],
    );

    const cancelScheduledFrame = useCallback(function () {
        if (
            rafRef.current !== null &&
            typeof cancelAnimationFrame !== "undefined"
        ) {
            cancelAnimationFrame(rafRef.current);
        }
        rafRef.current = null;
    }, []);

    const publishActive = useCallback(
        function (next: string | null, epoch: number) {
            const previous = ownerRef.current;
            const previousActive =
                previous.state === "active" ? previous.instanceKey : null;
            if (previousActive !== null && previousActive !== next) {
                cancelAnimation(previousActive);
            }
            if (next === null) {
                ownerRef.current = { state: "idle" };
                setActiveInstanceKey(null);
                return;
            }
            ownerRef.current = { state: "active", instanceKey: next, epoch };
            setActiveInstanceKey(next);
        },
        [cancelAnimation],
    );

    const reconcile = useCallback(
        function () {
            let bestKey: string | null = null;
            let bestOrder = -1;
            candidatesRef.current.forEach(function (order, key) {
                if (order > bestOrder) {
                    bestOrder = order;
                    bestKey = key;
                }
            });

            const current = ownerRef.current;
            const currentTarget =
                current.state === "idle" ? null : current.instanceKey;
            if (currentTarget === bestKey) {
                return;
            }

            cancelScheduledFrame();

            if (bestKey === null) {
                epochRef.current += 1;
                publishActive(null, epochRef.current);
                return;
            }

            epochRef.current += 1;
            const epoch = epochRef.current;
            ownerRef.current = {
                state: "pending",
                instanceKey: bestKey,
                epoch,
            };
            const candidate = bestKey;
            const promote = function () {
                rafRef.current = null;
                const owner = ownerRef.current;
                if (owner.state !== "pending" || owner.epoch !== epoch) {
                    return;
                }
                publishActive(candidate, epoch);
            };
            if (typeof requestAnimationFrame === "undefined") {
                promote();
                return;
            }
            rafRef.current = requestAnimationFrame(promote);
        },
        [cancelScheduledFrame, publishActive],
    );

    const onActiveChange = useCallback(
        function (instanceKey: string, active: boolean) {
            const candidates = candidatesRef.current;
            if (active) {
                orderRef.current += 1;
                candidates.set(instanceKey, orderRef.current);
            } else {
                candidates.delete(instanceKey);
            }
            reconcile();
        },
        [reconcile],
    );

    useEffect(
        function () {
            return function () {
                cancelScheduledFrame();
                const owner = ownerRef.current;
                if (owner.state === "active") {
                    cancelAnimation(owner.instanceKey);
                }
                ownerRef.current = { state: "idle" };
                candidatesRef.current.clear();
            };
        },
        [cancelScheduledFrame, cancelAnimation],
    );

    return { activeInstanceKey, onActiveChange, registerAnimation };
}
