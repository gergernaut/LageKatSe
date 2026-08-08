import type {
  CreateRoomRequest,
  JoinRoomRequest,
  LogEntry,
  NewEtbEntryInput,
  RoomPublic,
  SessionResponse,
} from "@lagekatse/shared";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof data === "object" && data && "message" in data
        ? String((data as { message: unknown }).message)
        : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return data as T;
}

export const api = {
  base: API_BASE,
  createRoom: (body: CreateRoomRequest) =>
    request<{ room: RoomPublic }>("/api/rooms", { method: "POST", body: JSON.stringify(body) }),
  getRoom: (code: string) => request<{ room: RoomPublic }>(`/api/rooms/${encodeURIComponent(code)}`),
  join: (code: string, body: JoinRoomRequest) =>
    request<SessionResponse>(`/api/rooms/${encodeURIComponent(code)}/join`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createEtbEntry: (code: string, token: string, body: NewEtbEntryInput = {}) =>
    request<{ entry: LogEntry }>(`/api/rooms/${encodeURIComponent(code)}/etb/entries`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { authorization: `Bearer ${token}` },
    }),
  // Bundle-Import (#71): ersetzt das gesamte ETB server-autoritativ (nur S-Rollen).
  importEtb: (code: string, token: string, entries: LogEntry[]) =>
    request<{ count: number }>(`/api/rooms/${encodeURIComponent(code)}/etb/import`, {
      method: "POST",
      body: JSON.stringify({ entries }),
      headers: { authorization: `Bearer ${token}` },
    }),
};

/** Derive the WebSocket origin from the HTTP API base. */
export function wsBase(): string {
  return API_BASE.replace(/^http/, "ws");
}
