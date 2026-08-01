import { randomUUID } from "node:crypto";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import { WebSocket } from "ws";
import {
  ACTIVITY_CHANNEL,
  ACTIVITY_COUNTERS,
  ACTIVITY_SUMMARIES,
  ETB_ENTRIES,
  type LogEntry,
  type Module,
  type NewEtbEntryInput,
  type SyncChannel,
} from "@lagekatse/shared";
import type { Store } from "../store";

export const MSG_SYNC = 0;
export const MSG_AWARENESS = 1;

/** Origin marker for updates replayed from persistence (never re-persisted). */
const LOAD_ORIGIN = Symbol("lagekatse:load");
const SERVER_ORIGIN = Symbol("lagekatse:server");

const ROOM_TOUCH_THROTTLE_MS = 60_000;
const ACTIVITY_BUMP_THROTTLE_MS = 750;
const SNAPSHOT_DEBOUNCE_MS = 4000;
const SNAPSHOT_EVERY_N_UPDATES = 200;

const docKey = (roomId: string, module: string) => `${roomId}::${module}`;

/** A single client connection, bound to exactly one (room, module) document. */
export interface Conn {
  ws: WebSocket;
  sid: string;
  roomId: string;
  module: SyncChannel;
  /** May this connection write to its module? (authoritative gate) */
  canWrite: boolean;
  /** awareness client-ids this connection currently controls (for cleanup). */
  controlledIds: Set<number>;
}

interface ManagedDoc {
  key: string;
  roomId: string;
  module: SyncChannel;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  conns: Set<Conn>;
  updatesSinceSnapshot: number;
  snapshotTimer: ReturnType<typeof setTimeout> | null;
  /** Serialises append + snapshot compaction so neither interleaves with the other. */
  persistQueue: Promise<void>;
}

function send(conn: Conn, data: Uint8Array): void {
  if (conn.ws.readyState !== WebSocket.OPEN) return;
  try {
    conn.ws.send(data);
  } catch {
    /* connection is going away; close handler will clean up */
  }
}

/**
 * Owns the in-memory Yjs documents (one per room×module), their persistence
 * and the fan-out of updates/awareness to connected clients. The gateway
 * decides *who* may write; the hub only relays and stores.
 */
export class RoomHub {
  private docs = new Map<string, ManagedDoc>();
  private loading = new Map<string, Promise<ManagedDoc>>();
  private roomLastTouchedAt = new Map<string, number>();
  private activityLastBumpedAt = new Map<string, number>();

  constructor(private readonly store: Store) {}

  async getDoc(roomId: string, module: SyncChannel): Promise<ManagedDoc> {
    const k = docKey(roomId, module);
    const existing = this.docs.get(k);
    if (existing) return existing;
    const inflight = this.loading.get(k);
    if (inflight) return inflight;

    const promise = this.load(roomId, module, k);
    this.loading.set(k, promise);
    try {
      const md = await promise;
      this.docs.set(k, md);
      return md;
    } finally {
      this.loading.delete(k);
    }
  }

  async appendEtbEntry(
    roomId: string,
    bearbeiter: string,
    input: NewEtbEntryInput,
  ): Promise<LogEntry> {
    const md = await this.getDoc(roomId, "etb");
    const entries = md.doc.getArray<Y.Map<unknown>>(ETB_ENTRIES);
    let entry!: LogEntry;

    md.doc.transact(() => {
      let maxLfdNr = 0;
      for (const existing of entries) {
        const lfdNr = existing.get("lfdNr");
        if (typeof lfdNr === "number" && Number.isFinite(lfdNr)) {
          maxLfdNr = Math.max(maxLfdNr, lfdNr);
        }
      }

      entry = {
        id: randomUUID(),
        lfdNr: maxLfdNr + 1,
        zeit: new Date().toISOString(),
        richtung: input.richtung ?? "",
        von: input.von ?? "",
        an: input.an ?? "",
        weg: input.weg ?? "",
        inhalt: input.inhalt ?? "",
        veranlassung: input.veranlassung ?? "",
        erledigt: false,
        bearbeiter,
      };

      const yEntry = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(entry)) yEntry.set(key, value);
      entries.push([yEntry]);
    }, SERVER_ORIGIN);

