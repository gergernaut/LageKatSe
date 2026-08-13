import type { RoomSettings } from "@lagekatse/shared";

export interface RoomRecord {
  id: string;
  name: string;
  joinCode: string;
  passwordHash: string | null;
  settings: RoomSettings;
  createdAt: string;
  lastActiveAt: string;
  /** Anzeige-String des Erstellers „Name (Rollen)" (#75); optional (Alt-Räume: leer). */
  createdBy?: string;
}

/** Persisted CRDT state for one (room, module) document. */
export interface DocState {
  snapshot: Uint8Array | null;
  updates: Uint8Array[];
}

/**
 * Persistence abstraction. Two implementations ship: MemoryStore (default,
 * no durability, great for dev/tests) and PostgresStore (durable). The rest
 * of the server never cares which one is in use.
 */
export interface Store {
  init(): Promise<void>;
  close(): Promise<void>;

  createRoom(rec: RoomRecord): Promise<void>;
  getRoomById(id: string): Promise<RoomRecord | null>;
  getRoomByJoinCode(code: string): Promise<RoomRecord | null>;
  touchRoom(id: string, lastActiveAt: string): Promise<void>;
  /** Räume deren last_active_at älter als der Schwellwert ist (E10/#66). */
  getStaleRooms(olderThanMs: number): Promise<RoomRecord[]>;
  /** Löscht einen Raum + alle abhängigen Daten per Cascade (E10/#66). */
  deleteRoom(id: string): Promise<void>;

  /** Base snapshot plus every update logged since it (architecture.md §7.2). */
  loadDoc(roomId: string, module: string): Promise<DocState>;
  /** Append one incremental update to the write-ahead log. */
  appendUpdate(roomId: string, module: string, update: Uint8Array): Promise<void>;
  /** Replace the snapshot and truncate the update log (compaction). */
  saveSnapshot(roomId: string, module: string, snapshot: Uint8Array): Promise<void>;
}
