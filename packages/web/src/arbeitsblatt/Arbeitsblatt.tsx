import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  AB_EIGENELAGE,
  AB_EXPORT_FORMAT,
  AB_FUEHRUNG,
  AB_GEFAHREN,
  AB_GEFAHREN_KATALOG,
  AB_KOPF,
  AB_KOPF_FIELDS,
  AB_KOPF_LABELS,
  AB_KANAL_FIELDS,
  AB_KANAL_LABELS,
  AB_NACHFORDERUNG,
  AB_ORGANIGRAMM,
  AB_ORGANISATION,
  AB_RUECKMELD,
  AB_WETTER,
  AB_WETTER_SNAPSHOT,
  canWrite,
  type AbFunktion,
  type AbFuehrungszeile,
  type AbGefahr,
  type AbGefahrKey,
  type AbKopfField,
  type AbNachforderung,
  type AbNotiz,
  type AbOrganigrammzeile,
  type AbPrioritaet,
  type AbWetterSnapshot,
  type Arbeitsblatt as ArbeitsblattState,
  type ArbeitsblattExport,
} from "@lagekatse/shared";
import * as Y from "yjs";
import { api } from "../api";
import { Lagekarte } from "../lagekarte/Lagekarte";
import type { Session } from "../session";
import { connectModule } from "../sync/provider";
import { uid } from "../uid";
import { dug } from "../dug";
import { Wetter } from "./Wetter";

const EMPTY_SHEET: ArbeitsblattState = {
  kopf: {
    einsatzstichwort: "",
    einsatzort: "",
    meldender: "",
    objektnr: "",
    datumUhrzeitgruppe: "",
  },
  gefahren: {},
  fuehrungsvorgang: [],
  rueckmeldungen: [],
  eigeneLage: {
    auftragMr: false,
    auftragBb: false,
    auftragText: "",
    kraefteuebersicht: "",
  },
  nachforderung: [],
  organisation: {
    tmoGruppe: "",
    fuehrungsKanal: "",
    dmoGruppe: "",
    gebFunk: "",
    eigeneFunktion: "",
  },
  organigramm: [],
  wetter: null,
};

function stringValue(map: Y.Map<unknown>, field: string): string {
  const value = map.get(field);
  return typeof value === "string" ? value : "";
}

function booleanValue(map: Y.Map<unknown>, field: string): boolean {
  const value = map.get(field);
  return typeof value === "boolean" ? value : false;
}

function funktionValue(map: Y.Map<unknown>, field: string): AbFunktion {
  const value = map.get(field);
  return value === "GF" || value === "ZF" || value === "VF" ? value : "";
}

// ---- Coercion-Helfer für den JSON-Import (rohe Werte aus der Datei absichern) ----
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function asBool(value: unknown): boolean {
  return value === true;
}
function asPrio(value: unknown): AbPrioritaet {
  return value === 1 || value === 2 || value === 3 ? value : "";
}
function asFunktion(value: unknown): AbFunktion {
  return value === "GF" || value === "ZF" || value === "VF" ? value : "";
}
/** Baut eine Y.Map-Zeile aus einem einfachen Objekt (für die Array-Felder). */
function rowMap(entries: Record<string, unknown>): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  Object.entries(entries).forEach(([key, value]) => map.set(key, value));
  return map;
}

