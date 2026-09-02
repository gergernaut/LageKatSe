import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  AB_KANAELE,
  AB_KANAL_FIELDS,
  AB_ORGANISATION,
  buildEaEtbEntry,
  canWrite,
  coerceEinsatzabschnitt,
  coerceFuehrung,
  EA_ABSCHNITTE,
  EA_EXPORT_FORMAT,
  EA_FUEHRUNG,
  EA_FUEHRUNG_AUFTRAEGE,
  EA_LIST_LABELS,
  EA_LISTS,
  EA_TYPEN,
  EMPTY_FUEHRUNG,
  formatStaerke,
  FUEHRUNG_FIELDS,
  FUEHRUNG_LABELS,
  isRecord,
  KRAFT_VEHICLES,
  parseEinsatzabschnitteExport,
  parseFuehrungAuftraegeExport,
  parseFuehrungExport,
  sumStaerke,
  unassignedEinsatzVehicles,
  vehiclesInAbschnitt,
  type AbKanal,
  type EaListItem,
  type EaListKey,
  type EaTyp,
  type Einsatzabschnitt,
  type EinsatzabschnitteExport,
  type Fuehrung,
  type FuehrungField,
  type KraftVehicle,
} from "@lagekatse/shared";
import * as Y from "yjs";
import type { Session } from "../session";
import { api } from "../api";
import { connectModule } from "../sync/provider";
import { uid } from "../uid";
import { dug } from "../dug";
import { abschnittToYMap, applyEinsatzabschnitteImport } from "./applyImport";

function stringValue(map: Y.Map<unknown>, field: string): string {
  const value = map.get(field);
  return typeof value === "string" ? value : "";
}

