import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  AB_AUFTRAEGE,
  AB_EXPORT_FORMAT,
  AB_EXPORT_VERSION,
  AB_KANAELE,
  AB_KANAL_FIELDS,
  AB_KANAL_LABELS,
  AB_KANAL_TYPEN,
  AB_KOPF,
  AB_KOPF_FIELDS,
  AB_KOPF_LABELS,
  AB_ORGANISATION,
  AB_RUECKMELD,
  AB_WETTER,
  AB_WETTER_SNAPSHOT,
  canWrite,
  EA_ABSCHNITTE,
  formatAbschnittTitel,
  vehiclesInAbschnitt,
  formatStaerke,
  isRecord,
  KRAFT_VEHICLES,
  sumStaerke,
  type AbAuftrag,
  type AbKanal,
  type AbKanalField,
  type AbKanalTyp,
  type AbKopfField,
  type AbNotiz,
  type AbWetterSnapshot,
  type Arbeitsblatt as ArbeitsblattState,
  type ArbeitsblattExport,
  type Einsatzabschnitt,
  type KraftVehicle,
  type Staerke,
} from "@lagekatse/shared";
import * as Y from "yjs";
import { api } from "../api";
import { Lagekarte } from "../lagekarte/Lagekarte";
import type { Session } from "../session";
import { connectModule } from "../sync/provider";
import { uid } from "../uid";
import { dug } from "../dug";
import { Wetter } from "./Wetter";
import { applyArbeitsblattImport } from "./applyImport";

const EMPTY_SHEET: ArbeitsblattState = {
  kopf: {
    einsatzstichwort: "",
    einsatzort: "",
    meldender: "",
    objektnr: "",
    datumUhrzeitgruppe: "",
  },
  auftraege: [],
  rueckmeldungen: [],
  organisation: {
    tmoGruppe: "",
    fuehrungsKanal: "",
    dmoGruppe: "",
    gebFunk: "",
  },
  kanaele: [],
  wetter: null,
};

/** Abgeleitete Kräfte-Kennzahlen (Feld C) — read-only aus dem kraefteubersicht-Modul. */
interface KraftKennzahlen {
  einsatz: Staerke; // Gesamtstärke der im Einsatz befindlichen Einheiten (DV 100)
  brCount: number; // Anzahl Fahrzeuge im Bereitstellungsraum
}

function stringValue(map: Y.Map<unknown>, field: string): string {
  const value = map.get(field);
  return typeof value === "string" ? value : "";
}

function booleanValue(map: Y.Map<unknown>, field: string): boolean {
  const value = map.get(field);
  return typeof value === "boolean" ? value : false;
}