export function Arbeitsblatt({ session }: { session: Session }) {
  const [sheet, setSheet] = useState<ArbeitsblattState>(EMPTY_SHEET);
  const [importMessage, setImportMessage] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);
  const kopfRef = useRef<Y.Map<unknown> | null>(null);
  const fuehrungRef = useRef<Y.Array<Y.Map<unknown>> | null>(null);
  const rueckmeldRef = useRef<Y.Array<Y.Map<unknown>> | null>(null);
  const eigeneLageRef = useRef<Y.Map<unknown> | null>(null);
  const nachforderungRef = useRef<Y.Array<Y.Map<unknown>> | null>(null);
  const organisationRef = useRef<Y.Map<unknown> | null>(null);
  const organigrammRef = useRef<Y.Array<Y.Map<unknown>> | null>(null);
  const gefahrenRef = useRef<Y.Map<unknown> | null>(null);
  const wetterRef = useRef<Y.Map<unknown> | null>(null);
  const writable = canWrite(session.roles, "arbeitsblatt", {
    allowMonitorChat: session.room.settings.allowMonitorChat,
  });

  useEffect(() => {
    const conn = connectModule(session.room.id, "arbeitsblatt", session.token);
    const { doc } = conn;
    const kopf = doc.getMap<unknown>(AB_KOPF);
    const fuehrung = doc.getArray<Y.Map<unknown>>(AB_FUEHRUNG);
    const rueckmeld = doc.getArray<Y.Map<unknown>>(AB_RUECKMELD);
    const eigeneLage = doc.getMap<unknown>(AB_EIGENELAGE);
    const nachforderung = doc.getArray<Y.Map<unknown>>(AB_NACHFORDERUNG);
    const organisation = doc.getMap<unknown>(AB_ORGANISATION);
    const organigramm = doc.getArray<Y.Map<unknown>>(AB_ORGANIGRAMM);
    const gefahren = doc.getMap<unknown>(AB_GEFAHREN);
    const wetter = doc.getMap<unknown>(AB_WETTER);

    kopfRef.current = kopf;
    fuehrungRef.current = fuehrung;
    rueckmeldRef.current = rueckmeld;
    eigeneLageRef.current = eigeneLage;
    nachforderungRef.current = nachforderung;
    organisationRef.current = organisation;
    organigrammRef.current = organigramm;
    gefahrenRef.current = gefahren;
    wetterRef.current = wetter;

    const readSheet = (): ArbeitsblattState => ({
      kopf: {
        einsatzstichwort: stringValue(kopf, "einsatzstichwort"),
        einsatzort: stringValue(kopf, "einsatzort"),
        meldender: stringValue(kopf, "meldender"),
        objektnr: stringValue(kopf, "objektnr"),
        datumUhrzeitgruppe: stringValue(kopf, "datumUhrzeitgruppe"),
      },
      gefahren: gefahren.toJSON() as Partial<Record<AbGefahrKey, AbGefahr>>,
      fuehrungsvorgang: fuehrung
        .toArray()
        .map((row) => row.toJSON() as AbFuehrungszeile),
      rueckmeldungen: rueckmeld.toArray().map((note) => note.toJSON() as AbNotiz),
      eigeneLage: {
        auftragMr: booleanValue(eigeneLage, "auftragMr"),
        auftragBb: booleanValue(eigeneLage, "auftragBb"),
        auftragText: stringValue(eigeneLage, "auftragText"),
        kraefteuebersicht: stringValue(eigeneLage, "kraefteuebersicht"),
      },
      nachforderung: nachforderung.toArray().map((row) => row.toJSON() as AbNachforderung),
      organisation: {
        tmoGruppe: stringValue(organisation, "tmoGruppe"),
        fuehrungsKanal: stringValue(organisation, "fuehrungsKanal"),
        dmoGruppe: stringValue(organisation, "dmoGruppe"),
        gebFunk: stringValue(organisation, "gebFunk"),
        eigeneFunktion: funktionValue(organisation, "eigeneFunktion"),
      },
      organigramm: organigramm
        .toArray()
        .map((row) => row.toJSON() as AbOrganigrammzeile),
      wetter: (wetter.get(AB_WETTER_SNAPSHOT) as AbWetterSnapshot | undefined) ?? null,
    });

    const refresh = () => setSheet(readSheet());
    doc.on("update", refresh);
    refresh();

    return () => {
      doc.off("update", refresh);
      kopfRef.current = null;
      fuehrungRef.current = null;
      rueckmeldRef.current = null;
      eigeneLageRef.current = null;
      nachforderungRef.current = null;
      organisationRef.current = null;
      organigrammRef.current = null;
      gefahrenRef.current = null;
      wetterRef.current = null;
      conn.destroy();
    };
  }, [session.room.id, session.token]);

  const setKopf = (field: AbKopfField, value: string) => {
    if (!writable) return;
    kopfRef.current?.set(field, value);
  };

  const setGefahr = (key: AbGefahrKey, posten: AbGefahr) => {
    if (!writable) return;
    gefahrenRef.current?.set(key, posten);
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

  const setFuehrungField = (
    id: string,
    field: keyof Omit<AbFuehrungszeile, "id">,
    value: unknown,
  ) => {
    if (!writable) return;
    const row = fuehrungRef.current?.toArray().find((item) => item.get("id") === id);
    row?.set(field, value);
  };

  const addFuehrungRow = () => {
    if (!writable) return;
    const rows = fuehrungRef.current;
    if (!rows) return;
    const value: AbFuehrungszeile = {
      id: uid(),
      bedrohtesObjekt: "",
      wirkung: "",
      prioritaet: "",
      massnahmen: "",
      erledigt: false,
    };
    const row = new Y.Map<unknown>();
    Object.entries(value).forEach(([field, fieldValue]) => row.set(field, fieldValue));
    rows.push([row]);
  };

  const deleteFuehrungRow = (id: string) => {
    if (!writable) return;
    const rows = fuehrungRef.current;
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

  const setEigeneLage = (field: keyof ArbeitsblattState["eigeneLage"], value: unknown) => {
    if (!writable) return;
    eigeneLageRef.current?.set(field, value);
  };

  const setNachforderungField = (
    id: string,
    field: keyof Omit<AbNachforderung, "id">,
    value: unknown,
  ) => {
    if (!writable) return;
    const row = nachforderungRef.current?.toArray().find((item) => item.get("id") === id);
    row?.set(field, value);
  };

  const addNachforderung = () => {
    if (!writable) return;
    const rows = nachforderungRef.current;
    if (!rows) return;
    const value: AbNachforderung = { id: uid(), text: "" };
    const row = new Y.Map<unknown>();
    Object.entries(value).forEach(([field, fieldValue]) => row.set(field, fieldValue));
    rows.push([row]);
  };

  const deleteNachforderung = (id: string) => {
    if (!writable) return;
    const rows = nachforderungRef.current;
    if (!rows) return;
    const index = rows.toArray().findIndex((row) => row.get("id") === id);
    if (index >= 0) rows.delete(index, 1);
  };

  const setOrganisation = (field: keyof ArbeitsblattState["organisation"], value: string) => {
    if (!writable) return;
    organisationRef.current?.set(field, value);
  };

  const setOrganigrammField = (
    id: string,
    field: keyof Omit<AbOrganigrammzeile, "id">,
    value: string,
  ) => {
    if (!writable) return;
    const row = organigrammRef.current?.toArray().find((item) => item.get("id") === id);
    row?.set(field, value);
  };

  const addOrganigrammRow = () => {
    if (!writable) return;
    const rows = organigrammRef.current;
    if (!rows) return;
    const value: AbOrganigrammzeile = {
      id: uid(),
      rolle: "",
      auftrag: "",
      fuehrer: "",
      rufname: "",
    };
    const row = new Y.Map<unknown>();
    Object.entries(value).forEach(([field, fieldValue]) => row.set(field, fieldValue));
    rows.push([row]);
  };

  const deleteOrganigrammRow = (id: string) => {
    if (!writable) return;
    const rows = organigrammRef.current;
    if (!rows) return;
    const index = rows.toArray().findIndex((row) => row.get("id") === id);
    if (index >= 0) rows.delete(index, 1);
  };

  const exportJson = () => {
    const payload: ArbeitsblattExport = {
      format: AB_EXPORT_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      sheet,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `arbeitsblatt-${session.room.joinCode}-${dug()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  // JSON-Import (Gegenstück zum Export). Validiert die Datei gegen das
  // ArbeitsblattExport-Schema und spielt sie als EINE doc.transact() ein — ein
  // atomarer Import, ein Sync-Update, saubere Undo-Grenze. Ersetzt das gesamte
  // (geteilte!) Arbeitsblatt, daher vorher window.confirm. Nur Schreibberechtigte.
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
        setImportMessage("Import fehlgeschlagen: kein gültiges Arbeitsblatt-Export-Format.");
        return;
      }
      const doc = kopfRef.current?.doc;
      if (!doc) {
        setImportMessage("Import fehlgeschlagen: Arbeitsblatt noch nicht bereit.");
        return;
      }
      if (
        !window.confirm(
          "Das aktuelle Arbeitsblatt wird durch die importierten Daten ersetzt — für alle im Stabsraum. Fortfahren?",
        )
      ) {
        return;
      }

      const sheet = parsed.sheet;
      const kopfObj = isRecord(sheet.kopf) ? sheet.kopf : {};
      const gefahrenObj = isRecord(sheet.gefahren) ? sheet.gefahren : {};
      const eigeneLageObj = isRecord(sheet.eigeneLage) ? sheet.eigeneLage : {};
      const organisationObj = isRecord(sheet.organisation) ? sheet.organisation : {};
      const fuehrungArr = Array.isArray(sheet.fuehrungsvorgang) ? sheet.fuehrungsvorgang : [];
      const rueckArr = Array.isArray(sheet.rueckmeldungen) ? sheet.rueckmeldungen : [];
      const nachArr = Array.isArray(sheet.nachforderung) ? sheet.nachforderung : [];
      const orgaArr = Array.isArray(sheet.organigramm) ? sheet.organigramm : [];

      doc.transact(() => {
        const kopf = kopfRef.current;
        const gefahren = gefahrenRef.current;
        const fuehrung = fuehrungRef.current;
        const rueck = rueckmeldRef.current;
        const eigeneLage = eigeneLageRef.current;
        const nach = nachforderungRef.current;
        const organisation = organisationRef.current;
        const organigramm = organigrammRef.current;
        const wetter = wetterRef.current;
        if (
          !kopf || !gefahren || !fuehrung || !rueck || !eigeneLage || !nach ||
          !organisation || !organigramm || !wetter
        ) {
          return;
        }

        // Feld A: Kopf-Skalare überschreiben
        AB_KOPF_FIELDS.forEach((f) => kopf.set(f, asString(kopfObj[f])));

        // Feld B: Gefahren ersetzen (leeren, dann gültige Posten setzen)
        [...gefahren.keys()].forEach((k) => gefahren.delete(k));
        for (const g of AB_GEFAHREN_KATALOG) {
          const p = gefahrenObj[g.key];
          if (isRecord(p) && typeof p.betroffen === "boolean") {
            const notiz = asString(p.notiz);
            gefahren.set(g.key, notiz ? { betroffen: p.betroffen, notiz } : { betroffen: p.betroffen });
          }
        }

        // Feld C: Führungsvorgang (Array ersetzen)
        fuehrung.delete(0, fuehrung.length);
        for (const r of fuehrungArr) {
          if (!isRecord(r)) continue;
          fuehrung.push([
            rowMap({
              id: asString(r.id) || uid(),
              bedrohtesObjekt: asString(r.bedrohtesObjekt),
              wirkung: asString(r.wirkung),
              prioritaet: asPrio(r.prioritaet),
              massnahmen: asString(r.massnahmen),
              erledigt: asBool(r.erledigt),
            }),
          ]);
        }

        // Feld D: Rückmeldungen
        rueck.delete(0, rueck.length);
        for (const r of rueckArr) {
          if (!isRecord(r)) continue;
          rueck.push([rowMap({ id: asString(r.id) || uid(), text: asString(r.text), erledigt: asBool(r.erledigt) })]);
        }

        // Feld E: eigene Lage (Skalare) + Nachforderung (Array)
        eigeneLage.set("auftragMr", asBool(eigeneLageObj.auftragMr));
        eigeneLage.set("auftragBb", asBool(eigeneLageObj.auftragBb));
        eigeneLage.set("auftragText", asString(eigeneLageObj.auftragText));
        eigeneLage.set("kraefteuebersicht", asString(eigeneLageObj.kraefteuebersicht));
        nach.delete(0, nach.length);
        for (const r of nachArr) {
          if (!isRecord(r)) continue;
          nach.push([rowMap({ id: asString(r.id) || uid(), text: asString(r.text) })]);
        }

        // Feld F: Organisation (Skalare) + Organigramm (Array)
        AB_KANAL_FIELDS.forEach((f) => organisation.set(f, asString(organisationObj[f])));
        organisation.set("eigeneFunktion", asFunktion(organisationObj.eigeneFunktion));
        organigramm.delete(0, organigramm.length);
        for (const r of orgaArr) {
          if (!isRecord(r)) continue;
          organigramm.push([
            rowMap({
              id: asString(r.id) || uid(),
              rolle: asString(r.rolle),
              auftrag: asString(r.auftrag),
              fuehrer: asString(r.fuehrer),
              rufname: asString(r.rufname),
            }),
          ]);
        }

        // Rückseite: Wetter-Snapshot (Whole-Value) übernehmen oder leeren
        if (isRecord(sheet.wetter)) wetter.set(AB_WETTER_SNAPSHOT, sheet.wetter);
        else wetter.delete(AB_WETTER_SNAPSHOT);
      });

      setImportMessage("Arbeitsblatt importiert.");
    } catch {
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
          Taktisches Arbeitsblatt
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
          <p>Live-Lagekarte (read-only) und die Gefahren der Einsatzstelle.</p>
        </div>
        <div className="arbeitsblatt-lagebild-row">
          <div className="arbeitsblatt-lagebild">
            <Lagekarte session={session} embedded readOnly />
          </div>
          <div className="arbeitsblatt-gefahren">
            <div className="arbeitsblatt-gefahren__head">
              <span>Gefahren der Einsatzstelle</span>
              <span className="arbeitsblatt-gefahren__scheme">4 A · 1 C · 4 E</span>
            </div>
            {AB_GEFAHREN_KATALOG.map((g) => {
              const posten = sheet.gefahren[g.key] ?? { betroffen: false };
              return (
                <div className="arbeitsblatt-gefahr" key={g.key}>
                  <label className="arbeitsblatt-gefahr__row">
                    <span className={`arbeitsblatt-gefahr__tag arbeitsblatt-gefahr__tag--${g.gruppe}`}>
                      {g.gruppe}
                    </span>
                    <input
                      type="checkbox"
                      checked={posten.betroffen}
                      disabled={!writable}
                      aria-label={g.label}
                      onChange={(event) =>
                        setGefahr(g.key, {
                          betroffen: event.currentTarget.checked,
                          ...(posten.notiz ? { notiz: posten.notiz } : {}),
                        })
                      }
                    />
                    <span className="arbeitsblatt-gefahr__label">{g.label}</span>
                  </label>
                  {posten.betroffen && (
                    <input
                      className="arbeitsblatt-gefahr__notiz"
                      type="text"
                      value={posten.notiz ?? ""}
                      readOnly={!writable}
                      placeholder="Notiz (optional)"
                      aria-label={`Notiz zu ${g.label}`}
                      onChange={(event) =>
                        setGefahr(g.key, {
                          betroffen: true,
                          ...(event.currentTarget.value ? { notiz: event.currentTarget.value } : {}),
                        })
                      }
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="arbeitsblatt-panel" aria-labelledby="arbeitsblatt-fuehrung-title">
        <div className="arbeitsblatt-panel__head">
          <h3 id="arbeitsblatt-fuehrung-title">
            <span className="arbeitsblatt-panel__letter">C</span>
            <span aria-hidden="true">·</span> Führungsvorgang
          </h3>
        </div>
        <div className="table-scroll">
          <table className="arbeitsblatt-table">
            <thead>
              <tr>
                <th>Bedrohtes Objekt/Subjekt</th>
                <th>Wirkung</th>
                <th>Priorität</th>
                <th>Maßnahmen</th>
                <th>Erledigt</th>
                {writable && <th>Aktion</th>}
              </tr>
            </thead>
            <tbody>
              {sheet.fuehrungsvorgang.map((row) => (
                <tr key={row.id} className={row.erledigt ? "arbeitsblatt-row--done" : undefined}>
                  <td>
                    <input
                      className="arbeitsblatt-table__input"
                      type="text"
                      value={row.bedrohtesObjekt}
                      readOnly={!writable}
                      onChange={(event) =>
                        setFuehrungField(row.id, "bedrohtesObjekt", event.currentTarget.value)
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="arbeitsblatt-table__input"
                      type="text"
                      value={row.wirkung}
                      readOnly={!writable}
                      onChange={(event) =>
                        setFuehrungField(row.id, "wirkung", event.currentTarget.value)
                      }
                    />
                  </td>
                  <td>
                    <select
                      className={`arbeitsblatt-table__input arbeitsblatt-table__select arbeitsblatt-prio${
                        row.prioritaet ? ` arbeitsblatt-prio--${row.prioritaet}` : ""
                      }`}
                      value={row.prioritaet}
                      disabled={!writable}
                      aria-label="Priorität"
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setFuehrungField(
                          row.id,
                          "prioritaet",
                          value === "" ? "" : (Number(value) as AbPrioritaet),
                        );
                      }}
                    >
                      <option value="">–</option>
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                    </select>
                  </td>
                  <td>
                    <textarea
                      className="arbeitsblatt-table__input arbeitsblatt-table__textarea"
                      rows={2}
                      value={row.massnahmen}
                      readOnly={!writable}
                      onChange={(event) =>
                        setFuehrungField(row.id, "massnahmen", event.currentTarget.value)
                      }
                    />
                  </td>
                  <td className="arbeitsblatt-table__check">
                    <input
                      type="checkbox"
                      checked={row.erledigt}
                      disabled={!writable}
                      aria-label="Führungszeile erledigt"
                      onChange={(event) =>
                        setFuehrungField(row.id, "erledigt", event.currentTarget.checked)
                      }
                    />
                  </td>
                  {writable && (
                    <td>
                      <button
                        className="arbeitsblatt-delete"
                        type="button"
                        onClick={() => deleteFuehrungRow(row.id)}
                      >
                        Löschen
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {sheet.fuehrungsvorgang.length === 0 && !writable && (
                <tr>
                  <td className="arbeitsblatt-table__empty" colSpan={5}>
                    Noch keine Zeilen
                  </td>
                </tr>
              )}
              {writable && (
                <tr className="arbeitsblatt-table__new-row">
                  <td colSpan={6}>
                    <button className="etb-add" type="button" onClick={addFuehrungRow}>
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
            <span className="arbeitsblatt-panel__letter">D</span>
            <span aria-hidden="true">·</span> Rückmeldungen / Notizen
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
                onChange={(event) =>
                  setRueckmeldungField(note.id, "text", event.currentTarget.value)
                }
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

      <section className="arbeitsblatt-panel" aria-labelledby="arbeitsblatt-lage-title">
        <div className="arbeitsblatt-panel__head">
          <h3 id="arbeitsblatt-lage-title">
            <span className="arbeitsblatt-panel__letter">E</span>
            <span aria-hidden="true">·</span> Eigene Lage / Nachforderung
          </h3>
        </div>
        <div className="arbeitsblatt-section-grid">
          <div className="arbeitsblatt-group">
            <h4>Auftrag</h4>
            <div className="arbeitsblatt-options">
              <label>
                <input
                  type="checkbox"
                  checked={sheet.eigeneLage.auftragMr}
                  disabled={!writable}
                  onChange={(event) => setEigeneLage("auftragMr", event.currentTarget.checked)}
                />
                Menschenrettung (MR)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={sheet.eigeneLage.auftragBb}
                  disabled={!writable}
                  onChange={(event) => setEigeneLage("auftragBb", event.currentTarget.checked)}
                />
                Brandbekämpfung (BB)
              </label>
            </div>
            <label className="arbeitsblatt-field">
              <span>Weiterer Auftrag</span>
              <input
                type="text"
                value={sheet.eigeneLage.auftragText}
                readOnly={!writable}
                onChange={(event) => setEigeneLage("auftragText", event.currentTarget.value)}
              />
            </label>
          </div>

          <div className="arbeitsblatt-group">
            <h4>Kräfteübersicht</h4>
            <label className="arbeitsblatt-field">
              <span>Stärke</span>
              <input
                type="text"
                value={sheet.eigeneLage.kraefteuebersicht}
                readOnly={!writable}
                placeholder="z. B. 3 / 1 / 12 / 16"
                onChange={(event) =>
                  setEigeneLage("kraefteuebersicht", event.currentTarget.value)
                }
              />
            </label>
          </div>

          <div className="arbeitsblatt-group arbeitsblatt-group--wide">
            <h4>Nachforderung</h4>
            <div className="arbeitsblatt-nachforderung">
              {sheet.nachforderung.map((eintrag) => (
                <div className="arbeitsblatt-nachforderung__row" key={eintrag.id}>
                  <input
                    type="text"
                    value={eintrag.text}
                    readOnly={!writable}
                    aria-label="Nachforderung"
                    placeholder="z. B. 2 Löschzüge, Rettungsdienst …"
                    onChange={(event) =>
                      setNachforderungField(eintrag.id, "text", event.currentTarget.value)
                    }
                  />
                  {writable && (
                    <button
                      className="arbeitsblatt-delete"
                      type="button"
                      onClick={() => deleteNachforderung(eintrag.id)}
                    >
                      Löschen
                    </button>
                  )}
                </div>
              ))}
              {sheet.nachforderung.length === 0 && (
                <p className="arbeitsblatt-empty">Noch keine Nachforderung</p>
              )}
              {writable && (
                <button className="etb-add" type="button" onClick={addNachforderung}>
                  Nachforderung hinzufügen
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="arbeitsblatt-panel" aria-labelledby="arbeitsblatt-organisation-title">
        <div className="arbeitsblatt-panel__head">
          <h3 id="arbeitsblatt-organisation-title">
            <span className="arbeitsblatt-panel__letter">F</span>
            <span aria-hidden="true">·</span> Organisation / Kommunikation
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
          <div className="arbeitsblatt-group arbeitsblatt-funktion">
            <h4>Eigene Funktion</h4>
            <label className="arbeitsblatt-field">
              <span>Führungsfunktion</span>
              <select
                value={sheet.organisation.eigeneFunktion}
                disabled={!writable}
                onChange={(event) =>
                  setOrganisation("eigeneFunktion", event.currentTarget.value as AbFunktion)
                }
              >
                <option value="">–</option>
                <option value="GF">GF</option>
                <option value="ZF">ZF</option>
                <option value="VF">VF</option>
              </select>
            </label>
          </div>
        </div>

        <div className="arbeitsblatt-organigramm">
          <h4>Führungs-Organigramm</h4>
          <div className="table-scroll">
            <table className="arbeitsblatt-table arbeitsblatt-table--organigramm">
              <thead>
                <tr>
                  <th>Rolle</th>
                  <th>Auftrag</th>
                  <th>Führer</th>
                  <th>Rufname</th>
                  {writable && <th>Aktion</th>}
                </tr>
              </thead>
              <tbody>
                {sheet.organigramm.map((row) => (
                  <tr key={row.id}>
                    {(["rolle", "auftrag", "fuehrer", "rufname"] as const).map((field) => (
                      <td key={field}>
                        <input
                          className="arbeitsblatt-table__input"
                          type="text"
                          value={row[field]}
                          readOnly={!writable}
                          onChange={(event) =>
                            setOrganigrammField(row.id, field, event.currentTarget.value)
                          }
                        />
                      </td>
                    ))}
                    {writable && (
                      <td>
                        <button
                          className="arbeitsblatt-delete"
                          type="button"
                          onClick={() => deleteOrganigrammRow(row.id)}
                        >
                          Löschen
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {sheet.organigramm.length === 0 && !writable && (
                  <tr>
                    <td className="arbeitsblatt-table__empty" colSpan={4}>
                      Noch keine Zeilen
                    </td>
                  </tr>
                )}
                {writable && (
                  <tr className="arbeitsblatt-table__new-row">
                    <td colSpan={5}>
                      <button className="etb-add" type="button" onClick={addOrganigrammRow}>
                        Zeile hinzufügen
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
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
