import type { Role, RoomPublic } from "@lagekatse/shared";

/** Everything the client needs after a successful join. */
export interface Session {
  token: string;
  sid: string;
  name: string;
  roles: Role[];
  room: RoomPublic;
}

// Persisted per-tab so a reload (F5) keeps the user in the Stabsraum instead of
// bouncing back to the lobby. sessionStorage (not localStorage) is deliberate:
// it survives reloads but is cleared when the tab closes, so the token does not
// linger on shared machines.
const STORAGE_KEY = "lagekatse.session";

/** True if the JWT's `exp` claim is in the past (decoded, not verified). */
function tokenExpired(token: string): boolean {
  const payload = token.split(".")[1];
  if (!payload) return true;
  try {
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
    return typeof claims.exp === "number" ? claims.exp * 1000 <= Date.now() : false;
  } catch {
    return true;
  }
}

/** Restore a stored session, dropping it if malformed or the token has expired. */
export function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    if (!session?.token || !session.room?.id || !Array.isArray(session.roles) || tokenExpired(session.token)) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* storage unavailable (private mode / quota) — fall back to in-memory only */
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
