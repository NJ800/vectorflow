"use client";

import { useSyncExternalStore } from "react";

/**
 * The wall clock as an external store, so relative timestamps tick without
 * reading `Date.now()` during render.
 *
 * The snapshot is quantised to the tick interval: `getSnapshot` must return a
 * stable value between notifications, and a raw `Date.now()` would be a new
 * number on every call. The server snapshot is 0 — there is no meaningful
 * "now" during prerender, and callers render a placeholder for it.
 */
export function useNow(intervalMs = 1000): number {
  return useSyncExternalStore(
    (onStoreChange) => {
      const timer = setInterval(onStoreChange, intervalMs);
      return () => clearInterval(timer);
    },
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
    () => 0
  );
}
