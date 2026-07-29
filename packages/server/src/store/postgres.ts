import { Pool, type PoolClient } from "pg";
import { DEFAULT_ROOM_SETTINGS, type RoomSettings } from "@lagekatse/shared";
import type { DocState, RoomRecord, Store } from "./store";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS room (
  id             uuid PRIMARY KEY,
  name           text NOT NULL,
  join_code      text NOT NULL UNIQUE,
  password_hash  text,
  settings       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS room_join_code_idx ON room (upper(join_code));
CREATE TABLE IF NOT EXISTS module_doc (
  room_id    uuid NOT NULL REFERENCES room(id) ON DELETE CASCADE,
  module     text NOT NULL,
  snapshot   bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, module)
);
CREATE TABLE IF NOT EXISTS doc_update (
  id          bigserial PRIMARY KEY,
  room_id     uuid NOT NULL REFERENCES room(id) ON DELETE CASCADE,
  module      text NOT NULL,
  update_data bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS doc_update_room_module_idx ON doc_update (room_id, module, id);
`;

interface RoomRow {
  id: string;
  name: string;
  join_code: string;
  password_hash: string | null;
  settings: Partial<RoomSettings> | null;
  created_at: Date;
  last_active_at: Date;
}

function rowToRoom(row: RoomRow): RoomRecord {
  return {
    id: row.id,
    name: row.name,
    joinCode: row.join_code,
    passwordHash: row.password_hash,
    settings: { ...DEFAULT_ROOM_SETTINGS, ...(row.settings ?? {}) },
    createdAt: row.created_at.toISOString(),
    lastActiveAt: row.last_active_at.toISOString(),
  };
}

export class PostgresStore implements Store {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async init(): Promise<void> {
    await this.pool.query(SCHEMA_SQL);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async createRoom(rec: RoomRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO room (id, name, join_code, password_hash, settings, created_at, last_active_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
      [rec.id, rec.name, rec.joinCode, rec.passwordHash, JSON.stringify(rec.settings), rec.createdAt, rec.lastActiveAt],
    );
  }

  async getRoomById(id: string): Promise<RoomRecord | null> {
    const res = await this.pool.query<RoomRow>(`SELECT * FROM room WHERE id = $1`, [id]);
    return res.rows[0] ? rowToRoom(res.rows[0]) : null;
  }

  async getRoomByJoinCode(code: string): Promise<RoomRecord | null> {
    const res = await this.pool.query<RoomRow>(`SELECT * FROM room WHERE upper(join_code) = upper($1)`, [code]);
    return res.rows[0] ? rowToRoom(res.rows[0]) : null;
  }

  async touchRoom(id: string, lastActiveAt: string): Promise<void> {
    await this.pool.query(`UPDATE room SET last_active_at = $2 WHERE id = $1`, [id, lastActiveAt]);
  }

  async loadDoc(roomId: string, module: string): Promise<DocState> {
    const snap = await this.pool.query<{ snapshot: Buffer }>(
      `SELECT snapshot FROM module_doc WHERE room_id = $1 AND module = $2`,
      [roomId, module],
    );
    const ups = await this.pool.query<{ update_data: Buffer }>(
      `SELECT update_data FROM doc_update WHERE room_id = $1 AND module = $2 ORDER BY id ASC`,
      [roomId, module],
    );
    return {
      snapshot: snap.rows[0] ? new Uint8Array(snap.rows[0].snapshot) : null,
      updates: ups.rows.map((r) => new Uint8Array(r.update_data)),
    };
  }

  async appendUpdate(roomId: string, module: string, update: Uint8Array): Promise<void> {
    await this.pool.query(
      `INSERT INTO doc_update (room_id, module, update_data) VALUES ($1, $2, $3)`,
      [roomId, module, Buffer.from(update)],
    );
  }

  async saveSnapshot(roomId: string, module: string, snapshot: Uint8Array): Promise<void> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO module_doc (room_id, module, snapshot, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (room_id, module)
         DO UPDATE SET snapshot = EXCLUDED.snapshot, updated_at = now()`,
        [roomId, module, Buffer.from(snapshot)],
      );
      await client.query(`DELETE FROM doc_update WHERE room_id = $1 AND module = $2`, [roomId, module]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
