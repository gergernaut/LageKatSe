-- LageKatSe persistence schema (PostgreSQL).
-- Applied automatically by the docker-compose db service on first start,
-- and idempotently by PostgresStore.init().

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

-- One compacted snapshot per (room, module).
CREATE TABLE IF NOT EXISTS module_doc (
  room_id    uuid NOT NULL REFERENCES room(id) ON DELETE CASCADE,
  module     text NOT NULL,
  snapshot   bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, module)
);

-- Write-ahead log of updates appended since the last snapshot.
CREATE TABLE IF NOT EXISTS doc_update (
  id          bigserial PRIMARY KEY,
  room_id     uuid NOT NULL REFERENCES room(id) ON DELETE CASCADE,
  module      text NOT NULL,
  update_data bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS doc_update_room_module_idx ON doc_update (room_id, module, id);
