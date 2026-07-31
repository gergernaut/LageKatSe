import { type FormEvent, useState } from "react";
import { ROLE_LABELS, type Role } from "@lagekatse/shared";
import { api } from "../api";
import type { Session } from "../session";

type Mode = "join" | "create";

const S_ROLES: Role[] = ["S1", "S2", "S3", "S4", "S5", "S6"];
const OTHER_ROLES: Role[] = ["LAGEKARTE", "ETB", "MONITOR"];

export function Lobby({ onEnter }: { onEnter: (session: Session) => void }) {
  const [mode, setMode] = useState<Mode>("join");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [roles, setRoles] = useState<Set<Role>>(() => new Set<Role>(["S3"]));
  const [password, setPassword] = useState("");

  const [code, setCode] = useState("");
  const [roomName, setRoomName] = useState("");
  const [allowMonitorChat, setAllowMonitorChat] = useState(true);

  const toggleRole = (role: Role) =>
    setRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });

  const enter = async (joinCode: string, pwd: string | undefined) => {
    const res = await api.join(joinCode, { name: name.trim(), roles: [...roles], password: pwd });
    onEnter({
      token: res.token,
      sid: res.session.sid,
      name: res.session.name,
      roles: res.session.roles,
      room: res.room,
    });
  };

  const submitJoin = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await enter(code.trim(), password || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Beitritt fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.createRoom({
        name: roomName.trim(),
        password: password || undefined,
        settings: { allowMonitorChat },
      });
      await enter(created.room.joinCode, password || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erstellen fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  const rolePicker = (
    <div className="field">
      <span className="lab">Rollen (Mehrfachauswahl)</span>
      <div className="roles">
        {S_ROLES.map((r) => (
          <label key={r} className="role">
            <input type="checkbox" checked={roles.has(r)} onChange={() => toggleRole(r)} />
            {r}
          </label>
        ))}
        {OTHER_ROLES.map((r) => (
          <label key={r} className="role role--wide">
            <input type="checkbox" checked={roles.has(r)} onChange={() => toggleRole(r)} />
            {ROLE_LABELS[r]}
          </label>
        ))}
      </div>
    </div>
  );

  const nameField = (
    <label className="field">
      <span className="lab">Anzeigename</span>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. M. Mustermann" />
    </label>
  );

  return (
    <div className="lobby">
      <div className="brand">
        <div className="brand__mark">L</div>
        <div className="brand__name">
          Lage<b>KatSe</b>
        </div>
      </div>

      <div className="lobby__hero">
        <div className="eyebrow">Lageverwaltung · Katastrophenschutz</div>
        <h1>
          Ein Stab. Ein <span>Lagebild</span>. In Echtzeit.
        </h1>
        <p>
          Stabsraum beitreten oder neu erstellen. Chat, Präsenz, Lagekarte und
          Einsatztagebuch laufen live — das taktische Arbeitsblatt folgt.
        </p>
      </div>

      <div className="tabs">
        <button className={mode === "join" ? "active" : ""} onClick={() => { setMode("join"); setError(null); }}>
          Beitreten
        </button>
        <button className={mode === "create" ? "active" : ""} onClick={() => { setMode("create"); setError(null); }}>
          Erstellen
        </button>
      </div>

      {mode === "join" ? (
        <form className="card" onSubmit={submitJoin}>
          <h2>Stabsraum beitreten</h2>
          <p className="hint">Mit Lobby-Code beitreten. Die gewählten Rollen bestimmen deine Rechte.</p>
          <label className="field">
            <span className="lab">Lobby-Code</span>
            <input
              className="input input--code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCDEF"
            />
          </label>
          {nameField}
          {rolePicker}
          <label className="field">
            <span className="lab">Raum-Passwort (falls gesetzt)</span>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="optional" />
          </label>
          {error && <div className="error-note">{error}</div>}
          <button className="btn btn--primary" style={{ width: "100%", marginTop: 6 }} disabled={busy}>
            {busy ? "…" : "Beitreten →"}
          </button>
        </form>
      ) : (
        <form className="card" onSubmit={submitCreate}>
          <h2>Neuen Stabsraum erstellen</h2>
          <p className="hint">Legt einen persistenten Raum an und tritt dir direkt bei.</p>
          <label className="field">
            <span className="lab">Bezeichnung der Lage</span>
            <input className="input" value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="z. B. Hochwasser Mittelweser" />
          </label>
          {nameField}
          {rolePicker}
          <label className="field">
            <span className="lab">Raum-Passwort (optional)</span>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="optional" />
          </label>
          <label className="toggle" style={{ marginBottom: 16 }}>
            <input type="checkbox" checked={allowMonitorChat} onChange={(e) => setAllowMonitorChat(e.target.checked)} />
            Monitor-Rolle darf chatten
          </label>
          {error && <div className="error-note">{error}</div>}
          <button className="btn btn--primary" style={{ width: "100%" }} disabled={busy}>
            {busy ? "…" : "Erstellen & beitreten →"}
          </button>
        </form>
      )}
    </div>
  );
}
