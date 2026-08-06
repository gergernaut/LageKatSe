import { useEffect, useRef, useState } from "react";
import {
  canWrite,
  ETB_ENTRIES,
  type EtbRichtung,
  type EtbWeg,
  type LogEntry,
} from "@lagekatse/shared";
import * as Y from "yjs";
import { api } from "../api";
import type { Session } from "../session";
import { connectModule } from "../sync/provider";
import { dug } from "../dug";

const WAYS: EtbWeg[] = ["", "Funk", "Telefon", "Fax", "persönlich", "E-Mail"];

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function replaceTime(iso: string, time: string): string | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  const date = new Date(iso);
  if (!match || Number.isNaN(date.getTime())) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

/** Full local date+time for the CSV — HH:MM alone is ambiguous over a multi-day
 *  Lage, and the ETB is a Nachweisdokument (architecture.md §9.5). */
function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildCsv(entries: LogEntry[]): string {
  const header = [
    "Lfd.Nr",
    "Zeit",
    "Richtung",
    "Von",
    "An",
    "Weg",
    "Inhalt",
    "Veranlassung",
    "Erledigt",
    "Bearbeiter",
  ];
  const rows = entries.map((entry) => {
    // Das v1-Schema hat keine Storno-Spalte; die Kennzeichnung bleibt deshalb im Inhalt sichtbar.
    const inhalt = entry.storniert ? `[STORNIERT] ${entry.inhalt}` : entry.inhalt;
    return [
      entry.lfdNr,
      formatDateTime(entry.zeit),
      entry.richtung,
      entry.von,
      entry.an,
      entry.weg,
      inhalt,
      entry.veranlassung,
      entry.erledigt ? "ja" : "nein",
      entry.bearbeiter,
    ]
      .map(csvCell)
      .join(";");
  });
  return `\uFEFF${[header.join(";"), ...rows].join("\r\n")}`;
}

