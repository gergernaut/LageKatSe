import type { Role } from "./roles";

/**
 * Claims carried by the signed session token (JWT payload). The WebSocket
 * gateway trusts `roles` (server-signed) but re-reads room settings from the
 * store, so a room's permission changes take effect without re-issuing tokens.
 */
export interface SessionClaims {
  sid: string; // session id
  room: string; // room id
  name: string; // display name (self-declared)
  roles: Role[];
}

export interface RoomSettings {
  /** May the Monitor role write to chat? (decision E1, default on) */
  allowMonitorChat: boolean;
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  allowMonitorChat: true,
};

/** Room info safe to expose to clients (no password hash). */
export interface RoomPublic {
  id: string;
  name: string;
  joinCode: string;
  hasPassword: boolean;
  settings: RoomSettings;
  createdAt: string;
  /** Anzeige-String des Erstellers „Name (Rollen)" — für den Abschluss-ETB-Eintrag (#75). */
  createdBy?: string;
}

// ---- HTTP request / response contracts ----

export interface CreateRoomRequest {
  name: string;
  password?: string;
  settings?: Partial<RoomSettings>;
  /** Anzeige-String des Erstellers „Name (Rollen)" — beim Anlegen mitgegeben (#75). */
  createdBy?: string;
}

export interface JoinRoomRequest {
  name: string;
  roles: Role[];
  password?: string;
}

export interface SessionResponse {
  token: string;
  session: { sid: string; name: string; roles: Role[] };
  room: RoomPublic;
}

export interface ApiError {
  error: string;
  message: string;
}
