import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  AB_EXPORT_FORMAT,
  AB_EXPORT_VERSION,
  AB_KANAELE,
  AB_KANAL_FIELDS,
  AB_KANAL_LABELS,
  AB_KANAL_TYPEN,
  AB_KOPF,
  AB_KOPF_FIELDS,
  AB_KOPF_LABELS,
  AB_MASSNAHMEN,
  AB_ORGANISATION,
  AB_RUECKMELD,
  AB_WETTER,
  AB_WETTER_SNAPSHOT,
  canWrite,
  coerceAbMassnahme,
  EA_ABSCHNITTE,
  EA_BEREITSTELLUNG,
  EA_FUEHRUNG,
  EA_FUEHRUNG_AUFTRAEGE,
  formatAbschnittTitel,
  vehiclesInAbschnitt,
  formatStaerke,
  isRecord,
  KRAFT_VEHICLES,
  sumStaerke,
  type AbAuftragZeile,
  type AbKanal,
  type AbKanalField,
  type AbKanalTyp,
  type AbKopfField,
  type AbMassnahme,
  type AbNotiz,
  type AbWetterSnapshot,
  type Arbeitsblatt as ArbeitsblattState,
  type ArbeitsblattExport,
  type EaListItem,
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
  massnahmen: {},
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
  einsatzCount: number; // Anzahl Fahrzeuge im Einsatz (BR-Einheiten: Liste unten)
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
  // Feld D (#163): Aufträge read-only aus dem Führungs-Bereich des EA-Moduls.
  const [fuehrungAuftraege, setFuehrungAuftraege] = useState<EaListItem[]>([]);
  const [importMessage, setImportMessage] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const kopfRef = useRef<Y.Map<unknown> | null>(null);
  // Feld D (#163): Maßnahmen je Führungs-Auftrags-id (Y.Map<Y.Map>, Feld-Merge).
  const massnahmenRef = useRef<Y.Map<unknown> | null>(null);
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
    einsatzCount: einsatzVehicles.length,
  };
  // BR-Zeile (#189): Führungsmittel, die der fixen BR-Karte im EA-Modul zugeordnet sind.
  const brVehicles = vehicles.filter((v) => v.status === "br" && v.einsatzabschnittId === EA_BEREITSTELLUNG);
  // Auftrag der BR-Karte (read-only aus dem Bereitstellungsraum-Singleton) für die BR-Zeile.
  const [brAuftrag, setBrAuftrag] = useState("");
  // Stärke + Fahrzeug-Anzahl je Abschnitt (geteiltes, getestetes Primitiv, #141).
  const abschnittKraft = (id: string) => {
    const assigned = vehiclesInAbschnitt(vehicles, id);
    return { staerke: sumStaerke(assigned), count: assigned.length };
  };

  useEffect(() => {
    const conn = connectModule(session.room.id, "arbeitsblatt", session.token);
    const { doc } = conn;
    const kopf = doc.getMap<unknown>(AB_KOPF);
    const massnahmen = doc.getMap<unknown>(AB_MASSNAHMEN);
    const rueckmeld = doc.getArray<Y.Map<unknown>>(AB_RUECKMELD);
    const organisation = doc.getMap<unknown>(AB_ORGANISATION);
    const kanaele = doc.getArray<Y.Map<unknown>>(AB_KANAELE);
    const wetter = doc.getMap<unknown>(AB_WETTER);

    kopfRef.current = kopf;
    massnahmenRef.current = massnahmen;
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
      massnahmen: Object.fromEntries(
        Object.entries(massnahmen.toJSON() as Record<string, unknown>).map(([id, v]) => [
          id,
          coerceAbMassnahme(v),
        ]),
      ),
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
      massnahmenRef.current = null;
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
    // Feld D (#163): die „Aufträge" der Führung read-only mitlesen (Auftrags-Sync).
    const fuehrungMap = conn.doc.getMap<unknown>(EA_FUEHRUNG);
    // BR (#189): der Auftrag des Bereitstellungsraum-Singletons für die BR-Zeile.
    const brMap = conn.doc.getMap<unknown>(EA_BEREITSTELLUNG);
    const refresh = () => {
      setAbschnitte(list.toArray().map((m) => m.toJSON() as Einsatzabschnitt));
      const fuList = fuehrungMap.get(EA_FUEHRUNG_AUFTRAEGE);
      setFuehrungAuftraege(fuList instanceof Y.Array ? (fuList.toJSON() as EaListItem[]) : []);
      setBrAuftrag(stringValue(brMap, "auftrag"));
    };
    list.observeDeep(refresh);
    fuehrungMap.observeDeep(refresh);
    brMap.observe(refresh);
    refresh();
    return () => {
      list.unobserveDeep(refresh);
      fuehrungMap.unobserveDeep(refresh);
      brMap.unobserve(refresh);
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

  // Feld D (#163): die Maßnahmen (+ „laufender Vorgang") je Führungs-Auftrag pflegen.
  // Der Eintrag wird bei Bedarf angelegt (Y.Map je Auftrags-id → Feld-Merge). Die
  // Aufträge selbst sind read-only aus der Führung — hier kein Anlegen/Löschen.
  const setMassnahme = (auftragId: string, field: keyof AbMassnahme, value: string | boolean) => {
    if (!writable) return;
    const map = massnahmenRef.current;
    if (!map) return;
    const existing = map.get(auftragId);
    let entry: Y.Map<unknown>;
    if (existing instanceof Y.Map) {
      entry = existing;
    } else {
      entry = new Y.Map<unknown>();
      map.set(auftragId, entry);
    }
    entry.set(field, value);
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
      // Feld C · Einsatzabschnitte identisch zur Bildschirm-Liste ableiten (#140),
      // BR-Zeile vorangestellt (#189).
      const brK = {
        staerke: sumStaerke(brVehicles),
        count: brVehicles.length,
      };
      const abschnittZeilen = [
        { titel: "BR", auftrag: brAuftrag, staerke: brK.staerke, count: brK.count },
        ...abschnitte.map((a) => {
          const k = abschnittKraft(a.id);
          return { titel: formatAbschnittTitel(a), auftrag: a.auftrag, staerke: k.staerke, count: k.count };
        }),
      ];
      // Feld D · read-only Aufträge aus der Führung + gepflegte Maßnahmen (#163).
      const auftragZeilen: AbAuftragZeile[] = fuehrungAuftraege.map((a) => {
        const m = sheet.massnahmen[a.id];
        return {
          auftrag: a.text,
          erledigt: a.erledigt,
          massnahmen: m?.massnahmen ?? "",
          laufenderVorgang: m?.laufenderVorgang ?? false,
        };
      });
      const bytes = await arbeitsblattToPdf(sheet, kraft, abschnittZeilen, auftragZeilen, {
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
            <span className="arbeitsblatt-kraft-stat__label">Fahrzeuge im Einsatz</span>
            <span className="arbeitsblatt-kraft-stat__value">{kraft.einsatzCount}</span>
            <span className="arbeitsblatt-kraft-stat__hint">
              Anzahl — die BR-Einheiten stehen in der Liste unten
            </span>
          </div>
        </div>
        {abschnitte.length > 0 && (
          <div className="arbeitsblatt-ea-list">
            <span className="arbeitsblatt-ea-list__label">Einsatzabschnitte</span>
            {/* BR als eigene Zeile (#189): Führungsmittel, die der fixen BR-Karte
                im EA-Modul zugeordnet sind (Status „br", einsatzabschnittId=BR). */}
            <div className="arbeitsblatt-ea-row">
              <span className="arbeitsblatt-ea-row__tag">BR</span>
              {brAuftrag && <span className="arbeitsblatt-ea-row__auftrag">{brAuftrag}</span>}
              <span className="arbeitsblatt-ea-row__staerke">
                {formatStaerke(sumStaerke(brVehicles))} · {brVehicles.length} Fz.
              </span>
            </div>
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
          <p>Aufträge (read-only) aus dem Modul Abschnitte · Führung — hier Maßnahmen ergänzen.</p>
        </div>
        <div className="table-scroll">
          <table className="arbeitsblatt-table">
            <thead>
              <tr>
                <th>Auftrag</th>
                <th>Maßnahmen</th>
                <th>Laufender Vorgang</th>
              </tr>
            </thead>
            <tbody>
              {fuehrungAuftraege.map((auftrag) => {
                const m = sheet.massnahmen[auftrag.id];
                return (
                  <tr key={auftrag.id} className={auftrag.erledigt ? "arbeitsblatt-row--done" : undefined}>
                    <td>
                      {/* read-only Spiegel des Führungs-Auftrags (#163); Erledigt via Durchstreichen. */}
                      <span className="arbeitsblatt-auftrag-ro">{auftrag.text}</span>
                    </td>
                    <td>
                      <textarea
                        className="arbeitsblatt-table__input arbeitsblatt-table__textarea"
                        rows={2}
                        value={m?.massnahmen ?? ""}
                        readOnly={!writable}
                        aria-label={`Maßnahmen zu: ${auftrag.text}`}
                        onChange={(event) => setMassnahme(auftrag.id, "massnahmen", event.currentTarget.value)}
                      />
                    </td>
                    <td className="arbeitsblatt-table__check">
                      <input
                        type="checkbox"
                        checked={m?.laufenderVorgang ?? false}
                        disabled={!writable}
                        aria-label="Laufender Vorgang"
                        onChange={(event) =>
                          setMassnahme(auftrag.id, "laufenderVorgang", event.currentTarget.checked)
                        }
                      />
                    </td>
                  </tr>
                );
              })}
              {fuehrungAuftraege.length === 0 && (
                <tr>
                  <td className="arbeitsblatt-table__empty" colSpan={3}>
                    Noch keine Aufträge — im Modul Abschnitte · Führung anlegen.
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
