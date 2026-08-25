import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from "react";
import { buildCloseEtbText, hasStabRole, MODULE_LABELS, type Module } from "@lagekatse/shared";
import type { Session } from "../session";
import type { RoomChat } from "../sync/useRoomChat";
import { api } from "../api";
import { dug } from "../dug";
import { exportAll } from "../exportAll";
import { importBundle } from "../importAll";

const MODULE_CARDS: { key: Exclude<Module, "chat">; icon: string; tint: string; desc: string }[] = [
  { key: "lagekarte", icon: "🗺️", tint: "rgba(47,107,216,.12)", desc: "Taktische Zeichen (DV 102) & Bereiche auf OpenStreetMap." },
  { key: "etb", icon: "📓", tint: "rgba(46,158,91,.12)", desc: "Fortlaufendes Einsatztagebuch, Lfd-Nr. & Zeit automatisch." },
  { key: "arbeitsblatt", icon: "📋", tint: "rgba(247,168,27,.14)", desc: "Taktische Übersicht mit Lagebild, Kräften und Aufträgen." },
  { key: "kraefteubersicht", icon: "🚒", tint: "rgba(208,71,127,.12)", desc: "Fahrzeuge & Kräfte: Bereitstellungsraum / Im Einsatz mit DV-100-Stärke." },
];

const AV_COLORS = ["#2f6bd8", "#d5372b", "#2e9e5b", "#e08a1e", "#7c5ad8", "#0e9aa7", "#c2477f"];

