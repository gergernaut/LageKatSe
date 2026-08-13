import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { customAlphabet } from "nanoid";
import {
  DEFAULT_ROOM_SETTINGS,
  isRole,
  type CreateRoomRequest,
  type JoinRoomRequest,
  type Role,
  type RoomPublic,
  type RoomSettings,
  type SessionClaims,
} from "@lagekatse/shared";
import type { RoomRecord, Store } from "./store";

// Human-friendly codes: no ambiguous characters (0/O, 1/I/L).
const genCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class RoomService {
  constructor(private readonly store: Store) {}

  async create(req: CreateRoomRequest): Promise<RoomRecord> {
    const name = req.name?.trim();
    if (!name) throw new HttpError(400, "invalid_name", "Bezeichnung darf nicht leer sein.");

    const settings: RoomSettings = { ...DEFAULT_ROOM_SETTINGS, ...(req.settings ?? {}) };
    const passwordHash = req.password ? await bcrypt.hash(req.password, 10) : null;
    const now = new Date().toISOString();
    const joinCode = await this.uniqueCode();

    const rec: RoomRecord = {
      id: randomUUID(),
      name,
      joinCode,
      passwordHash,
      settings,
      createdAt: now,
      lastActiveAt: now,
      createdBy: req.createdBy?.trim() || undefined,
    };
    await this.store.createRoom(rec);
    return rec;
  }

  async getByCode(code: string): Promise<RoomRecord | null> {
    return this.store.getRoomByJoinCode(code);
  }

  async getById(id: string): Promise<RoomRecord | null> {
    return this.store.getRoomById(id);
  }

  async join(code: string, req: JoinRoomRequest): Promise<{ room: RoomRecord; claims: SessionClaims }> {
    const room = await this.store.getRoomByJoinCode(code);
    if (!room) throw new HttpError(404, "room_not_found", "Kein Stabsraum mit diesem Lobby-Code.");

    const name = req.name?.trim();
    if (!name) throw new HttpError(400, "invalid_name", "Bitte einen Anzeigenamen angeben.");

    const roles = (req.roles ?? []).filter(isRole) as Role[];
    if (roles.length === 0) throw new HttpError(400, "no_roles", "Bitte mindestens eine Rolle wählen.");

    if (room.passwordHash) {
      const ok = req.password ? await bcrypt.compare(req.password, room.passwordHash) : false;
      if (!ok) throw new HttpError(401, "bad_password", "Falsches Raum-Passwort.");
    }

    await this.store.touchRoom(room.id, new Date().toISOString());
    const claims: SessionClaims = { sid: randomUUID(), room: room.id, name, roles };
    return { room, claims };
  }

  private async uniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = genCode();
      if (!(await this.store.getRoomByJoinCode(code))) return code;
    }
    throw new HttpError(500, "code_exhausted", "Konnte keinen freien Lobby-Code erzeugen.");
  }
}

export function toPublic(rec: RoomRecord): RoomPublic {
  return {
    id: rec.id,
    name: rec.name,
    joinCode: rec.joinCode,
    hasPassword: rec.passwordHash !== null,
    settings: rec.settings,
    createdAt: rec.createdAt,
    createdBy: rec.createdBy,
  };
}
