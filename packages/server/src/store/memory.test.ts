import { describe, expect, it } from "vitest";
import { MemoryStore } from "./memory";
import type { RoomRecord } from "./store";

const now = Date.now();
const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();

function room(id: string, lastActiveOffsetMs: number): RoomRecord {
  return {
    id,
    name: `Room ${id}`,
    joinCode: `CODE-${id}`,
    passwordHash: null,
    settings: {},
    createdAt: iso(-60_000),
    lastActiveAt: iso(lastActiveOffsetMs),
  };
}

async function freshStore(): Promise<MemoryStore> {
  const store = new MemoryStore();
  await store.init();
  return store;
}

describe("MemoryStore.getStaleRooms", () => {
  it("liefert Räume deren last_active_at älter als der Schwellwert ist", async () => {
    const store = await freshStore();
    await store.createRoom(room("fresh", -10_000)); // 10s her
    await store.createRoom(room("stale", -90_000)); // 90s her
    const stale = await store.getStaleRooms(60_000); // > 60s
    expect(stale.map((r) => r.id)).toEqual(["stale"]);
  });

  it("liefert eine leere Liste wenn alle Räume aktiv sind", async () => {
    const store = await freshStore();
    await store.createRoom(room("r1", -1_000));
    await store.createRoom(room("r2", -5_000));
    const stale = await store.getStaleRooms(60_000);
    expect(stale).toEqual([]);
  });

  it("liefert alle Räume wenn der Schwellwert 0 ist", async () => {
    const store = await freshStore();
    await store.createRoom(room("a", -1));
    await store.createRoom(room("b", -1));
    const stale = await store.getStaleRooms(0);
    expect(stale).toHaveLength(2);
  });
});

describe("MemoryStore.deleteRoom", () => {
  it("löscht den Raum aus rooms und codeToId", async () => {
    const store = await freshStore();
    const rec = room("r1", -1_000);
    await store.createRoom(rec);
    expect(await store.getRoomById("r1")).not.toBeNull();
    expect(await store.getRoomByJoinCode("code-r1")).not.toBeNull();
    await store.deleteRoom("r1");
    expect(await store.getRoomById("r1")).toBeNull();
    expect(await store.getRoomByJoinCode("code-r1")).toBeNull();
  });

  it("räumt module-docs und updates per Prefix auf", async () => {
    const store = await freshStore();
    const rec = room("r1", -1_000);
    await store.createRoom(rec);
    const update = new Uint8Array([1, 2, 3]);
    await store.appendUpdate("r1", "etb", update);
    await store.saveSnapshot("r1", "etb", new Uint8Array([4, 5, 6]));
    // Andere Raum, der nicht gelöscht werden darf
    await store.createRoom(room("r2", -1_000));
    await store.saveSnapshot("r2", "etb", new Uint8Array([7, 8, 9]));
    await store.deleteRoom("r1");
    const doc1 = await store.loadDoc("r1", "etb");
    expect(doc1.snapshot).toBeNull();
    expect(doc1.updates).toEqual([]);
    // r2 unberührt
    const doc2 = await store.loadDoc("r2", "etb");
    expect(doc2.snapshot).toEqual(new Uint8Array([7, 8, 9]));
  });

  it("ist eine No-Op für nicht existierende Räume", async () => {
    const store = await freshStore();
    await store.deleteRoom("gibts-nicht");
    // Sollte nicht werfen — keine Räume, keine Docs
    expect(await store.loadDoc("gibts-nicht", "etb")).toEqual({ snapshot: null, updates: [] });
  });
});