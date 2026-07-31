import { useEffect, useRef } from "react";
import { MODULES, type ActivityCounters } from "@lagekatse/shared";

/**
 * Tab-title activity indicator. When enabled, the browser tab title carries a
 * count of unseen changes in the modules the user is not currently viewing
 * (`(3) LageKatSe`); it clears as those modules are seen.
 *
 * Unlike the OS Notification API, this works over **plain http** — no secure
 * context and no permission are required, which matters because the app is
 * served over http in the LAN (same reason as the `uid()` invariant). It only
 * shows a count, not the change content.
 *
 * `enabled` is a per-user toggle; `counters`/`seen` are the same values that
 * drive the rail dots (so the active module, whose `seen` is kept current, never
 * contributes).
 */
export function useActivityTitle(
  counters: ActivityCounters,
  seen: ActivityCounters,
  enabled: boolean,
): void {
  // Capture the plain document title once, stripping any leftover "(n) " prefix.
  const baseTitle = useRef<string | null>(null);
  if (baseTitle.current === null) {
    baseTitle.current = document.title.replace(/^\(\d+\)\s*/, "") || "LageKatSe";
  }

  useEffect(() => {
    const base = baseTitle.current ?? "LageKatSe";
    if (!enabled) {
      document.title = base;
      return;
    }
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
  }, [counters, seen, enabled]);
}
