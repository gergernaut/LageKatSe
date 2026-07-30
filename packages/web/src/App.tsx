import { useEffect, useState } from "react";
import { api } from "./api";
import { Lobby } from "./lobby/Lobby";
import { clearSession, loadSession, saveSession, type Session } from "./session";
import { AppShell } from "./shell/AppShell";

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());

  // A session restored from storage may reference a room that no longer exists
  // (e.g. the backend was restarted). Verify it once on mount and, if the room
  // is gone, drop the session and fall back to the lobby.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    api.getRoom(session.room.joinCode).catch(() => {
      if (cancelled) return;
      clearSession();
      setSession(null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enter = (next: Session) => {
    saveSession(next);
    setSession(next);
  };

  const leave = () => {
    clearSession();
    setSession(null);
  };

  if (!session) return <Lobby onEnter={enter} />;
  return <AppShell session={session} onLeave={leave} />;
}
