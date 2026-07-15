"use client";

import { useEffect } from "react";

/**
 * EmbedBridge — tiny client-side postMessage bridge for the embeddable view.
 *
 * When the embed page mounts inside an iframe, it announces itself to the host
 * page (the SDK) by posting a `{ source: "navijson", type: "ready" }` message to
 * `window.parent`. The SDK controller listens for these and dispatches them to
 * `on("ready", cb)` handlers.
 *
 * This is the plumbing for the event bridge. Richer events ("route", "arrive")
 * can be emitted from here (or from the map) in the same envelope as the map
 * gains imperative hooks. Renders nothing.
 */
export function EmbedBridge() {
  useEffect(() => {
    if (typeof window === "undefined" || window.parent === window) return;
    try {
      window.parent.postMessage(
        { source: "navijson", type: "ready", payload: {} },
        "*",
      );
    } catch {
      /* cross-origin parent may reject; the embed still works standalone */
    }
  }, []);

  return null;
}
