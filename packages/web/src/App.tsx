import { useState } from "react";
import type { Module } from "@lagekatse/shared";
import { Lagekarte } from "./lagekarte/Lagekarte";
import { Lobby } from "./lobby/Lobby";
import type { Session } from "./session";
import { Uebersicht } from "./uebersicht/Uebersicht";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [activeModule, setActiveModule] = useState<Module | null>(null);

  if (!session) return <Lobby onEnter={setSession} />;
  if (activeModule === "lagekarte") {
    return <Lagekarte session={session} onBack={() => setActiveModule(null)} />;
  }
  return <Uebersicht session={session} onOpenModule={setActiveModule} onLeave={() => setSession(null)} />;
}