    void this.bumpActivity(roomId, "etb", `Neuer Eintrag · Lfd. ${entry.lfdNr}`);

    return entry;
  }

  async bumpActivity(roomId: string, module: Module, summary = ""): Promise<void> {
    const key = docKey(roomId, module);
    const now = Date.now();
    const lastBumpedAt = this.activityLastBumpedAt.get(key);
    if (lastBumpedAt !== undefined && now - lastBumpedAt < ACTIVITY_BUMP_THROTTLE_MS) return;
    this.activityLastBumpedAt.set(key, now);

    try {
      const md = await this.getDoc(roomId, ACTIVITY_CHANNEL);
      const counters = md.doc.getMap(ACTIVITY_COUNTERS);
      const summaries = md.doc.getMap(ACTIVITY_SUMMARIES);
      md.doc.transact(() => {
        counters.set(module, ((counters.get(module) as number | undefined) ?? 0) + 1);
        summaries.set(module, summary);
      }, SERVER_ORIGIN);
    } catch (err) {
      console.error(`[hub] activity bump failed for ${key}`, err);
    }
  }

  private async load(roomId: string, module: SyncChannel, k: string): Promise<ManagedDoc> {
    const doc = new Y.Doc();
    if (module !== ACTIVITY_CHANNEL) {
      const state = await this.store.loadDoc(roomId, module);
      // Replay persisted state BEFORE wiring the update handler, so the replay
      // itself is never re-persisted or broadcast.
      if (state.snapshot) Y.applyUpdate(doc, state.snapshot, LOAD_ORIGIN);
      for (const update of state.updates) Y.applyUpdate(doc, update, LOAD_ORIGIN);
    }

    const awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalState(null); // the server itself is not "present"

    const md: ManagedDoc = {
      key: k,
      roomId,
      module,
      doc,
      awareness,
      conns: new Set(),
      updatesSinceSnapshot: 0,
      snapshotTimer: null,
      persistQueue: Promise.resolve(),
    };

    doc.on("update", (update: Uint8Array, origin: unknown) => {
      // Fan out to everyone except the author.
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);
      for (const conn of md.conns) {
        if (conn !== origin) send(conn, message);
      }
      // Durably log everything a client produced (not our own replays).
      if (origin !== LOAD_ORIGIN && md.module !== ACTIVITY_CHANNEL) {
        this.persistUpdate(md, update);
      }
      if (origin !== LOAD_ORIGIN && origin !== SERVER_ORIGIN && md.module !== ACTIVITY_CHANNEL) {
        void this.bumpActivity(md.roomId, md.module);
      }
    });

    awareness.on(
      "update",
      (changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        if (origin && typeof origin === "object" && "controlledIds" in origin) {
          const conn = origin as Conn;
          for (const id of changes.added) conn.controlledIds.add(id);
          for (const id of changes.removed) conn.controlledIds.delete(id);
        }
        const changed = [...changes.added, ...changes.updated, ...changes.removed];
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_AWARENESS);
        encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
        const message = encoding.toUint8Array(encoder);
        for (const conn of md.conns) {
          if (conn !== origin) send(conn, message);
        }
      },
    );

    return md;
  }

  addConn(md: ManagedDoc, conn: Conn): void {
    md.conns.add(conn);
    this.markRoomActive(md.roomId);

    // Step 1 of the sync handshake: offer our state vector.
    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, MSG_SYNC);
    syncProtocol.writeSyncStep1(syncEncoder, md.doc);
    send(conn, encoding.toUint8Array(syncEncoder));

    // Current presence snapshot (so the newcomer immediately sees who is online).
    const states = md.awareness.getStates();
    if (states.size > 0) {
      const awEncoder = encoding.createEncoder();
      encoding.writeVarUint(awEncoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(
        awEncoder,
        awarenessProtocol.encodeAwarenessUpdate(md.awareness, [...states.keys()]),
      );
      send(conn, encoding.toUint8Array(awEncoder));
    }
  }

  handleMessage(md: ManagedDoc, conn: Conn, data: Uint8Array): void {
    const decoder = decoding.createDecoder(data);
    const messageType = decoding.readVarUint(decoder);

    if (messageType === MSG_SYNC) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      const syncType = decoding.readVarUint(decoder);

      // Authoritative rights enforcement: a read-only connection may READ
      // (syncStep1 and receiving updates) but any state-mutating message
      // (syncStep2 / update) is dropped before it can touch the shared doc.
      const isWrite =
        syncType === syncProtocol.messageYjsSyncStep2 || syncType === syncProtocol.messageYjsUpdate;
      if (isWrite && !conn.canWrite) {
        // Drop silently: the write never reaches the shared doc, other clients
        // or persistence. We do NOT try to "undo" the client's local copy —
        // CRDT state is additive and the real UI hides editing for RO modules.
        if (process.env.LK_DEBUG) console.error(`[hub] DROP write from RO sid=${conn.sid.slice(0, 6)}`);
        return;
      }

      switch (syncType) {
        case syncProtocol.messageYjsSyncStep1:
          syncProtocol.readSyncStep1(decoder, encoder, md.doc);
          break;
        case syncProtocol.messageYjsSyncStep2:
          syncProtocol.readSyncStep2(decoder, md.doc, conn);
          break;
        case syncProtocol.messageYjsUpdate:
          syncProtocol.readUpdate(decoder, md.doc, conn);
          break;
        default:
          break;
      }
      if (encoding.length(encoder) > 1) send(conn, encoding.toUint8Array(encoder));
    } else if (messageType === MSG_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(md.awareness, decoding.readVarUint8Array(decoder), conn);
    }
  }

  removeConn(md: ManagedDoc, conn: Conn): void {
    if (!md.conns.delete(conn)) return;
    awarenessProtocol.removeAwarenessStates(md.awareness, [...conn.controlledIds], null);
    if (md.conns.size === 0) this.snapshotNow(md);
  }

  /** Flush a final snapshot for every live doc and drain its persist queue.
   *  Call after clients are disconnected so no new updates race the drain. */
  async closeAll(): Promise<void> {
    for (const md of this.docs.values()) {
      this.snapshotNow(md);
      await md.persistQueue;
    }
  }

  // Append and snapshot both run through md.persistQueue, so they never
  // interleave. The snapshot is encoded *inside* its queued task — after every
  // previously-enqueued append has landed — and only then is the log truncated.
  // An update arriving mid-snapshot enqueues *after* it and therefore survives
  // (worst case it is replayed once on top of the snapshot; applyUpdate is
  // idempotent). This closes the "compaction deletes an un-captured update" race.
  private markRoomActive(roomId: string): void {
    const now = Date.now();
    const lastTouchedAt = this.roomLastTouchedAt.get(roomId);
    if (lastTouchedAt !== undefined && now - lastTouchedAt < ROOM_TOUCH_THROTTLE_MS) return;
    this.roomLastTouchedAt.set(roomId, now);
    this.store
      .touchRoom(roomId, new Date().toISOString())
      .catch((err) => console.error(`[hub] touchRoom failed for ${roomId}`, err));
  }

  private persistUpdate(md: ManagedDoc, update: Uint8Array): void {
    if (md.module === ACTIVITY_CHANNEL) return;
    this.markRoomActive(md.roomId);
    md.updatesSinceSnapshot += 1;
    md.persistQueue = md.persistQueue
      .then(() => this.store.appendUpdate(md.roomId, md.module, update))
      .catch((err) => console.error(`[hub] appendUpdate failed for ${md.key}`, err));

    if (md.updatesSinceSnapshot >= SNAPSHOT_EVERY_N_UPDATES) {
      this.snapshotNow(md);
    } else if (!md.snapshotTimer) {
      md.snapshotTimer = setTimeout(() => this.snapshotNow(md), SNAPSHOT_DEBOUNCE_MS);
    }
  }

  private snapshotNow(md: ManagedDoc): void {
    if (md.module === ACTIVITY_CHANNEL) return;
    if (md.snapshotTimer) {
      clearTimeout(md.snapshotTimer);
      md.snapshotTimer = null;
    }
    if (md.updatesSinceSnapshot === 0) return;
    md.updatesSinceSnapshot = 0;
    md.persistQueue = md.persistQueue
      .then(async () => {
        const snapshot = Y.encodeStateAsUpdate(md.doc);
        await this.store.saveSnapshot(md.roomId, md.module, snapshot);
      })
      .catch((err) => console.error(`[hub] saveSnapshot failed for ${md.key}`, err));
  }
}
