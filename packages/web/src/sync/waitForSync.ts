import type { ModuleConnection } from "./provider";

/**
 * Wartet, bis ein frisch verbundenes Yjs-Dokument die erste Sync erhalten hat.
 * Bei warmer Verbindung (`provider.synced`) sofort; sonst bis zum `sync`-Event
 * oder `timeoutMs` (Fallback, damit ein hängender Sync den Aufrufer nicht blockt).
 * Geteilt von Gesamt-Export (exportAll.ts) und Bundle-Import (importAll.ts).
 */
export function waitForSync(conn: ModuleConnection, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    if (conn.provider.synced) {
      resolve();
      return;
    }
    const timer = window.setTimeout(() => resolve(), timeoutMs);
    conn.provider.once("sync", () => {
      window.clearTimeout(timer);
      resolve();
    });
  });
}
