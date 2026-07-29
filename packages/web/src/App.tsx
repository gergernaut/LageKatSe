import { useState } from "react";
import { Lobby } from "./lobby/Lobby";
import type { Session } from "./session";
import { Uebersicht } from "./uebersicht/Uebersicht";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);

  return session ? (
    <Uebersicht session={session} onLeave={() => setSession(null)} />
  ) : (
    <Lobby onEnter={setSession} />
  );
}
