import { useEffect, useState } from "react";
import type { Module } from "@lagekatse/shared";
import { api } from "./api";
import { Lagekarte } from "./lagekarte/Lagekarte";
import { Lobby } from "./lobby/Lobby";
import { clearSession, loadSession, saveSession, type Session } from "./session";
import { Uebersicht } from "./uebersicht/Uebersicht";

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [activeModule, setActiveModule] = useState<Module | null>(null);

  // A session restored from storage may reference a room that no longer exists
  // (e.g. the backend was restarted). Verify it once on mount and, if the room
  // is gone, drop the session and fall back to the lobby.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    api.getRoom(session.room.joinCode).catch(() => {
      if (cancelled) return;
      clearSession();
      setActiveModule(null);
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
    setActiveModule(null);
    setSession(null);
  };

  if (!session) return <Lobby onEnter={enter} />;
  if (activeModule === "lagekarte") {
    return <Lagekarte session={session} onBack={() => setActiveModule(null)} />;
  }
  return <Uebersicht session={session} onOpenModule={setActiveModule} onLeave={leave} />;
}
