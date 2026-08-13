import type { Module } from "./modules";
import { isModule } from "./modules";

/**
 * The **activity channel** — a server-authored, read-only side channel that
 * signals "module X changed" so the shell can show an activity dot per module
 * *without* syncing the (possibly large) module documents themselves.
 *
 * It is a Yjs document like any module doc (one per room), but:
 *  - it is **not a permission scope**: clients may only *read* it, the server is
 *    the sole writer (see `RoomHub.bumpActivity`), and
 *  - it is **not persisted**: the counters are an ephemeral live signal; the
 *    "seen" state that drives the dot is client-local (localStorage, invariant #4).
 */
export const ACTIVITY_CHANNEL = "activity" as const;

/** Y.Map inside the activity doc: module -> monotonic change counter. */
export const ACTIVITY_COUNTERS = "counters" as const;

/** Snapshot of the activity counters (module -> last change counter). */
export type ActivityCounters = Partial<Record<Module, number>>;

/**
 * Y.Map inside the activity doc: module -> a short human summary of the latest
 * change (e.g. "Neuer Eintrag · Lfd. 15"). Empty when there is nothing more
 * specific to say than "the module changed" — the client then falls back to a
 * generic label. Drives the opt-in notification text, NOT the dots.
 */
export const ACTIVITY_SUMMARIES = "summaries" as const;

/** Snapshot of the per-module change summaries. */
export type ActivitySummaries = Partial<Record<Module, string>>;

/**
 * Y.Map inside the activity doc: raumweite Meta-Signale (kein Modul-Bezug). Aktuell
 * das „Lage abschließen"-Signal (#75): der Server setzt `closed=true` + `closedBy`
 * unmittelbar vor dem serverseitigen Löschen; alle Clients (read-only) sehen es und
 * leiten auf die Abschluss-Landing um. Wie der Rest des Kanals server-authored und
 * nicht persistiert.
 */
export const ACTIVITY_META = "meta" as const;

export interface ActivityMeta {
  closed?: boolean;
  /** Anzeige-String dessen, der die Lage abgeschlossen hat („Name (Rollen)"). */
  closedBy?: string;
}

/**
 * A y-websocket sync target: either a real (permission-scoped) module or the
 * activity channel. Used by the client provider and the server gateway, which
 * accept both but treat `activity` as always read-only.
 */
export type SyncChannel = Module | typeof ACTIVITY_CHANNEL;

export function isSyncChannel(value: unknown): value is SyncChannel {
  return isModule(value) || value === ACTIVITY_CHANNEL;
}
