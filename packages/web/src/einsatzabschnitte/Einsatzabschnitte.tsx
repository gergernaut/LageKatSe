import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  AB_KANAELE,
  AB_KANAL_FIELDS,
  AB_ORGANISATION,
  canWrite,
  EA_ABSCHNITTE,
  EA_EXPORT_FORMAT,
  EA_TYPEN,
  formatStaerke,
  isRecord,
  KRAFT_VEHICLES,
  parseEinsatzabschnitteExport,
  sumStaerke,
  type AbKanal,
  type EaTyp,
  type Einsatzabschnitt,
  type EinsatzabschnitteExport,
  type KraftVehicle,
} from "@lagekatse/shared";
import * as Y from "yjs";
import type { Session } from "../session";
import { connectModule } from "../sync/provider";
import { uid } from "../uid";
import { dug } from "../dug";
import { applyEinsatzabschnitteImport } from "./applyImport";

function stringValue(map: Y.Map<unknown>, field: string): string {
  const value = map.get(field);
  return typeof value === "string" ? value : "";
}

export function Einsatzabschnitte({ session }: { session: Session }) {
  const [abschnitte, setAbschnitte] = useState<Einsatzabschnitt[]>([]);
  const [vehicles, setVehicles] = useState<KraftVehicle[]>([]);
  const [funkkanaele, setFunkkanaele] = useState<string[]>([]);
  // Auswahl im Zuordnen-Dropdown je Abschnitt (abschnittId -> vehicleId).
  const [assignSel, setAssignSel] = useState<Record<string, string>>({});
  const [importMessage, setImportMessage] = useState("");
  const abschnitteRef = useRef<Y.Array<Y.Map<unknown>> | null>(null);
  const vehiclesRef = useRef<Y.Array<Y.Map<unknown>> | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const writable = canWrite(session.roles, "einsatzabschnitte", {
    allowMonitorChat: session.room.settings.allowMonitorChat,
  });

  // Eigenes Modul-Dokument: die Einsatzabschnitte (CRUD).
  useEffect(() => {
    const conn = connectModule(session.room.id, "einsatzabschnitte", session.token);
    const abschnitte = conn.doc.getArray<Y.Map<unknown>>(EA_ABSCHNITTE);
    abschnitteRef.current = abschnitte;
    const refresh = () => setAbschnitte(abschnitte.toArray().map((m) => m.toJSON() as Einsatzabschnitt));
    abschnitte.observeDeep(refresh);
    refresh();
    return () => {
      abschnitte.unobserveDeep(refresh);
      abschnitteRef.current = null;
      conn.destroy();
    };
  }, [session.room.id, session.token]);

  // Read-only cross-module: die Kräfteübersicht liefert die zugeordneten Fahrzeuge
  // (Ableitung der Stärke je Abschnitt). Kein Schreibpfad hier (Zuordnung: #137).
  useEffect(() => {
    const conn = connectModule(session.room.id, "kraefteubersicht", session.token);
    const list = conn.doc.getArray<Y.Map<unknown>>(KRAFT_VEHICLES);
    vehiclesRef.current = list;
    const refresh = () => setVehicles(list.toArray().map((v) => v.toJSON() as KraftVehicle));
    list.observeDeep(refresh);
    refresh();
    return () => {
      list.unobserveDeep(refresh);
      vehiclesRef.current = null;
      conn.destroy();
    };
  }, [session.room.id, session.token]);

  // Read-only cross-module: Funkkanäle der Taktischen Übersicht für das
  // Kommunikations-Freitext-Dropdown (feste Kanäle + frei angelegte).
  useEffect(() => {
    const conn = connectModule(session.room.id, "arbeitsblatt", session.token);
    const org = conn.doc.getMap<unknown>(AB_ORGANISATION);
    const kanaele = conn.doc.getArray<Y.Map<unknown>>(AB_KANAELE);
    const refresh = () => {
      const fixed = AB_KANAL_FIELDS.map((f) => stringValue(org, f));
      const frei = kanaele.toArray().map((m) => {
        const k = m.toJSON() as AbKanal;
        return `${k.typ} ${k.gruppe}`.trim();
      });
      const all = [...fixed, ...frei].map((s) => s.trim()).filter(Boolean);
      setFunkkanaele([...new Set(all)]);
    };
    org.observeDeep(refresh);
    kanaele.observeDeep(refresh);
    refresh();
    return () => {
      org.unobserveDeep(refresh);
      kanaele.unobserveDeep(refresh);
      conn.destroy();
    };
  }, [session.room.id, session.token]);

  const setField = (id: string, field: keyof Omit<Einsatzabschnitt, "id">, value: unknown) => {
    if (!writable) return;
    const row = abschnitteRef.current?.toArray().find((m) => m.get("id") === id);
    row?.set(field, value);
  };

  const addAbschnitt = () => {
    if (!writable) return;
    const rows = abschnitteRef.current;
    if (!rows) return;
    // einsatzbeginn = DUG bei Anlage (bearbeitbar), createdAt = Serverzeit-nah (Client-ISO).
    const value: Einsatzabschnitt = {
      id: uid(),
      typ: "EA",
      titel: "",
      befehlsstelle: "",
      leiter: "",
      kommunikation: "",
      auftrag: "",
      einsatzbeginn: dug(),
      createdAt: new Date().toISOString(),
    };
    const row = new Y.Map<unknown>();
    Object.entries(value).forEach(([field, fieldValue]) => row.set(field, fieldValue));
    rows.push([row]);
  };

  // Schreibt einsatzabschnittId auf ein Fahrzeug im kraefteubersicht-Doc (Option A,
  // #137). Erlaubt für einsatzabschnitte-Schreiber (S-Rollen+LdS) — die sind Teilmenge
  // der kraefteubersicht-Schreiber, das Gateway lässt den Write also durch.
  const setVehicleEa = (vehicleId: string, abschnittId: string) => {
    const arr = vehiclesRef.current;
    const map = arr?.toArray().find((m) => m.get("id") === vehicleId);
    if (!map) return;
    map.doc?.transact(() => {
      map.set("einsatzabschnittId", abschnittId);
      map.set("updatedAt", new Date().toISOString());
    });
  };

  const assignVehicle = (abschnittId: string) => {
    if (!writable) return;
    const vehicleId = assignSel[abschnittId];
    if (!vehicleId) return;
    setVehicleEa(vehicleId, abschnittId);
    setAssignSel((prev) => ({ ...prev, [abschnittId]: "" }));
  };

  const unassignVehicle = (vehicleId: string) => {
    if (!writable) return;
    setVehicleEa(vehicleId, "");
  };

  const deleteAbschnitt = (a: Einsatzabschnitt) => {
    if (!writable) return;
    const label = `${a.typ} ${a.titel}`.trim() || "(ohne Titel)";
    if (!window.confirm(`Einsatzabschnitt „${label}" löschen?`)) return;
    // Zugeordnete Fahrzeuge freigeben, damit sie nicht auf einen gelöschten
    // Abschnitt zeigen (sonst „stecken" sie unsichtbar fest).
    vehiclesRef.current
      ?.toArray()
      .filter((m) => m.get("einsatzabschnittId") === a.id)
      .forEach((m) =>
        m.doc?.transact(() => {
          m.set("einsatzabschnittId", "");
          m.set("updatedAt", new Date().toISOString());
        }),
      );
    const rows = abschnitteRef.current;
    if (!rows) return;
    const index = rows.toArray().findIndex((m) => m.get("id") === a.id);
    if (index >= 0) rows.delete(index, 1);
  };

  const assignedVehicles = (abschnittId: string): KraftVehicle[] =>
    vehicles.filter((v) => v.status === "einsatz" && v.einsatzabschnittId === abschnittId);

  // Im Einsatz und (noch) keinem Abschnitt zugeordnet → für das Zuordnen-Dropdown.
  const unassignedVehicles = (): KraftVehicle[] =>
    vehicles.filter((v) => v.status === "einsatz" && !v.einsatzabschnittId);

  // Einzeldatei-Export: nur die Abschnitte selbst. Die Fahrzeug-Zuordnung liegt am
  // Fahrzeug (kraefteubersicht-Export) — der Gesamt-Export im Übersicht-Tab hält beide zusammen.
  const exportJson = () => {
    const payload: EinsatzabschnitteExport = {
      format: EA_EXPORT_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      abschnitte,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `einsatzabschnitte-${session.room.joinCode}-${dug()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  // Einzeldatei-Import (Gegenstück): validiert gegen das Envelope-Schema und ersetzt
  // die (geteilten!) Abschnitte in EINER Transaktion. Nur Schreibberechtigte, mit Bestätigung.
  const importJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget; // vor await sichern (React nullt currentTarget)
    const file = input.files?.[0];
    try {
      if (!file) return;
      if (!writable) {
        setImportMessage("Import nicht erlaubt.");
        return;
      }
      const parsed: unknown = JSON.parse(await file.text());
      if (!isRecord(parsed) || parsed.format !== EA_EXPORT_FORMAT) {
        setImportMessage("Import fehlgeschlagen: kein gültiges Einsatzabschnitte-Export-Format.");
        return;
      }
      const rows = parseEinsatzabschnitteExport(parsed, uid);
      const list = abschnitteRef.current;
      if (!rows || !list) {
        setImportMessage("Import fehlgeschlagen.");
        return;
      }
      if (
        !window.confirm(
          "Die aktuellen Einsatzabschnitte werden durch die importierten ersetzt — für alle im Stabsraum. Fortfahren?",
        )
      ) {
        return;
      }
      applyEinsatzabschnitteImport(list, rows, { replace: true });
      setImportMessage(`${rows.length} Einsatzabschnitt${rows.length === 1 ? "" : "e"} importiert.`);
    } catch (err) {
      console.debug("Einsatzabschnitte-Import fehlgeschlagen", err);
      setImportMessage("Import fehlgeschlagen: ungültige JSON-Datei.");
    } finally {
      input.value = "";
    }
  };

  return (
    <div className="einsatzabschnitte">
      <div className="work__bar einsatzabschnitte__bar">
        <h2>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--ea-red)" strokeWidth="2" aria-hidden="true">
            <rect x="9" y="3" width="6" height="5" rx="1" />
            <rect x="3" y="16" width="6" height="5" rx="1" />
            <rect x="15" y="16" width="6" height="5" rx="1" />
            <path d="M12 8v4M6 16v-2h12v2" />
          </svg>
          Einsatzabschnitte
        </h2>
        <span className="chip">
          {abschnitte.length} {abschnitte.length === 1 ? "Abschnitt" : "Abschnitte"}
        </span>
        <span className="chip">Alle Felder werden synchronisiert</span>
        {importMessage && <span className="chip">{importMessage}</span>}
        <div className="spacer" />
        {writable && (
          <button className="tool" type="button" onClick={() => importInputRef.current?.click()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
            </svg>
            Import JSON
          </button>
        )}
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={importJson}
        />
        <button className="tool" type="button" onClick={exportJson}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 15V3M7 8l5-5 5 5M5 21h14" />
          </svg>
          Export JSON
        </button>
        {writable && (
          <button className="btn btn--primary" type="button" onClick={addAbschnitt}>
            + Neuer Einsatzabschnitt
          </button>
        )}
        <span className="chip">{writable ? "Bearbeiten" : "Nur Lesen"}</span>
      </div>

      {abschnitte.length === 0 ? (
        <p className="einsatzabschnitte__empty">
          Noch keine Einsatzabschnitte angelegt.
          {writable ? " Über „+ Neuer Einsatzabschnitt“ den ersten anlegen." : ""}
        </p>
      ) : (
        <div className="ea-grid">
          {abschnitte.map((a) => {
            const assigned = assignedVehicles(a.id);
            const staerke = sumStaerke(assigned);
            return (
              <section className="ea-card" key={a.id} aria-label={`${a.typ} ${a.titel}`}>
                <div className="ea-card__head">
                  <div className="ea-card__badge">
                    <select
                      value={a.typ}
                      disabled={!writable}
                      aria-label="Abschnittstyp"
                      onChange={(e) => setField(a.id, "typ", e.currentTarget.value as EaTyp)}
                    >
                      {EA_TYPEN.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <div className="ea-card__title">
                      <input
                        value={a.titel}
                        readOnly={!writable}
                        aria-label="Titel"
                        onChange={(e) => setField(a.id, "titel", e.currentTarget.value)}
                      />
                    </div>
                    <div className="ea-card__legend">
                      EA – Einsatzabschnitt
                      <br />
                      UA – Unterabschnitt
                    </div>
                  </div>

                  <div className="ea-card__fields">
                    <label className="ea-field">
                      <span>Befehlsstelle</span>
                      <input
                        value={a.befehlsstelle}
                        readOnly={!writable}
                        onChange={(e) => setField(a.id, "befehlsstelle", e.currentTarget.value)}
                      />
                    </label>
                    <label className="ea-field">
                      <span>Leiter</span>
                      <input
                        value={a.leiter}
                        readOnly={!writable}
                        onChange={(e) => setField(a.id, "leiter", e.currentTarget.value)}
                      />
                    </label>
                    <label className="ea-field">
                      <span>Kommunikation</span>
                      <input
                        list="ea-funkkanaele"
                        value={a.kommunikation}
                        readOnly={!writable}
                        onChange={(e) => setField(a.id, "kommunikation", e.currentTarget.value)}
                      />
                    </label>
                    <label className="ea-field">
                      <span>Auftrag</span>
                      <input
                        value={a.auftrag}
                        readOnly={!writable}
                        onChange={(e) => setField(a.id, "auftrag", e.currentTarget.value)}
                      />
                    </label>
                  </div>

                  <div className="ea-card__meta">
                    <div>
                      <div className="ea-meta-label">Einsatzbeginn</div>
                      <input
                        className="ea-dug mono"
                        value={a.einsatzbeginn}
                        readOnly={!writable}
                        aria-label="Einsatzbeginn (DUG)"
                        onChange={(e) => setField(a.id, "einsatzbeginn", e.currentTarget.value)}
                      />
                    </div>
                    <div className="ea-kraefte">
                      <h5>Kräfteübersicht</h5>
                      <div className="row">
                        <span className="k">Mannschaft</span>
                        <span className="v">{formatStaerke(staerke)}</span>
                      </div>
                      <div className="row">
                        <span className="k">Fahrzeuge</span>
                        <span className="v">{assigned.length}</span>
                      </div>
                      <div className="ea-auto">automatisch aus zugeordneten Einheiten</div>
                    </div>
                  </div>
                </div>

                <div className="ea-card__body">
                  <div className="ea-body-head">
                    <span>Zugeordnete Einheiten</span>
                    <span>Stärke (F/U/H//Ges.)</span>
                  </div>
                  {assigned.length === 0 ? (
                    <p className="ea-empty">Noch keine Einheiten zugeordnet</p>
                  ) : (
                    <div className="ea-units">
                      {assigned.map((v) => (
                        <div className="ea-units__row" key={v.id}>
                          <span className="fz">{v.funkrufname || "(ohne Funkrufname)"}</span>
                          <span className="st">{formatStaerke(sumStaerke([v]))}</span>
                          {writable && (
                            <button
                              className="ea-units__rm"
                              type="button"
                              title="Zuordnung entfernen"
                              aria-label={`${v.funkrufname || "Fahrzeug"} aus Abschnitt entfernen`}
                              onClick={() => unassignVehicle(v.id)}
                            >
                              ×
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {writable && (
                    <div className="ea-assign">
                      <select
                        aria-label="Fahrzeug zuordnen"
                        value={assignSel[a.id] ?? ""}
                        onChange={(e) => {
                          // Wert VOR dem State-Updater lesen: React nullt currentTarget,
                          // bevor der (verzögerte) prev-Updater läuft.
                          const vehicleId = e.currentTarget.value;
                          setAssignSel((prev) => ({ ...prev, [a.id]: vehicleId }));
                        }}
                      >
                        <option value="">Fahrzeug wählen … (im Einsatz, noch nicht zugeordnet)</option>
                        {unassignedVehicles().map((v) => (
                          <option key={v.id} value={v.id}>
                            {(v.funkrufname || "(ohne Funkrufname)") + " · " + formatStaerke(sumStaerke([v]))}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!assignSel[a.id]}
                        onClick={() => assignVehicle(a.id)}
                      >
                        Fzg. zuordnen
                      </button>
                    </div>
                  )}
                  {writable && (
                    <button className="ea-del" type="button" onClick={() => deleteAbschnitt(a)}>
                      Abschnitt löschen
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <datalist id="ea-funkkanaele">
        {funkkanaele.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
    </div>
  );
}
