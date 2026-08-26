import { useEffect, useRef, useState } from "react";
import {
  AB_KANAELE,
  AB_KANAL_FIELDS,
  AB_ORGANISATION,
  canWrite,
  EA_ABSCHNITTE,
  EA_TYPEN,
  formatStaerke,
  KRAFT_VEHICLES,
  sumStaerke,
  type AbKanal,
  type EaTyp,
  type Einsatzabschnitt,
  type KraftVehicle,
} from "@lagekatse/shared";
import * as Y from "yjs";
import type { Session } from "../session";
import { connectModule } from "../sync/provider";
import { uid } from "../uid";
import { dug } from "../dug";

function stringValue(map: Y.Map<unknown>, field: string): string {
  const value = map.get(field);
  return typeof value === "string" ? value : "";
}

export function Einsatzabschnitte({ session }: { session: Session }) {
  const [abschnitte, setAbschnitte] = useState<Einsatzabschnitt[]>([]);
  const [vehicles, setVehicles] = useState<KraftVehicle[]>([]);
  const [funkkanaele, setFunkkanaele] = useState<string[]>([]);
  const abschnitteRef = useRef<Y.Array<Y.Map<unknown>> | null>(null);
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
    const refresh = () => setVehicles(list.toArray().map((v) => v.toJSON() as KraftVehicle));
    list.observeDeep(refresh);
    refresh();
    return () => {
      list.unobserveDeep(refresh);
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

  const deleteAbschnitt = (a: Einsatzabschnitt) => {
    if (!writable) return;
    const label = `${a.typ} ${a.titel}`.trim() || "(ohne Titel)";
    if (!window.confirm(`Einsatzabschnitt „${label}" löschen?`)) return;
    const rows = abschnitteRef.current;
    if (!rows) return;
    const index = rows.toArray().findIndex((m) => m.get("id") === a.id);
    if (index >= 0) rows.delete(index, 1);
  };

  const assignedVehicles = (abschnittId: string): KraftVehicle[] =>
    vehicles.filter((v) => v.status === "einsatz" && v.einsatzabschnittId === abschnittId);

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
        <div className="spacer" />
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
                        </div>
                      ))}
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