function downloadCsv(entries: LogEntry[], joinCode: string): void {
  const blob = new Blob([buildCsv(entries)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `einsatztagebuch-${joinCode}-${dug()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function TextCell({
  value,
  writable,
  multiline = false,
  onChange,
}: {
  value: string;
  writable: boolean;
  multiline?: boolean;
  onChange: (value: string) => void;
}) {
  if (!writable) return <span className="etb-value">{value}</span>;
  if (multiline) {
    return (
      <textarea
        className="etb-input etb-textarea"
        rows={2}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    );
  }
  return (
    <input
      className="etb-input"
      type="text"
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}

export function Etb({ session }: { session: Session }) {
  const [items, setItems] = useState<LogEntry[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const entriesRef = useRef<Y.Array<Y.Map<unknown>> | null>(null);
  const writable = canWrite(session.roles, "etb", {
    allowMonitorChat: session.room.settings.allowMonitorChat,
  });

  useEffect(() => {
    const conn = connectModule(session.room.id, "etb", session.token);
    const entries = conn.doc.getArray<Y.Map<unknown>>(ETB_ENTRIES);
    entriesRef.current = entries;

    const refresh = () => {
      setItems(entries.toArray().map((entry) => entry.toJSON() as LogEntry));
    };
    entries.observeDeep(refresh);
    refresh();

    return () => {
      entries.unobserveDeep(refresh);
      entriesRef.current = null;
      conn.destroy();
    };
  }, [session.room.id, session.token]);

  const setField = (id: string, field: keyof Omit<LogEntry, "id" | "lfdNr">, value: unknown) => {
    if (!writable) return;
    const entries = entriesRef.current;
    if (!entries) return;

    for (const entry of entries.toArray()) {
      if (entry.get("id") === id) {
        entry.set(field, value);
        return;
      }
    }
  };

  const createEntry = async () => {
    if (!writable || creating) return;
    setCreating(true);
    setError("");
    try {
      await api.createEtbEntry(session.room.joinCode, session.token);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Eintrag konnte nicht angelegt werden.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="work">
      <div className="work__bar">
        <h2>
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--ok)"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z" />
            <path d="M8 7h7M8 11h7" />
          </svg>
          Einsatztagebuch
        </h2>
        <span className="chip etb-hint">Lfd-Nr. &amp; Uhrzeit automatisch</span>
        {error && (
          <span className="etb-error" role="alert">
            {error}
          </span>
        )}
        <div className="spacer" />
        <button className="tool" type="button" onClick={() => downloadCsv(items, session.room.joinCode)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 15V3M7 8l5-5 5 5M5 21h14" />
          </svg>
          Export CSV
        </button>
      </div>

      <div className="etb-wrap">
        <div className="table-scroll">
          <table className="etb">
            <thead>
              <tr>
                <th style={{ width: 52 }}>Lfd.</th>
                <th style={{ width: 70 }}>Zeit</th>
                <th style={{ width: 64 }}>E/A</th>
                <th style={{ width: 110 }}>Von</th>
                <th style={{ width: 110 }}>An</th>
                <th style={{ width: 110 }}>Weg</th>
                <th>Inhalt</th>
                <th>Veranlassung</th>
                <th style={{ width: 60 }}>Erl.</th>
                <th style={{ width: 110 }}>Bearb.</th>
              </tr>
            </thead>
            <tbody>
              {items.map((entry) => (
                <tr key={entry.id} className={entry.storniert ? "etb-row--storniert" : undefined}>
                  <td className="nr">{String(entry.lfdNr).padStart(3, "0")}</td>
                  <td className="zeit">
                    {writable ? (
                      <input
                        className="etb-input etb-time"
                        type="time"
                        value={formatTime(entry.zeit)}
                        onChange={(event) => {
                          const iso = replaceTime(entry.zeit, event.currentTarget.value);
                          if (iso) setField(entry.id, "zeit", iso);
                        }}
                      />
                    ) : (
                      <span className="etb-value">{formatTime(entry.zeit)}</span>
                    )}
                  </td>
                  <td>
                    {writable ? (
                      <select
                        className={`etb-input etb-select rt ${
                          entry.richtung === "E" ? "rt--e" : entry.richtung === "A" ? "rt--a" : ""
                        }`}
                        value={entry.richtung}
                        aria-label={`Richtung für Eintrag ${entry.lfdNr}`}
                        onChange={(event) =>
                          setField(entry.id, "richtung", event.currentTarget.value as EtbRichtung)
                        }
                      >
                        <option value="">–</option>
                        <option value="E">E</option>
                        <option value="A">A</option>
                      </select>
                    ) : (
                      <span
                        className={`etb-value rt ${
                          entry.richtung === "E" ? "rt--e" : entry.richtung === "A" ? "rt--a" : ""
                        }`}
                      >
                        {entry.richtung || "–"}
                      </span>
                    )}
                  </td>
                  <td className="von">
                    <TextCell
                      value={entry.von}
                      writable={writable}
                      onChange={(value) => setField(entry.id, "von", value)}
                    />
                  </td>
                  <td className="an">
                    <TextCell
                      value={entry.an}
                      writable={writable}
                      onChange={(value) => setField(entry.id, "an", value)}
                    />
                  </td>
                  <td>
                    {writable ? (
                      <select
                        className="etb-input etb-select"
                        value={entry.weg}
                        aria-label={`Weg für Eintrag ${entry.lfdNr}`}
                        onChange={(event) =>
                          setField(entry.id, "weg", event.currentTarget.value as EtbWeg)
                        }
                      >
                        {WAYS.map((way) => (
                          <option key={way || "leer"} value={way}>
                            {way || "–"}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="etb-value">{entry.weg}</span>
                    )}
                  </td>
                  <td>
                    <TextCell
                      value={entry.inhalt}
                      writable={writable}
                      multiline
                      onChange={(value) => setField(entry.id, "inhalt", value)}
                    />
                  </td>
                  <td>
                    <TextCell
                      value={entry.veranlassung}
                      writable={writable}
                      multiline
                      onChange={(value) => setField(entry.id, "veranlassung", value)}
                    />
                  </td>
                  <td>
                    {writable ? (
                      <button
                        className={`done ${entry.erledigt ? "done--y" : "done--n"}`}
                        type="button"
                        aria-label={entry.erledigt ? "Als unerledigt markieren" : "Als erledigt markieren"}
                        aria-pressed={entry.erledigt}
                        onClick={() => setField(entry.id, "erledigt", !entry.erledigt)}
                      >
                        {entry.erledigt ? "✓" : ""}
                      </button>
                    ) : (
                      <span className={`etb-value done ${entry.erledigt ? "done--y" : "done--n"}`}>
                        {entry.erledigt ? "✓" : ""}
                      </span>
                    )}
                  </td>
                  <td className="von">
                    <span className="etb-value">{entry.bearbeiter}</span>
                    {writable && !entry.storniert && (
                      <button
                        className="etb-cancel"
                        type="button"
                        onClick={() => setField(entry.id, "storniert", true)}
                      >
                        Stornieren
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {items.length === 0 && !writable && (
                <tr>
                  <td className="etb-empty" colSpan={10}>
                    Noch keine Einträge
                  </td>
                </tr>
              )}
              {writable && (
                <tr className="etb-newrow">
                  <td colSpan={10}>
                    <button className="etb-add" type="button" disabled={creating} onClick={createEntry}>
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      {creating ? "Eintrag wird angelegt…" : "Neuer Eintrag"}
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