export function Einsatzabschnitte({ session }: { session: Session }) {
  const [abschnitte, setAbschnitte] = useState<Einsatzabschnitt[]>([]);
  const [fuehrung, setFuehrung] = useState<Fuehrung>(EMPTY_FUEHRUNG);
  const [vehicles, setVehicles] = useState<KraftVehicle[]>([]);
  const [funkkanaele, setFunkkanaele] = useState<string[]>([]);
  // Auswahl im Zuordnen-Dropdown je Abschnitt (abschnittId -> vehicleId);
  // die Führung nutzt denselben Mechanismus unter dem Key EA_FUEHRUNG.
  const [assignSel, setAssignSel] = useState<Record<string, string>>({});
  const [importMessage, setImportMessage] = useState("");
  const [etbSyncMsg, setEtbSyncMsg] = useState("");
  const etbSyncTimerRef = useRef<number | null>(null);
  const abschnitteRef = useRef<Y.Array<Y.Map<unknown>> | null>(null);
  const fuehrungRef = useRef<Y.Map<unknown> | null>(null);
  // Auftrags-Liste der Führung (#177) — {id, text, erledigt} wie EaItemList.
  const [fuehrungAuftraege, setFuehrungAuftraege] = useState<EaListItem[]>([]);
  const vehiclesRef = useRef<Y.Array<Y.Map<unknown>> | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const writable = canWrite(session.roles, "einsatzabschnitte", {
    allowMonitorChat: session.room.settings.allowMonitorChat,
  });

  // Eigenes Modul-Dokument: die Einsatzabschnitte (CRUD) + der Führungs-Singleton (#154).
  useEffect(() => {
    const conn = connectModule(session.room.id, "einsatzabschnitte", session.token);
    const abschnitte = conn.doc.getArray<Y.Map<unknown>>(EA_ABSCHNITTE);
    const fuehrungMap = conn.doc.getMap<unknown>(EA_FUEHRUNG);
    abschnitteRef.current = abschnitte;
    fuehrungRef.current = fuehrungMap;
    const refresh = () => {
      // coerce statt roher toJSON-Cast: ältere Abschnitte ohne die Listen-Felder
      // (#161) bekommen so sichere Defaults (leere Listen).
      setAbschnitte(abschnitte.toArray().map((m) => coerceEinsatzabschnitt(m.toJSON(), () => "")));
      setFuehrung(coerceFuehrung(fuehrungMap.toJSON()));
      // Auftrags-Liste der Führung (#177): verschachtelte Y.Array — fehlend → [].
      const fuList = fuehrungMap.get(EA_FUEHRUNG_AUFTRAEGE);
      setFuehrungAuftraege(
        fuList instanceof Y.Array ? (fuList.toJSON() as EaListItem[]) : [],
      );
    };
    abschnitte.observeDeep(refresh);
    fuehrungMap.observeDeep(refresh);
    refresh();
    return () => {
      abschnitte.unobserveDeep(refresh);
      fuehrungMap.unobserveDeep(refresh);
      abschnitteRef.current = null;
      fuehrungRef.current = null;
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

  const setFuehrungField = (field: FuehrungField, value: string) => {
    if (!writable) return;
    fuehrungRef.current?.set(field, value);
  };

  // Auftrags-Liste der Führung (#177): verschachtelte Y.Array unter
  // EA_FUEHRUNG_AUFTRAEGE an der Fuehrung-Y.Map (item-level Merge, wie #161).
  const fuehrungListArray = (): Y.Array<Y.Map<unknown>> | null => {
    const map = fuehrungRef.current;
    if (!map) return null;
    const existing = map.get(EA_FUEHRUNG_AUFTRAEGE);
    if (existing instanceof Y.Array) return existing as Y.Array<Y.Map<unknown>>;
    const arr = new Y.Array<Y.Map<unknown>>();
    map.set(EA_FUEHRUNG_AUFTRAEGE, arr);
    return arr;
  };

  const addFuehrungAuftrag = (text: string) => {
    if (!writable) return;
    const t = text.trim();
    if (!t) return;
    const arr = fuehrungListArray();
    if (!arr) return;
    const item = new Y.Map<unknown>();
    item.set("id", uid());
    item.set("text", t);
    item.set("erledigt", false);
    item.set("createdAt", new Date().toISOString()); // Zeitstempel bei Anlage (#180)
    arr.push([item]);
  };

  const toggleFuehrungAuftrag = (itemId: string) => {
    if (!writable) return;
    const item = fuehrungListArray()?.toArray().find((m) => m.get("id") === itemId);
    if (item) item.set("erledigt", item.get("erledigt") !== true);
  };

  const toggleFuehrungAuftragUebermittelt = (itemId: string) => {
    if (!writable) return;
    const item = fuehrungListArray()?.toArray().find((m) => m.get("id") === itemId);
    if (item) item.set("uebermittelt", item.get("uebermittelt") !== true);
  };

  const setFuehrungAuftragText = (itemId: string, text: string) => {
    if (!writable) return;
    const item = fuehrungListArray()?.toArray().find((m) => m.get("id") === itemId);
    item?.set("text", text);
  };

  const deleteFuehrungAuftrag = (itemId: string) => {
    if (!writable) return;
    const arr = fuehrungListArray();
    if (!arr) return;
    const index = arr.toArray().findIndex((m) => m.get("id") === itemId);
    if (index >= 0) arr.delete(index, 1);
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
      auftraege: [],
      rueckmeldungen: [],
      anforderungen: [],
    };
    // Builder legt die drei Listen als verschachtelte Y.Array<Y.Map> an (#161).
    rows.push([abschnittToYMap(value)]);
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

  // Listen-Operationen (#161): die drei Listen liegen als verschachtelte
  // Y.Array<Y.Map> je Abschnitt — alle Mutationen über diese Handles (Feld-Merge).
  const listArray = (abschnittId: string, key: EaListKey): Y.Array<Y.Map<unknown>> | null => {
    const row = abschnitteRef.current?.toArray().find((m) => m.get("id") === abschnittId);
    if (!row) return null;
    const existing = row.get(key);
    if (existing instanceof Y.Array) return existing as Y.Array<Y.Map<unknown>>;
    // Älterer Abschnitt ohne diese Liste: einmalig anlegen.
    const arr = new Y.Array<Y.Map<unknown>>();
    row.set(key, arr);
    return arr;
  };

  const addItem = (abschnittId: string, key: EaListKey, text: string) => {
    if (!writable) return;
    const t = text.trim();
    if (!t) return;
    const arr = listArray(abschnittId, key);
    if (!arr) return;
    const item = new Y.Map<unknown>();
    item.set("id", uid());
    item.set("text", t);
    item.set("erledigt", false);
    item.set("createdAt", new Date().toISOString()); // Zeitstempel bei Anlage (#180)
    arr.push([item]);
  };

  const toggleItem = (abschnittId: string, key: EaListKey, itemId: string) => {
    if (!writable) return;
    const item = listArray(abschnittId, key)?.toArray().find((m) => m.get("id") === itemId);
    if (item) item.set("erledigt", item.get("erledigt") !== true);
  };

  // „Übermittelt"-Haken (#180) — nur für Aufträge; unabhängig von „erledigt".
  const toggleItemUebermittelt = (abschnittId: string, key: EaListKey, itemId: string) => {
    if (!writable) return;
    const item = listArray(abschnittId, key)?.toArray().find((m) => m.get("id") === itemId);
    if (item) item.set("uebermittelt", item.get("uebermittelt") !== true);
  };

  const setItemText = (abschnittId: string, key: EaListKey, itemId: string, text: string) => {
    if (!writable) return;
    const item = listArray(abschnittId, key)?.toArray().find((m) => m.get("id") === itemId);
    item?.set("text", text);
  };

  const deleteItem = (abschnittId: string, key: EaListKey, itemId: string) => {
    if (!writable) return;
    const arr = listArray(abschnittId, key);
    if (!arr) return;
    const index = arr.toArray().findIndex((m) => m.get("id") === itemId);
    if (index >= 0) arr.delete(index, 1);
  };

  // ETB-Sync (#162): eine Rückmeldung/Anforderung server-autoritativ ins ETB
  // übernehmen (Invariante #6, bestehender Endpoint; EA-Schreiber haben etb-Recht).
  // One-way push — ein Klick = ein ETB-Eintrag „EA X · Rückmeldung: …".
  // Kurze Bestätigung, die nach ein paar Sekunden von selbst verschwindet.
  const flashEtbMsg = (msg: string) => {
    setEtbSyncMsg(msg);
    if (etbSyncTimerRef.current) clearTimeout(etbSyncTimerRef.current);
    etbSyncTimerRef.current = window.setTimeout(() => setEtbSyncMsg(""), 4000);
  };

  const syncItemToEtb = async (a: Einsatzabschnitt, key: EaListKey, item: EaListItem) => {
    if (!writable) return;
    const text = item.text.trim();
    if (!text) return;
    try {
      await api.createEtbEntry(session.room.joinCode, session.token, buildEaEtbEntry(a, key, text));
      flashEtbMsg(`„${text.slice(0, 40)}“ ins ETB übernommen`);
    } catch (err) {
      console.debug("ETB-Übernahme fehlgeschlagen", err);
      flashEtbMsg("ETB-Übernahme fehlgeschlagen.");
    }
  };

  // Auto-Clear-Timer beim Unmount aufräumen.
  useEffect(() => () => {
    if (etbSyncTimerRef.current) clearTimeout(etbSyncTimerRef.current);
  }, []);

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

  // Geteilte, getestete Primitive (#141) — gleiche Ableitung wie Feld C der Übersicht.
  const assignedVehicles = (abschnittId: string): KraftVehicle[] =>
    vehiclesInAbschnitt(vehicles, abschnittId);

  // Im Einsatz und (noch) keinem Abschnitt zugeordnet → für das Zuordnen-Dropdown.
  const unassignedVehicles = (): KraftVehicle[] => unassignedEinsatzVehicles(vehicles);

  // Einzeldatei-Export: nur die Abschnitte selbst. Die Fahrzeug-Zuordnung liegt am
  // Fahrzeug (kraefteubersicht-Export) — der Gesamt-Export im Übersicht-Tab hält beide zusammen.
  const exportJson = () => {
    const payload: EinsatzabschnitteExport = {
      format: EA_EXPORT_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      abschnitte,
      fuehrung,
      fuehrungAuftraege,
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
      applyEinsatzabschnitteImport(
        list,
        rows,
        {
          replace: true,
          fuehrung: parseFuehrungExport(parsed),
          fuehrungAuftraege: parseFuehrungAuftraegeExport(parsed, uid),
        },
      );
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
        {etbSyncMsg && <span className="chip">{etbSyncMsg}</span>}
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

      {(() => {
        const fuAssigned = assignedVehicles(EA_FUEHRUNG);
        return (
          <section className="ea-fuehrung" aria-label="Führung">
            <div className="ea-fuehrung__head">
              <span className="ea-fuehrung__badge">Führung</span>
              <span className="ea-fuehrung__hint">Eigene Führungsstelle &amp; Führungsmittel</span>
              <span className="ea-fuehrung__staerke mono">
                {formatStaerke(sumStaerke(fuAssigned))} · {fuAssigned.length} Fz.
              </span>
            </div>
            <div className="ea-fuehrung__fields">
              {FUEHRUNG_FIELDS.map((f) => (
                <label className="ea-field" key={f}>
                  <span>{FUEHRUNG_LABELS[f]}</span>
                  <input
                    {...(f === "kommunikation" ? { list: "ea-funkkanaele" } : {})}
                    value={fuehrung[f]}
                    readOnly={!writable}
                    onChange={(e) => setFuehrungField(f, e.currentTarget.value)}
                  />
                </label>
              ))}
            </div>
            <div className="ea-fuehrung__units">
              <div className="ea-body-head">
                <span>Führungsmittel</span>
                <span>Stärke (F/U/H//Ges.)</span>
              </div>
              {fuAssigned.length === 0 ? (
                <p className="ea-empty">Noch kein Führungsmittel zugeordnet</p>
              ) : (
                <div className="ea-units">
                  {fuAssigned.map((v) => (
                    <div className="ea-units__row" key={v.id}>
                      <span className="fz">{v.funkrufname || "(ohne Funkrufname)"}</span>
                      <span className="st">{formatStaerke(sumStaerke([v]))}</span>
                      {writable && (
                        <button
                          className="ea-units__rm"
                          type="button"
                          title="Zuordnung entfernen"
                          aria-label={`${v.funkrufname || "Fahrzeug"} aus der Führung entfernen`}
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
                    aria-label="Führungsmittel zuordnen"
                    value={assignSel[EA_FUEHRUNG] ?? ""}
                    onChange={(e) => {
                      const vehicleId = e.currentTarget.value;
                      setAssignSel((prev) => ({ ...prev, [EA_FUEHRUNG]: vehicleId }));
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
                    disabled={!assignSel[EA_FUEHRUNG]}
                    onClick={() => assignVehicle(EA_FUEHRUNG)}
                  >
                    Fzg. zuordnen
                  </button>
                </div>
              )}
            </div>
            {/* Aufträge der Führung (#177): abhakbar, wie die Listen je Abschnitt.
                Kein ETB-Sync — Aufträge werden nicht ins ETB übernommen (#162-Muster). */}
            <EaItemList
              label="Aufträge"
              items={fuehrungAuftraege}
              writable={writable}
              onAdd={addFuehrungAuftrag}
              onToggle={toggleFuehrungAuftrag}
              onSetText={setFuehrungAuftragText}
              onDelete={deleteFuehrungAuftrag}
              showUebermittelt
              onToggleUebermittelt={toggleFuehrungAuftragUebermittelt}
            />
          </section>
        );
      })()}

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
                  <div className="ea-lists">
                    {EA_LISTS.map((key) => (
                      <EaItemList
                        key={key}
                        label={EA_LIST_LABELS[key]}
                        items={a[key]}
                        writable={writable}
                        onAdd={(text) => addItem(a.id, key, text)}
                        onToggle={(itemId) => toggleItem(a.id, key, itemId)}
                        onSetText={(itemId, text) => setItemText(a.id, key, itemId, text)}
                        onDelete={(itemId) => deleteItem(a.id, key, itemId)}
                        // ETB-Sync nur für Rückmeldungen + Anforderungen (#162).
                        onSyncEtb={
                          key === "auftraege"
                            ? undefined
                            : (item) => void syncItemToEtb(a, key, item)
                        }
                        // „Übermittelt"-Haken nur für Aufträge (#180).
                        showUebermittelt={key === "auftraege"}
                        onToggleUebermittelt={(itemId) => toggleItemUebermittelt(a.id, key, itemId)}
                      />
                    ))}
                  </div>

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

/**
 * Eine ausklappbare, abhakbare Liste (#161). Ausklapp-Zustand + Entwurfstext sind
 * client-lokal (React-State, kein CRDT) — der Zustand überlebt CRDT-Updates, weil
 * React die Instanz per key (Listen-Key) reconcilet.
 */
/** Uhrzeit (HH:MM, lokal) des Anlage-Zeitstempels einer Listen-Zeile (#180). */
function formatItemTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** Mehrzeiliges, automatisch mitwachsendes Eingabefeld — damit lange Einträge
 *  umbrechen und vollständig sichtbar bleiben (#180) statt seitlich abzuschneiden. */
function AutoTextarea({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = () => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  };
  // Höhe an den Inhalt anpassen — bei Textänderung UND bei Breitenänderung
  // (Fensterresize / Layoutwechsel), sonst bliebe eine umgebrochene Zeile verdeckt.
  useEffect(resize, [value]);
  useEffect(() => {
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  return (
    <textarea
      ref={ref}
      className="ea-list__text"
      rows={1}
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.currentTarget.value)}
    />
  );
}

function EaItemList({
  label,
  items,
  writable,
  onAdd,
  onToggle,
  onSetText,
  onDelete,
  onSyncEtb,
  showUebermittelt = false,
  onToggleUebermittelt,
}: {
  label: string;
  items: EaListItem[];
  writable: boolean;
  onAdd: (text: string) => void;
  onToggle: (id: string) => void;
  onSetText: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  // Optional: „→ ETB"-Button je Eintrag (nur Rückmeldungen/Anforderungen, #162).
  onSyncEtb?: (item: EaListItem) => void;
  // „Übermittelt"-Haken (#180) — nur bei Aufträgen; kennzeichnet „an den Abschnitt gesendet".
  showUebermittelt?: boolean;
  onToggleUebermittelt?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const offen = items.filter((i) => !i.erledigt).length;
  const submit = () => {
    onAdd(draft);
    setDraft("");
  };
  return (
    <section className="ea-list">
      <button
        type="button"
        className="ea-list__toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="ea-list__chevron" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
        <span className="ea-list__label">{label}</span>
        <span className="ea-list__count">
          {items.length === 0 ? "leer" : `${offen} offen / ${items.length}`}
        </span>
      </button>
      {expanded && (
        <div className="ea-list__body">
          {items.length === 0 ? (
            <p className="ea-empty">Noch keine Einträge</p>
          ) : (
            <ul className="ea-list__items">
              {items.map((item) => (
                <li className={`ea-list__item ${item.erledigt ? "ea-list__item--done" : ""}`} key={item.id}>
                  <input
                    type="checkbox"
                    checked={item.erledigt}
                    disabled={!writable}
                    aria-label="erledigt"
                    onChange={() => onToggle(item.id)}
                  />
                  <div className="ea-list__main">
                    {writable ? (
                      <AutoTextarea
                        value={item.text}
                        ariaLabel="Eintragstext"
                        onChange={(value) => onSetText(item.id, value)}
                      />
                    ) : (
                      <span className="ea-list__text ea-list__text--ro">{item.text}</span>
                    )}
                    {(item.createdAt || showUebermittelt) && (
                      <div className="ea-list__meta">
                        {item.createdAt && (
                          <time className="ea-list__time" dateTime={item.createdAt}>
                            {formatItemTime(item.createdAt)}
                          </time>
                        )}
                        {showUebermittelt && onToggleUebermittelt && (
                          <label
                            className={`ea-list__sent ${item.uebermittelt ? "is-on" : ""}`}
                            title="An den Abschnitt übermittelt (unabhängig vom Erledigt-Haken)"
                          >
                            <input
                              type="checkbox"
                              checked={item.uebermittelt === true}
                              disabled={!writable}
                              aria-label="übermittelt"
                              onChange={() => onToggleUebermittelt(item.id)}
                            />
                            <span>übermittelt</span>
                          </label>
                        )}
                      </div>
                    )}
                  </div>
                  {writable && onSyncEtb && (
                    <button
                      type="button"
                      className="ea-list__etb"
                      title="Ins Einsatztagebuch übernehmen"
                      aria-label="Ins Einsatztagebuch übernehmen"
                      disabled={!item.text.trim()}
                      onClick={() => onSyncEtb(item)}
                    >
                      → ETB
                    </button>
                  )}
                  {writable && (
                    <button
                      type="button"
                      className="ea-list__rm"
                      title="Eintrag löschen"
                      aria-label="Eintrag löschen"
                      onClick={() => onDelete(item.id)}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {writable && (
            <form
              className="ea-list__add"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <input
                value={draft}
                placeholder="Eintrag hinzufügen …"
                aria-label={`${label}: Eintrag hinzufügen`}
                onChange={(e) => setDraft(e.currentTarget.value)}
              />
              <button type="submit" disabled={!draft.trim()}>
                +
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
