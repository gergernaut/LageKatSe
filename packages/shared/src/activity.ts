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
 * A y-websocket sync target: either a real (permission-scoped) module or the
 * activity channel. Used by the client provider and the server gateway, which
 * accept both but treat `activity` as always read-only.
 */
export type SyncChannel = Module | typeof ACTIVITY_CHANNEL;

export function isSyncChannel(value: unknown): value is SyncChannel {
  return isModule(value) || value === ACTIVITY_CHANNEL;
}
