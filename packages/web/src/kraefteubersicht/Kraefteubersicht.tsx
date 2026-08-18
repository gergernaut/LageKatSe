import { type ChangeEvent, useEffect, useRef, useState } from "react";
import {
  buildKraftEtbText,
  canWrite,
  countByTyp,
  formatStaerke,
  isRecord,
  KRAFT_EXPORT_FORMAT,
  KRAFT_ORGS,
  KRAFT_VEHICLES,
  parseKraftExport,
  sumStaerke,
  vehicleStaerke,
  type KraftExport,
  type KraftOrg,
  type KraftStatus,
  type KraftVehicle,
} from "@lagekatse/shared";
import * as Y from "yjs";
import { api } from "../api";
import type { Session } from "../session";
import { connectModule } from "../sync/provider";
import { dug } from "../dug";
import { uid } from "../uid";
import { applyKraftImport } from "./applyImport";

/** Tooltip-Aufschlüsselung „wieviele Fahrzeuge pro Typ" für die Übersichtskarte. */
function typBreakdown(vehicles: KraftVehicle[]): string {
  const counts = countByTyp(vehicles);
  const lines = Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([typ, n]) => `${typ}: ${n}`);
  return lines.length ? lines.join("\n") : "Keine Fahrzeuge";
}

export function Kraefteubersicht({ session }: { session: Session }) {
  const [items, setItems] = useState<KraftVehicle[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const vehiclesRef = useRef<Y.Array<Y.Map<unknown>> | null>(null);
  const writable = canWrite(session.roles, "kraefteubersicht", {
    allowMonitorChat: session.room.settings.allowMonitorChat,
  });

  useEffect(() => {
    const conn = connectModule(session.room.id, "kraefteubersicht", session.token);
    const vehicles = conn.doc.getArray<Y.Map<unknown>>(KRAFT_VEHICLES);
    vehiclesRef.current = vehicles;

    const refresh = () => {
      setItems(vehicles.toArray().map((v) => v.toJSON() as KraftVehicle));
    };
    vehicles.observeDeep(refresh);
    refresh();

    return () => {
      vehicles.unobserveDeep(refresh);
      vehiclesRef.current = null;
      conn.destroy();
    };
  }, [session.room.id, session.token]);

  const findMap = (id: string): Y.Map<unknown> | null => {
    const vehicles = vehiclesRef.current;
    if (!vehicles) return null;
    for (const v of vehicles.toArray()) if (v.get("id") === id) return v;
    return null;
  };

  const setField = (id: string, field: keyof Omit<KraftVehicle, "id">, value: unknown) => {
    if (!writable) return;
    const map = findMap(id);
    if (!map) return;
    map.doc?.transact(() => {
      map.set(field, value);
      map.set("updatedAt", new Date().toISOString());
    });
  };

  const setNum = (id: string, field: "fuehrer" | "unterfuehrer" | "helfer", raw: string) => {
    const n = Math.max(0, Math.floor(Number(raw)));
    setField(id, field, Number.isFinite(n) ? n : 0);
  };

  const addVehicle = (status: KraftStatus) => {
    if (!writable) return;
    const vehicles = vehiclesRef.current;
    if (!vehicles) return;
    const now = new Date().toISOString();
    const vehicle: KraftVehicle = {
      id: uid(),
      org: "FW",
      typ: "",
      funkrufname: "",
      fuehrer: 0,
      unterfuehrer: 0,
      helfer: 0,
      status,
      createdAt: now,
      updatedAt: now,
    };
    const map = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(vehicle)) map.set(key, value);
    vehicles.push([map]);
  };

  // Server-autoritatives ETB-Protokoll der Kräftebewegung (Invariante #6). Die
  // CRDT-Mutation ist bereits erfolgt/lokal sichtbar — schlägt nur das Logging
  // fehl, bleibt die Bewegung stehen; wir zeigen einen nicht-blockierenden Hinweis.
  const logToEtb = async (text: string) => {
    try {
      await api.kraftEtbLog(session.room.joinCode, session.token, text);
    } catch (cause) {
      setNotice(cause instanceof Error ? `ETB-Protokoll fehlgeschlagen: ${cause.message}` : "ETB-Protokoll fehlgeschlagen.");
    }
  };

  const moveVehicle = (vehicle: KraftVehicle, to: KraftStatus) => {
    if (!writable || vehicle.status === to) return;
    setNotice("");
    setField(vehicle.id, "status", to);
    void logToEtb(buildKraftEtbText(vehicle, to === "einsatz" ? "toEinsatz" : "toBr"));
  };

  const releaseVehicle = (vehicle: KraftVehicle) => {
    if (!writable) return;
    if (!window.confirm(`Fahrzeug „${vehicle.funkrufname || "(ohne Funkrufname)"}" entlassen (aus der Liste streichen)?`)) {
      return;
    }
    setNotice("");
    const text = buildKraftEtbText(vehicle, "entlassen"); // vor dem Löschen bauen
    const vehicles = vehiclesRef.current;
    if (vehicles) {
      const idx = vehicles.toArray().findIndex((v) => v.get("id") === vehicle.id);
      if (idx >= 0) vehicles.delete(idx, 1);
    }
    void logToEtb(text);
  };

  const exportJson = () => {
    const payload: KraftExport = {
      format: KRAFT_EXPORT_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      vehicles: items,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `kraefteuebersicht-${session.room.joinCode}-${dug()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  // JSON-Import: ersetzt die gesamte Kräfteübersicht (client-CRDT, für alle im Raum).
  // Destruktiv → window.confirm; nur mit Schreibrecht.
  const importJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget; // vor await sichern (React nullt currentTarget)
    const file = input.files?.[0];
    try {
      if (!file || importing || !writable) return;
      const parsed: unknown = JSON.parse(await file.text());
      const rows = isRecord(parsed) ? parseKraftExport(parsed, uid) : null;
      if (!rows) {
        setNotice("Import fehlgeschlagen: kein gültiges Kräfteübersicht-Format.");
        return;
      }
      if (
        !window.confirm(
          "Die aktuelle Kräfteübersicht wird durch die importierten Fahrzeuge ersetzt — für alle im Stabsraum. Fortfahren?",
        )
      ) {
        return;
      }
      setImporting(true);
      setNotice("");
      setError("");
      const vehicles = vehiclesRef.current;
      if (vehicles) applyKraftImport(vehicles, rows, { replace: true });
      setNotice(`${rows.length} Fahrzeug${rows.length === 1 ? "" : "e"} importiert.`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Import fehlgeschlagen.");
    } finally {
      setImporting(false);
      input.value = "";
    }
  };

  const brItems = items.filter((v) => v.status === "br");
  const einsatzItems = items.filter((v) => v.status === "einsatz");
  const brStaerke = sumStaerke(brItems);

  const renderTable = (rows: KraftVehicle[], status: KraftStatus) => {
    const target: KraftStatus = status === "br" ? "einsatz" : "br";
    const targetLabel = status === "br" ? "→ Einsatz" : "→ BR";
    return (
      <div className="table-scroll">
        <table className="etb kraft-table">
          <thead>
            <tr>
              <th style={{ width: 120 }}>Org</th>
              <th style={{ width: 130 }}>Fahrzeugtyp</th>
              <th style={{ width: 220 }}>Funkrufname</th>
              <th style={{ width: 200 }} title="DV 100: Führer / Unterführer / Helfer // Gesamtstärke">
                Stärke
              </th>
              <th style={{ width: 180 }}>Aktion</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => {
              const s = vehicleStaerke(v);
              return (
                <tr key={v.id}>
                  <td>
                    {writable ? (
                      <select
                        className="etb-input etb-select"
                        value={v.org}
                        aria-label="Trägerorganisation"
                        onChange={(e) => setField(v.id, "org", e.currentTarget.value as KraftOrg)}
                      >
                        {KRAFT_ORGS.map((org) => (
                          <option key={org} value={org}>
                            {org}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="etb-value">{v.org}</span>
                    )}
                  </td>
                  <td>
                    {writable ? (
                      <input
                        className="etb-input"
                        type="text"
                        value={v.typ}
                        placeholder="z. B. LF 20, RTW, GW-L2"
                        onChange={(e) => setField(v.id, "typ", e.currentTarget.value)}
                      />
                    ) : (
                      <span className="etb-value">{v.typ}</span>
                    )}
                  </td>
                  <td>
                    {writable ? (
                      <input
                        className="etb-input"
                        type="text"
                        value={v.funkrufname}
                        placeholder="Funkrufname"
                        onChange={(e) => setField(v.id, "funkrufname", e.currentTarget.value)}
                      />
                    ) : (
                      <span className="etb-value">{v.funkrufname}</span>
                    )}
                  </td>
                  <td>
                    {writable ? (
                      <span className="kraft-staerke">
                        <input
                          className="etb-input kraft-num"
                          type="number"
                          min={0}
                          value={String(v.fuehrer)}
                          title="Führer"
                          aria-label="Führer"
                          onChange={(e) => setNum(v.id, "fuehrer", e.currentTarget.value)}
                        />
                        <span className="kraft-sep">/</span>
                        <input
                          className="etb-input kraft-num"
                          type="number"
                          min={0}
                          value={String(v.unterfuehrer)}
                          title="Unterführer"
                          aria-label="Unterführer"
                          onChange={(e) => setNum(v.id, "unterfuehrer", e.currentTarget.value)}
                        />
                        <span className="kraft-sep">/</span>
                        <input
                          className="etb-input kraft-num"
                          type="number"
                          min={0}
                          value={String(v.helfer)}
                          title="Helfer"
                          aria-label="Helfer"
                          onChange={(e) => setNum(v.id, "helfer", e.currentTarget.value)}
                        />
                        <span className="kraft-sep">//</span>
                        <span className="kraft-gesamt" title="Gesamtstärke">
                          {s.gesamt}
                        </span>
                      </span>
                    ) : (
                      <span className="etb-value kraft-staerke-ro" title="Führer/Unterführer/Helfer//Gesamt">
                        {formatStaerke(s)}
                      </span>
                    )}
                  </td>
                  <td>
                    {writable ? (
                      <div className="kraft-actions">
                        <button className="kraft-move" type="button" onClick={() => moveVehicle(v, target)}>
                          {targetLabel}
                        </button>
                        <button className="etb-cancel kraft-release" type="button" onClick={() => releaseVehicle(v)}>
                          Entlassen
                        </button>
                      </div>
                    ) : (
                      <span className="etb-value">–</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td className="etb-empty" colSpan={5}>
                  Keine Fahrzeuge {status === "br" ? "im Bereitstellungsraum" : "im Einsatz"}
                </td>
              </tr>
            )}
            {writable && (
              <tr className="etb-newrow">
                <td colSpan={5}>
                  <button className="etb-add" type="button" onClick={() => addVehicle(status)}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    Neues Fahrzeug
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="work">
      <div className="work__bar">
        <h2>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--forces)" strokeWidth="2" aria-hidden="true">
            <path d="M4 17V7a2 2 0 0 1 2-2h9l4 4v8M4 17h16M7 17a2 2 0 1 1-4 0M21 17a2 2 0 1 1-4 0" />
          </svg>
          Kräfteübersicht
        </h2>
        {notice && <span className="chip">{notice}</span>}
        {error && (
          <span className="etb-error" role="alert">
            {error}
          </span>
        )}
        <div className="spacer" />
        {writable && (
          <button className="tool" type="button" onClick={() => importInputRef.current?.click()} disabled={importing}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
            </svg>
            {importing ? "Importiere…" : "Import JSON"}
          </button>
        )}
        <input ref={importInputRef} type="file" accept="application/json,.json" hidden onChange={importJson} />
        <button className="tool" type="button" onClick={exportJson}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 15V3M7 8l5-5 5 5M5 21h14" />
          </svg>
          Export JSON
        </button>
      </div>

      <div className="kraft-wrap">
        <div className="kraft-cards">
          <div className="kraft-card">
            <span className="kraft-card__label">Gesamtstärke BR</span>
            <span className="kraft-card__value">{formatStaerke(brStaerke)}</span>
            <span className="kraft-card__hint">Führer / Unterführer / Helfer // Gesamt</span>
          </div>
          <div className="kraft-card" title={typBreakdown(brItems)}>
            <span className="kraft-card__label">Fahrzeuge im BR</span>
            <span className="kraft-card__value">{brItems.length}</span>
            <span className="kraft-card__hint">Aufschlüsselung je Typ ▸ mit Maus zeigen</span>
          </div>
        </div>

        <section className="kraft-section">
          <h3 className="kraft-section__title">
            Bereitstellungsraum
            <span className="kraft-badge" title="Führer/Unterführer/Helfer//Gesamt">
              {formatStaerke(brStaerke)} · {brItems.length} Fz.
            </span>
          </h3>
          {renderTable(brItems, "br")}
        </section>

        <section className="kraft-section">
          <h3 className="kraft-section__title">
            Im Einsatz
            <span className="kraft-badge" title="Führer/Unterführer/Helfer//Gesamt">
              {formatStaerke(sumStaerke(einsatzItems))} · {einsatzItems.length} Fz.
            </span>
          </h3>
          {renderTable(einsatzItems, "einsatz")}
        </section>
      </div>
    </div>
  );
}
