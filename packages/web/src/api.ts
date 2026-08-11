import type {
  CreateRoomRequest,
  JoinRoomRequest,
  LogEntry,
  NewEtbEntryInput,
  RoomPublic,
  SessionResponse,
} from "@lagekatse/shared";

// Default "" = same-origin (API served by the reverse-proxy alongside the
// SPA). Set VITE_API_URL to an absolute URL for dev or split deployments.
const API_BASE = import.meta.env.VITE_API_URL ?? "";

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

/**
 * Derive the WebSocket origin. When an explicit `VITE_API_URL` is set (dev or
 * split deployment), use it. Otherwise build from `window.location` so WSS
 * works behind the reverse-proxy on the same origin (#65).
 */
export function wsBase(): string {
  if (API_BASE) return API_BASE.replace(/^http/, "ws");
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}`;
}