export function Arbeitsblatt({ session }: { session: Session }) {
  const [sheet, setSheet] = useState<ArbeitsblattState>(EMPTY_SHEET);
  // Feld C wird komplett aus diesen beiden read-only Cross-Reads abgeleitet:
  const [vehicles, setVehicles] = useState<KraftVehicle[]>([]);
  const [abschnitte, setAbschnitte] = useState<Einsatzabschnitt[]>([]);
  const [importMessage, setImportMessage] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const kopfRef = useRef<Y.Map<unknown> | null>(null);
  const auftraegeRef = useRef<Y.Array<Y.Map<unknown>> | null>(null);
  const rueckmeldRef = useRef<Y.Array<Y.Map<unknown>> | null>(null);
  const organisationRef = useRef<Y.Map<unknown> | null>(null);
  const kanaeleRef = useRef<Y.Array<Y.Map<unknown>> | null>(null);
  const wetterRef = useRef<Y.Map<unknown> | null>(null);
  const writable = canWrite(session.roles, "arbeitsblatt", {
    allowMonitorChat: session.room.settings.allowMonitorChat,
  });

  // Feld C komplett abgeleitet (read-only) aus den beiden Cross-Reads:
  const einsatzVehicles = vehicles.filter((v) => v.status === "einsatz");
  const kraft: KraftKennzahlen = {
    einsatz: sumStaerke(einsatzVehicles),
    brCount: vehicles.filter((v) => v.status === "br").length,
  };
  // Stärke + Fahrzeug-Anzahl je Abschnitt (geteiltes, getestetes Primitiv, #141).
  const abschnittKraft = (id: string) => {
    const assigned = vehiclesInAbschnitt(vehicles, id);
    return { staerke: sumStaerke(assigned), count: assigned.length };
  };

  useEffect(() => {
    const conn = connectModule(session.room.id, "arbeitsblatt", session.token);
    const { doc } = conn;
    const kopf = doc.getMap<unknown>(AB_KOPF);
    const auftraege = doc.getArray<Y.Map<unknown>>(AB_AUFTRAEGE);
    const rueckmeld = doc.getArray<Y.Map<unknown>>(AB_RUECKMELD);
    const organisation = doc.getMap<unknown>(AB_ORGANISATION);
    const kanaele = doc.getArray<Y.Map<unknown>>(AB_KANAELE);
    const wetter = doc.getMap<unknown>(AB_WETTER);

    kopfRef.current = kopf;
    auftraegeRef.current = auftraege;
    rueckmeldRef.current = rueckmeld;
    organisationRef.current = organisation;
    kanaeleRef.current = kanaele;
    wetterRef.current = wetter;

    const readSheet = (): ArbeitsblattState => ({
      kopf: {
        einsatzstichwort: stringValue(kopf, "einsatzstichwort"),
        einsatzort: stringValue(kopf, "einsatzort"),
        meldender: stringValue(kopf, "meldender"),
        objektnr: stringValue(kopf, "objektnr"),
        datumUhrzeitgruppe: stringValue(kopf, "datumUhrzeitgruppe"),
      },
      auftraege: auftraege.toArray().map((row) => row.toJSON() as AbAuftrag),
      rueckmeldungen: rueckmeld.toArray().map((note) => note.toJSON() as AbNotiz),
      organisation: {
        tmoGruppe: stringValue(organisation, "tmoGruppe"),
        fuehrungsKanal: stringValue(organisation, "fuehrungsKanal"),
        dmoGruppe: stringValue(organisation, "dmoGruppe"),
        gebFunk: stringValue(organisation, "gebFunk"),
      },
      kanaele: kanaele.toArray().map((row) => row.toJSON() as AbKanal),
      wetter: (wetter.get(AB_WETTER_SNAPSHOT) as AbWetterSnapshot | undefined) ?? null,
    });

    const refresh = () => setSheet(readSheet());
    doc.on("update", refresh);
    refresh();

    // DUG-Vorbelegung mit der taktischen Zeit der Raum-Öffnung (Feld A). Erst NACH
    // dem ersten Server-Sync (Cache + remote gemergt), damit wir keinen bereits
    // gesetzten/bearbeiteten Wert überschreiben; nur wenn leer und schreibberechtigt.
    // dug() = DDHHMMmmmyy (dug.ts), gleiche Notation wie in den Export-Dateinamen.
    const prefillDug = (isSynced: boolean) => {
      if (!isSynced || !writable) return;
      if (stringValue(kopf, "datumUhrzeitgruppe")) return;
      const created = session.room.createdAt ? new Date(session.room.createdAt) : new Date();
      kopf.set("datumUhrzeitgruppe", dug(created));
    };
    conn.provider.on("sync", prefillDug);

    return () => {
      doc.off("update", refresh);
      conn.provider.off("sync", prefillDug);
      kopfRef.current = null;
      auftraegeRef.current = null;
      rueckmeldRef.current = null;
      organisationRef.current = null;
      kanaeleRef.current = null;
      wetterRef.current = null;
      conn.destroy();
    };
  }, [session.room.id, session.token, session.room.createdAt, writable]);

  // Feld C — read-only Cross-Read des kraefteubersicht-Moduls: die rohen Fahrzeuge
  // (daraus werden Gesamtstärke, BR-Anzahl UND die Stärke je Abschnitt abgeleitet).
  // Kein Schreibpfad, kein eigener persistierter Zustand.
  useEffect(() => {
    const conn = connectModule(session.room.id, "kraefteubersicht", session.token);
    const vehicles = conn.doc.getArray<Y.Map<unknown>>(KRAFT_VEHICLES);
    const refresh = () => setVehicles(vehicles.toArray().map((v) => v.toJSON() as KraftVehicle));
    vehicles.observeDeep(refresh);
    refresh();
    return () => {
      vehicles.unobserveDeep(refresh);
      conn.destroy();
    };
  }, [session.room.id, session.token]);

  // Feld C — read-only Cross-Read der Einsatzabschnitte (#138): Liste unter der
  // Gesamtstärke, Stärke je Abschnitt aus den zugeordneten Fahrzeugen abgeleitet.
  useEffect(() => {
    const conn = connectModule(session.room.id, "einsatzabschnitte", session.token);
    const list = conn.doc.getArray<Y.Map<unknown>>(EA_ABSCHNITTE);
    const refresh = () => setAbschnitte(list.toArray().map((m) => m.toJSON() as Einsatzabschnitt));
    list.observeDeep(refresh);
    refresh();
    return () => {
      list.unobserveDeep(refresh);
      conn.destroy();
    };
  }, [session.room.id, session.token]);

  const setKopf = (field: AbKopfField, value: string) => {
    if (!writable) return;
    kopfRef.current?.set(field, value);
  };

  // Wetter-Snapshot als atomarer Whole-Value-Posten schreiben (Invariante #1):
  // ein Key ⇒ konkurrierende Abrufe settlen per LWW, nie gemischte Teilstände.
  const setWetter = (snapshot: AbWetterSnapshot) => {
    if (!writable) return;
    wetterRef.current?.set(AB_WETTER_SNAPSHOT, snapshot);
  };

  // "Aktuelle Wetterdaten ins ETB": server-autoritativer Eintrag (Invariante #6);
  // der Server vergibt lfdNr/zeit/bearbeiter, wir liefern nur den Inhalt.
  const writeWetterEtb = async (inhalt: string) => {
    if (!writable) return;
    await api.createEtbEntry(session.room.joinCode, session.token, {
      inhalt,
      von: "DWD/BrightSky",
    });
  };

  const setAuftragField = (
    id: string,
    field: keyof Omit<AbAuftrag, "id">,
    value: unknown,
  ) => {
    if (!writable) return;
    const row = auftraegeRef.current?.toArray().find((item) => item.get("id") === id);
    row?.set(field, value);
  };

  const addAuftrag = () => {
    if (!writable) return;
    const rows = auftraegeRef.current;
    if (!rows) return;
    const value: AbAuftrag = {
      id: uid(),
      auftrag: "",
      massnahmen: "",
      laufenderVorgang: false,
      erledigt: false,
    };
    const row = new Y.Map<unknown>();
    Object.entries(value).forEach(([field, fieldValue]) => row.set(field, fieldValue));
    rows.push([row]);
  };

  const deleteAuftrag = (id: string) => {
    if (!writable) return;
    const rows = auftraegeRef.current;
    if (!rows) return;
    const index = rows.toArray().findIndex((row) => row.get("id") === id);
    if (index >= 0) rows.delete(index, 1);
  };

  const setRueckmeldungField = (
    id: string,
    field: keyof Omit<AbNotiz, "id">,
    value: unknown,
  ) => {
    if (!writable) return;
    const row = rueckmeldRef.current?.toArray().find((item) => item.get("id") === id);
    row?.set(field, value);
  };

  const addRueckmeldung = () => {
    if (!writable) return;
    const rows = rueckmeldRef.current;
    if (!rows) return;
    const value: AbNotiz = { id: uid(), text: "", erledigt: false };
    const row = new Y.Map<unknown>();
    Object.entries(value).forEach(([field, fieldValue]) => row.set(field, fieldValue));
    rows.push([row]);
  };

  const deleteRueckmeldung = (id: string) => {
    if (!writable) return;
    const rows = rueckmeldRef.current;
    if (!rows) return;
    const index = rows.toArray().findIndex((row) => row.get("id") === id);
    if (index >= 0) rows.delete(index, 1);
  };

  const setOrganisation = (field: AbKanalField, value: string) => {
    if (!writable) return;
    organisationRef.current?.set(field, value);
  };

  const setKanalField = (id: string, field: keyof Omit<AbKanal, "id">, value: unknown) => {
    if (!writable) return;
    const row = kanaeleRef.current?.toArray().find((item) => item.get("id") === id);
    row?.set(field, value);
  };

  const addKanal = () => {
    if (!writable) return;
    const rows = kanaeleRef.current;
    if (!rows) return;
    const value: AbKanal = { id: uid(), typ: "TMO", gruppe: "", verwendungszweck: "" };
    const row = new Y.Map<unknown>();
    Object.entries(value).forEach(([field, fieldValue]) => row.set(field, fieldValue));
    rows.push([row]);
  };

  const deleteKanal = (id: string) => {
    if (!writable) return;
    const rows = kanaeleRef.current;
    if (!rows) return;
    const index = rows.toArray().findIndex((row) => row.get("id") === id);
    if (index >= 0) rows.delete(index, 1);
  };

  const exportJson = () => {
    const payload: ArbeitsblattExport = {
      format: AB_EXPORT_FORMAT,
      version: AB_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      sheet,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `taktische-uebersicht-${session.room.joinCode}-${dug()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  // PDF-Export (client-seitig). pdf-lib wird erst beim Klick dynamisch geladen
  // (eigener ~1 MB-Chunk), hält den Übersicht-Modul-Chunk klein.
  const exportPdf = async () => {
    if (pdfBusy) return;
    setPdfBusy(true);
    setImportMessage("");
    try {
      const { arbeitsblattToPdf } = await import("../pdf");
      // Feld C · Einsatzabschnitte identisch zur Bildschirm-Liste ableiten (#140).
      const abschnittZeilen = abschnitte.map((a) => {
        const k = abschnittKraft(a.id);
        return { titel: formatAbschnittTitel(a), auftrag: a.auftrag, staerke: k.staerke, count: k.count };
      });
      const bytes = await arbeitsblattToPdf(sheet, kraft, abschnittZeilen, {
        roomName: session.room.name,
        joinCode: session.room.joinCode,
        stamp: dug(),
      });
      // Kopie mit definitem ArrayBuffer (pdf-libs Uint8Array<ArrayBufferLike>).
      const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `taktische-uebersicht-${session.room.joinCode}-${dug()}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      console.debug("Übersicht-PDF-Export fehlgeschlagen", cause);
      setImportMessage("PDF-Export fehlgeschlagen.");
    } finally {
      setPdfBusy(false);
    }
  };

  // JSON-Import (Gegenstück zum Export). Validiert die Datei gegen das
  // ArbeitsblattExport-Schema und spielt sie als EINE doc.transact() ein — ein
  // atomarer Import, ein Sync-Update, saubere Undo-Grenze. Ersetzt die gesamte
  // (geteilte!) Übersicht, daher vorher window.confirm. Nur Schreibberechtigte.
  const importJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget; // vor dem await sichern (React nullt currentTarget)
    const file = input.files?.[0];
    try {
      if (!file) return;
      if (!writable) {
        setImportMessage("Import nicht erlaubt.");
        return;
      }
      const parsed: unknown = JSON.parse(await file.text());
      if (!isRecord(parsed) || parsed.format !== AB_EXPORT_FORMAT || !isRecord(parsed.sheet)) {
        setImportMessage("Import fehlgeschlagen: kein gültiges Übersicht-Export-Format.");
        return;
      }
      if (parsed.version !== AB_EXPORT_VERSION) {
        setImportMessage(
          `Import fehlgeschlagen: inkompatible Version (erwartet ${AB_EXPORT_VERSION}). Alte Arbeitsblatt-Exporte werden nicht unterstützt.`,
        );
        return;
      }
      const doc = kopfRef.current?.doc;
      if (!doc) {
        setImportMessage("Import fehlgeschlagen: Übersicht noch nicht bereit.");
        return;
      }
      if (
        !window.confirm(
          "Die aktuelle Taktische Übersicht wird durch die importierten Daten ersetzt — für alle im Stabsraum. Fortfahren?",
        )
      ) {
        return;
      }

      // Eine atomare Transaktion, geteilt mit dem Bundle-Import (importAll.ts).
      applyArbeitsblattImport(doc, parsed.sheet, uid);

      setImportMessage("Taktische Übersicht importiert.");
    } catch (err) {
      console.debug("Übersicht-Import fehlgeschlagen", err);
      setImportMessage("Import fehlgeschlagen: ungültige JSON-Datei.");
    } finally {
      input.value = "";
    }
  };

  return (
    <div className="arbeitsblatt">
      <div className="work__bar arbeitsblatt__bar">
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
            <rect x="5" y="4" width="14" height="17" rx="2" />
            <path d="M9 4V2.5h6V4M8 10h8M8 14h5" />
          </svg>
          Taktische Übersicht
        </h2>
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
        <button className="tool" type="button" onClick={exportPdf} disabled={pdfBusy}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 2h9l5 5v15H6zM14 2v6h6" />
          </svg>
          {pdfBusy ? "Erzeuge…" : "Export PDF"}
        </button>
        <span className="chip">{writable ? "Bearbeiten" : "Nur Lesen"}</span>
      </div>

      <section className="arbeitsblatt-panel" aria-labelledby="arbeitsblatt-kopf-title">
        <div className="arbeitsblatt-panel__head">
          <h3 id="arbeitsblatt-kopf-title">
            <span className="arbeitsblatt-panel__letter">A</span>
            <span aria-hidden="true">·</span> Kopfzeile
          </h3>
        </div>
        <div className="arbeitsblatt-fields">
          {AB_KOPF_FIELDS.map((field) => (
            <label className="arbeitsblatt-field" key={field}>
              <span>{AB_KOPF_LABELS[field]}</span>
              <input
                type="text"
                value={sheet.kopf[field]}
                readOnly={!writable}
                onChange={(event) => setKopf(field, event.currentTarget.value)}
              />
            </label>
          ))}
        </div>
      </section>

      <section className="arbeitsblatt-panel" aria-labelledby="arbeitsblatt-lagebild-title">
        <div className="arbeitsblatt-panel__head">
          <h3 id="arbeitsblatt-lagebild-title">
            <span className="arbeitsblatt-panel__letter">B</span>
            <span aria-hidden="true">·</span> Lagebild
          </h3>
          <p>Live-Lagekarte (read-only) aus dem Modul Lagekarte.</p>
        </div>
        <div className="arbeitsblatt-lagebild-row">
          <div className="arbeitsblatt-lagebild arbeitsblatt-lagebild--full">
            <Lagekarte session={session} embedded readOnly />
          </div>
        </div>
      </section>

      <section className="arbeitsblatt-panel" aria-labelledby="arbeitsblatt-kraefte-title">
        <div className="arbeitsblatt-panel__head">
          <h3 id="arbeitsblatt-kraefte-title">
            <span className="arbeitsblatt-panel__letter">C</span>
            <span aria-hidden="true">·</span> Einheiten / Kräfteübersicht
          </h3>
          <p>Automatisch aus dem Modul Kräfteübersicht.</p>
        </div>
        <div className="arbeitsblatt-kraft-strip">
          <div className="arbeitsblatt-kraft-stat">
            <span className="arbeitsblatt-kraft-stat__label">Gesamtstärke im Einsatz</span>
            <span className="arbeitsblatt-kraft-stat__value">{formatStaerke(kraft.einsatz)}</span>
            <span className="arbeitsblatt-kraft-stat__hint">
              Führer / Unterführer / Helfer // Gesamt (DV 100)
            </span>
          </div>
          <div className="arbeitsblatt-kraft-stat">
            <span className="arbeitsblatt-kraft-stat__label">Fahrzeuge im Bereitstellungsraum</span>
            <span className="arbeitsblatt-kraft-stat__value">{kraft.brCount}</span>
            <span className="arbeitsblatt-kraft-stat__hint">Anzahl Fahrzeuge im BR</span>
          </div>
        </div>
        {abschnitte.length > 0 && (
          <div className="arbeitsblatt-ea-list">
            <span className="arbeitsblatt-ea-list__label">Einsatzabschnitte</span>
            {abschnitte.map((a) => {
              const k = abschnittKraft(a.id);
              return (
                <div className="arbeitsblatt-ea-row" key={a.id}>
                  <span className="arbeitsblatt-ea-row__tag">{formatAbschnittTitel(a)}</span>
                  {a.auftrag && <span className="arbeitsblatt-ea-row__auftrag">{a.auftrag}</span>}
                  <span className="arbeitsblatt-ea-row__staerke">
                    {formatStaerke(k.staerke)} · {k.count} Fz.
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="arbeitsblatt-panel" aria-labelledby="arbeitsblatt-auftraege-title">
        <div className="arbeitsblatt-panel__head">
          <h3 id="arbeitsblatt-auftraege-title">
            <span className="arbeitsblatt-panel__letter">D</span>
            <span aria-hidden="true">·</span> Aufträge &amp; Maßnahmen
          </h3>
        </div>
        <div className="table-scroll">
          <table className="arbeitsblatt-table">
            <thead>
              <tr>
                <th>Auftrag</th>
                <th>Maßnahmen</th>
                <th>Laufender Vorgang</th>
                <th>Erledigt</th>
                {writable && <th>Aktion</th>}
              </tr>
            </thead>
            <tbody>
              {sheet.auftraege.map((row) => (
                <tr key={row.id} className={row.erledigt ? "arbeitsblatt-row--done" : undefined}>
                  <td>
                    <textarea
                      className="arbeitsblatt-table__input arbeitsblatt-table__textarea"
                      rows={2}
                      value={row.auftrag}
                      readOnly={!writable}
                      onChange={(event) => setAuftragField(row.id, "auftrag", event.currentTarget.value)}
                    />
                  </td>
                  <td>
                    <textarea
                      className="arbeitsblatt-table__input arbeitsblatt-table__textarea"
                      rows={2}
                      value={row.massnahmen}
                      readOnly={!writable}
                      onChange={(event) =>
                        setAuftragField(row.id, "massnahmen", event.currentTarget.value)
                      }
                    />
                  </td>
                  <td className="arbeitsblatt-table__check">
                    <input
                      type="checkbox"
                      checked={row.laufenderVorgang}
                      disabled={!writable}
                      aria-label="Laufender Vorgang"
                      onChange={(event) =>
                        setAuftragField(row.id, "laufenderVorgang", event.currentTarget.checked)
                      }
                    />
                  </td>
                  <td className="arbeitsblatt-table__check">
                    <input
                      type="checkbox"
                      checked={row.erledigt}
                      disabled={!writable}
                      aria-label="Auftrag erledigt"
                      onChange={(event) =>
                        setAuftragField(row.id, "erledigt", event.currentTarget.checked)
                      }
                    />
                  </td>
                  {writable && (
                    <td>
                      <button
                        className="arbeitsblatt-delete"
                        type="button"
                        onClick={() => deleteAuftrag(row.id)}
                      >
                        Löschen
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {sheet.auftraege.length === 0 && !writable && (
                <tr>
                  <td className="arbeitsblatt-table__empty" colSpan={4}>
                    Noch keine Zeilen
                  </td>
                </tr>
              )}
              {writable && (
                <tr className="arbeitsblatt-table__new-row">
                  <td colSpan={5}>
                    <button className="etb-add" type="button" onClick={addAuftrag}>
                      Neue Zeile
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="arbeitsblatt-panel" aria-labelledby="arbeitsblatt-rueckmeld-title">
        <div className="arbeitsblatt-panel__head">
          <h3 id="arbeitsblatt-rueckmeld-title">
            <span className="arbeitsblatt-panel__letter">E</span>
            <span aria-hidden="true">·</span> Notizen
          </h3>
        </div>
        <div className="arbeitsblatt-checklist">
          {sheet.rueckmeldungen.map((note) => (
            <div
              className={`arbeitsblatt-checklist__row ${
                note.erledigt ? "arbeitsblatt-checklist__row--done" : ""
              }`}
              key={note.id}
            >
              <input
                type="checkbox"
                checked={note.erledigt}
                disabled={!writable}
                aria-label="Notiz erledigt"
                onChange={(event) =>
                  setRueckmeldungField(note.id, "erledigt", event.currentTarget.checked)
                }
              />
              <input
                type="text"
                value={note.text}
                readOnly={!writable}
                aria-label="Notiz"
                onChange={(event) => setRueckmeldungField(note.id, "text", event.currentTarget.value)}
              />
              {writable && (
                <button
                  className="arbeitsblatt-delete"
                  type="button"
                  onClick={() => deleteRueckmeldung(note.id)}
                >
                  Löschen
                </button>
              )}
            </div>
          ))}
          {sheet.rueckmeldungen.length === 0 && (
            <p className="arbeitsblatt-empty">Noch keine Notizen</p>
          )}
          {writable && (
            <button className="etb-add" type="button" onClick={addRueckmeldung}>
              Notiz hinzufügen
            </button>
          )}
        </div>
      </section>

      <section className="arbeitsblatt-panel" aria-labelledby="arbeitsblatt-organisation-title">
        <div className="arbeitsblatt-panel__head">
          <h3 id="arbeitsblatt-organisation-title">
            <span className="arbeitsblatt-panel__letter">F</span>
            <span aria-hidden="true">·</span> Kommunikation
          </h3>
        </div>
        <div className="arbeitsblatt-organisation">
          <div className="arbeitsblatt-group">
            <h4>Funkkanäle</h4>
            <div className="arbeitsblatt-kanal-grid">
              {AB_KANAL_FIELDS.map((field) => (
                <label className="arbeitsblatt-field" key={field}>
                  <span>{AB_KANAL_LABELS[field]}</span>
                  <input
                    type="text"
                    value={sheet.organisation[field]}
                    readOnly={!writable}
                    onChange={(event) => setOrganisation(field, event.currentTarget.value)}
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="arbeitsblatt-group">
            <h4>Weitere Kanäle</h4>
            <div className="arbeitsblatt-kanaele">
              <div className="arbeitsblatt-kanaele__head" aria-hidden="true">
                <span>Typ</span>
                <span>Gruppe</span>
                <span>Verwendungszweck</span>
                {writable && <span />}
              </div>
              {sheet.kanaele.map((kanal) => (
                <div className="arbeitsblatt-kanaele__row" key={kanal.id}>
                  <select
                    className="arbeitsblatt-kanaele__typ"
                    value={kanal.typ}
                    disabled={!writable}
                    aria-label="Kanal-Typ"
                    onChange={(event) =>
                      setKanalField(kanal.id, "typ", event.currentTarget.value as AbKanalTyp)
                    }
                  >
                    {AB_KANAL_TYPEN.map((typ) => (
                      <option key={typ} value={typ}>
                        {typ}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={kanal.gruppe}
                    readOnly={!writable}
                    aria-label="Gruppe"
                    onChange={(event) => setKanalField(kanal.id, "gruppe", event.currentTarget.value)}
                  />
                  <input
                    type="text"
                    value={kanal.verwendungszweck}
                    readOnly={!writable}
                    aria-label="Verwendungszweck"
                    onChange={(event) =>
                      setKanalField(kanal.id, "verwendungszweck", event.currentTarget.value)
                    }
                  />
                  {writable && (
                    <button
                      className="arbeitsblatt-delete"
                      type="button"
                      onClick={() => deleteKanal(kanal.id)}
                    >
                      Löschen
                    </button>
                  )}
                </div>
              ))}
              {sheet.kanaele.length === 0 && (
                <p className="arbeitsblatt-empty">Noch keine weiteren Kanäle</p>
              )}
              {writable && (
                <button className="etb-add" type="button" onClick={addKanal}>
                  Kanal hinzufügen
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <Wetter
        snapshot={sheet.wetter}
        writable={writable}
        roomId={session.room.id}
        onSnapshot={setWetter}
        onWriteEtb={writeWetterEtb}
      />
    </div>
  );
}
