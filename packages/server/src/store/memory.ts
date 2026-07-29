import type { DocState, RoomRecord, Store } from "./store";

const key = (roomId: string, module: string) => `${roomId}::${module}`;

/** In-process store. No durability — state is lost on restart. Default for dev. */
export class MemoryStore implements Store {
  private rooms = new Map<string, RoomRecord>();
  private codeToId = new Map<string, string>();
  private snapshots = new Map<string, Uint8Array>();
  private updates = new Map<string, Uint8Array[]>();

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  async createRoom(rec: RoomRecord): Promise<void> {
    this.rooms.set(rec.id, rec);
    this.codeToId.set(rec.joinCode.toUpperCase(), rec.id);
  }

  async getRoomById(id: string): Promise<RoomRecord | null> {
    return this.rooms.get(id) ?? null;
  }

  async getRoomByJoinCode(code: string): Promise<RoomRecord | null> {
    const id = this.codeToId.get(code.toUpperCase());
    return id ? this.rooms.get(id) ?? null : null;
  }

  async touchRoom(id: string, lastActiveAt: string): Promise<void> {
    const rec = this.rooms.get(id);
    if (rec) rec.lastActiveAt = lastActiveAt;
  }

  async loadDoc(roomId: string, module: string): Promise<DocState> {
    const k = key(roomId, module);
    return {
      snapshot: this.snapshots.get(k) ?? null,
      updates: [...(this.updates.get(k) ?? [])],
    };
  }

  async appendUpdate(roomId: string, module: string, update: Uint8Array): Promise<void> {
    const k = key(roomId, module);
    const arr = this.updates.get(k) ?? [];
    arr.push(update);
    this.updates.set(k, arr);
  }

  async saveSnapshot(roomId: string, module: string, snapshot: Uint8Array): Promise<void> {
    const k = key(roomId, module);
    this.snapshots.set(k, snapshot);
    this.updates.set(k, []);
  }
}