function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AV_COLORS[hash % AV_COLORS.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const second = parts[1]?.[0] ?? "";
  return (first + second).toUpperCase() || "?";
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function Uebersicht({
  session,
  messages,
  online,
  canChat,
  send,
  onOpenModule,
}: RoomChat & {
  session: Session;
  onOpenModule: (module: Exclude<Module, "chat">) => void;
}) {
  const [draft, setDraft] = useState("");
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const chatLogRef = useRef<HTMLDivElement>(null);

  // Bundle-Import + Lage abschließen sind destruktiv → nur Stabsrollen.
  const canImport = hasStabRole(session.roles);
  const canClose = hasStabRole(session.roles);

  // Auto-Scroll: bei neuen Nachrichten und beim initialen Laden ans Ende scrollen.
  useEffect(() => {
    const el = chatLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
    setDraft("");
  };

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await exportAll(session);
    } catch (err) {
      console.error("Export fehlgeschlagen", err);
    } finally {
      setExporting(false);
    }
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget; // vor await sichern (React nullt currentTarget)
    const file = input.files?.[0];
    try {
      if (!file || importing) return;
      if (
        !window.confirm(
          "Der geteilte Stand aller Module (Lagekarte, Einsatztagebuch, Taktische Übersicht) wird durch das Bundle ersetzt — für alle im Stabsraum. Fortfahren?",
        )
      ) {
        return;
      }
      setImporting(true);
      setImportMsg(null);
      const result = await importBundle(session, file);
      const parts = [
        result.imported.length ? `Importiert: ${result.imported.join(", ")}` : "",
        result.skipped.length ? `Übersprungen: ${result.skipped.join(", ")}` : "",
      ].filter(Boolean);
      setImportMsg(parts.join(" · ") || "Nichts importiert.");
    } catch (err) {
      setImportMsg(err instanceof Error ? err.message : "Bundle-Import fehlgeschlagen.");
    } finally {
      setImporting(false);
      input.value = "";
    }
  };

  // Lage abschließen (#75): Doppel-Bestätigung → finaler ETB-Eintrag (server-
  // autoritativ) → Gesamt-Export → serverseitiges Löschen. Der Redirect aller
  // Clients läuft danach über das „closed"-Broadcast (AppShell/useRoomActivity).
  const handleClose = async () => {
    if (closing) return;
    if (!window.confirm("Lage abschließen? Dies schließt und löscht den Stabsraum!")) return;
    if (!window.confirm("Wirklich unwiderruflich abschließen? Vorher wird automatisch ein Gesamt-Export erstellt.")) return;
    setClosing(true);
    try {
      const closedBy = `${session.name} (${session.roles.join("/")})`;
      const inhalt = buildCloseEtbText({
        startDug: dug(new Date(session.room.createdAt)),
        createdBy: session.room.createdBy,
        endDug: dug(),
        closedBy,
      });
      // 1) Abschluss-Eintrag server-autoritativ (Invariante #6) — VOR dem Export.
      await api.createEtbEntry(session.room.joinCode, session.token, { inhalt, von: closedBy });
      // 2) Gesamt-Export (ZIP) — enthält den Abschluss-Eintrag.
      await exportAll(session);
      // 3) Serverseitig schließen + löschen; Broadcast leitet alle auf die Landing.
      await api.closeRoom(session.room.joinCode, session.token);
    } catch (err) {
      console.error("Lage abschließen fehlgeschlagen", err);
      setClosing(false);
      window.alert("Lage abschließen fehlgeschlagen. Bitte erneut versuchen.");
    }
  };

  return (
    <div className="wrap">
      <div className="uebersicht-head">
        <div>
          <h1>Anwendungen</h1>
          <p className="sub">Willkommen, {session.name}. Alle Inhalte werden live im Stabsraum synchronisiert.</p>
        </div>
        <div className="uebersicht-actions">
          <button
            className="btn btn--primary"
            type="button"
            onClick={handleExport}
            disabled={exporting}
            title="Alle Module als ZIP exportieren"
          >
            {exporting ? "Exportiere…" : "Bundle-Export"}
          </button>
          {canImport && (
            <>
              <button
                className="btn btn--primary"
                type="button"
                onClick={() => importInputRef.current?.click()}
                disabled={importing}
                title="Ein exportiertes Bundle (ZIP) einspielen — ersetzt den geteilten Stand"
              >
                {importing ? "Importiere…" : "Bundle-Import"}
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept=".zip,application/zip"
                style={{ display: "none" }}
                onChange={handleImportFile}
              />
            </>
          )}
          {canClose && (
            <button
              className="btn btn--danger"
              type="button"
              onClick={handleClose}
              disabled={closing}
              title="Lage abschließen: Abschluss-Eintrag + Gesamt-Export, dann Raum schließen und löschen"
            >
              {closing ? "Schließe…" : "Lage abschließen"}
            </button>
          )}
        </div>
      </div>
      {importMsg && <div className="import-note">{importMsg}</div>}

      <div className="modules">
        {MODULE_CARDS.map((m) => (
          <button className="module" key={m.key} type="button" onClick={() => onOpenModule(m.key)}>
            <div className="ic" style={{ background: m.tint }}>
              {m.icon}
            </div>
            <b>{MODULE_LABELS[m.key]}</b>
            <p>{m.desc}</p>
          </button>
        ))}
      </div>

      <div className="cols">
        <div className="box">
          <div className="box__head">
            <h3>Stabsraum-Chat</h3>
          </div>
          <div className="chat">
            <div className="chat__log" ref={chatLogRef}>
              {messages.length === 0 && <div className="chat__empty">Noch keine Nachrichten.</div>}
              {messages.map((msg) => (
                <div className="msg" key={msg.id}>
                  <div className="av" style={{ background: avatarColor(msg.authorName) }}>
                    {initials(msg.authorName)}
                  </div>
                  <div>
                    <div className="meta">
                      <b>{msg.authorName}</b> · {msg.authorRoles.join(",")} · {hhmm(msg.createdAt)}
                    </div>
                    <div className="body">{msg.body}</div>
                  </div>
                </div>
              ))}
            </div>
            {canChat ? (
              <form className="chat__in" onSubmit={submit}>
                <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Nachricht an den Stabsraum…" />
                <button className="btn" type="submit">
                  Senden
                </button>
              </form>
            ) : (
              <div className="chat__ro">Nur Lesen — deine Rolle darf im Chat nicht schreiben.</div>
            )}
          </div>
        </div>

        <div className="box">
          <div className="box__head">
            <h3>Online im Stabsraum</h3>
            <span className="count">{online.length}</span>
          </div>
          <div className="online">
            {online.map((p) => (
              <div className="person" key={p.sid}>
                <span className="pdot" style={{ background: p.color }} />
                <span className="nm">
                  {p.name}
                  {p.sid === session.sid ? " (Sie)" : ""}
                </span>
                <span className="rl">
                  {p.roles.map((r) => (
                    <span className="rolechip" key={r}>
                      {r}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
