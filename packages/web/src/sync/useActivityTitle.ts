import { useEffect, useRef } from "react";
import { MODULES, type ActivityCounters } from "@lagekatse/shared";

/**
 * Tab-title activity indicator. The browser tab title carries a count of unseen
 * changes in the modules the user is not currently viewing (`(3) LageKatSe`); it
 * clears as those modules are seen. This is **always on** (like the rail dots) —
 * there is no toggle.
 *
 * Unlike the OS Notification API (the opt-in bell), this works over **plain
 * http** — no secure context, no permission — which matters because the app is
 * served over http in the LAN (same reason as the `uid()` invariant). It only
 * shows a count, not the change content.
 *
 * `counters`/`seen` are the same values that drive the rail dots, so the active
 * module (whose `seen` is kept current) never contributes.
 */
export function useActivityTitle(counters: ActivityCounters, seen: ActivityCounters): void {
  // Capture the plain document title once, stripping any leftover "(n) " prefix.
  const baseTitle = useRef<string | null>(null);
  if (baseTitle.current === null) {
    baseTitle.current = document.title.replace(/^\(\d+\)\s*/, "") || "LageKatSe";
  }

  useEffect(() => {
    const base = baseTitle.current ?? "LageKatSe";
    // Recompute from `base` every run so a StrictMode double-invoke can't stack
    // prefixes.
    let count = 0;
    for (const module of MODULES) {
      count += Math.max(0, (counters[module] ?? 0) - (seen[module] ?? 0));
    }
    document.title = count > 0 ? `(${count}) ${base}` : base;
    return () => {
      document.title = base;
    };
  }, [counters, seen]);
}
