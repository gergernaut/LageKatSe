import { IndexeddbPersistence } from "y-indexeddb";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import type { SyncChannel } from "@lagekatse/shared";
import { wsBase } from "../api";

export interface ModuleConnection {
  doc: Y.Doc;
  provider: WebsocketProvider;
  destroy: () => void;
}

/**
 * Module names that get a persistent IndexedDB cache by default (the four
 * shared, long-lived documents). Short-lived / server-authored channels
 * (activity) are not cached — they are either transient or not client-owned.
 *
 * Export/Import connections use the same module names but pass `cache: false`
 * to avoid unnecessary IDB writes on transient connections.
 */
const CACHED_MODULES = new Set<SyncChannel>(["chat", "lagekarte", "etb", "arbeitsblatt"]);

export interface ConnectOptions {
  /** Enable IndexedDB cache (default: true for long-lived modules). */
  cache?: boolean;
}

/**
 * Connect to one module document of a room. y-websocket dials
 * `${url}/${roomName}`, so we put the room id in the path and the module as
 * the "room name" — landing on the server route /sync/:roomId/:module — and
 * pass the session token as a query param.
 *
 * For the four long-lived modules, an `IndexeddbPersistence` is attached
 * *before* the WebSocket provider connects. This gives an instant local
 * cache on load (L6 — Sofort-Anzeige, Weiterarbeit offline) and survives
 * reloads / connection drops. The server remains the sole authority
 * (Invariante #2, `disableBc`); on reconnect, Yjs merges automatically.
 *
 * Pass `cache: false` for transient connections (export/import) to avoid
 * unnecessary IDB writes and potential cache/merge races.
 */
export function connectModule(
  roomId: string,
  module: SyncChannel,
  token: string,
  opts?: ConnectOptions,
): ModuleConnection {
  const useCache = opts?.cache ?? CACHED_MODULES.has(module);
  const doc = new Y.Doc();
  const dbKey = `${roomId}:${module}`;

  // IndexedDB cache for long-lived modules (best-effort — if the browser
  // blocks IDB, we simply continue without a cache). Covers both the
  // synchronous constructor error and the async DB-open failure.
  let persistence: IndexeddbPersistence | null = null;
  if (useCache) {
    try {
      persistence = new IndexeddbPersistence(dbKey, doc);
      // Async errors (blocked/volle IDB) landen hier statt als unhandled rejection.
      persistence.whenSynced.catch(() => {
        persistence = null; // Cache unbrauchbar — still ohne Cache weiterlaufen.
      });
    } catch {
      // Private mode / disabled IDB — continue without cache.
    }
  }

  const provider = new WebsocketProvider(`${wsBase()}/sync/${roomId}`, module, doc, {
    params: { token },
    // The server is the sole authority. y-websocket would otherwise cross-sync
    // same-origin clients via BroadcastChannel, bypassing server-side rights
    // enforcement (a read-only client could then reach same-browser peers).
    disableBc: true,
  });

  return {
    doc,
    provider,
    destroy: () => {
      provider.destroy();
      persistence?.destroy();
      doc.destroy();
    },
  };
}
