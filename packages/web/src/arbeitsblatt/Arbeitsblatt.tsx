import { useEffect, useRef, useState } from "react";
import {
  AB_EIGENELAGE,
  AB_EXPORT_FORMAT,
  AB_FUEHRUNG,
  AB_KOPF,
  AB_KOPF_FIELDS,
  AB_KOPF_LABELS,
  AB_NACHFORDERUNG,
  AB_ORGANIGRAMM,
  AB_ORGANISATION,
  AB_RUECKMELD,
  canWrite,
  type AbFunktion,
  type AbFuehrungszeile,
  type AbKopfField,
  type AbNachforderungKey,
  type AbNachforderungPosten,
  type AbNotiz,
  type AbOrganigrammzeile,
  type Arbeitsblatt as ArbeitsblattState,
  type ArbeitsblattExport,
} from "@lagekatse/shared";
import * as Y from "yjs";
import { Lagekarte } from "../lagekarte/Lagekarte";
import type { Session } from "../session";
import { connectModule } from "../sync/provider";

const EMPTY_SHEET: ArbeitsblattState = {
  kopf: {
    einsatzstichwort: "",
    einsatzort: "",
    meldender: "",
    objektnr: "",
    datumUhrzeitgruppe: "",
  },
  fuehrungsvorgang: [],
  rueckmeldungen: [],
  eigeneLage: {
    auftragMr: false,
    auftragBb: false,
    auftragText: "",
    kraefteuebersicht: "",
  },
  nachforderung: {},
  organisation: {
    viererKanal: "",
    fuehrungsKanal: "",
    zweierKanal: "",
    gebFunk: "",
    eigeneFunktion: "",
  },
  organigramm: [],
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

export function Arbeitsblatt({ session }: { session: Session }) {
  const [sheet, setSheet] = useState<ArbeitsblattState>(EMPTY_SHEET);
  const kopfRef = useRef<Y.Map<unknown> | null>(null);
  const fuehrungRef = useRef<Y.Array<Y.Map<unknown>> | null>(null);
  const rueckmeldRef = useRef<Y.Array<Y.Map<unknown>> | null>(null);
  const eigeneLageRef = useRef<Y.Map<unknown> | null>(null);
  const nachforderungRef = useRef<Y.Map<unknown> | null>(null);
  const organisationRef = useRef<Y.Map<unknown> | null>(null);
  const organigrammRef = useRef<Y.Array<Y.Map<unknown>> | null>(null);
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
    const nachforderung = doc.getMap<unknown>(AB_NACHFORDERUNG);
    const organisation = doc.getMap<unknown>(AB_ORGANISATION);
    const organigramm = doc.getArray<Y.Map<unknown>>(AB_ORGANIGRAMM);

    kopfRef.current = kopf;
    fuehrungRef.current = fuehrung;
    rueckmeldRef.current = rueckmeld;
    eigeneLageRef.current = eigeneLage;
    nachforderungRef.current = nachforderung;
    organisationRef.current = organisation;
    organigrammRef.current = organigramm;

    const readSheet = (): ArbeitsblattState => ({
      kopf: {
        einsatzstichwort: stringValue(kopf, "einsatzstichwort"),
        einsatzort: stringValue(kopf, "einsatzort"),
        meldender: stringValue(kopf, "meldender"),
        objektnr: stringValue(kopf, "objektnr"),
        datumUhrzeitgruppe: stringValue(kopf, "datumUhrzeitgruppe"),
      },
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
      nachforderung: nachforderung.toJSON() as Partial<
        Record<AbNachforderungKey, AbNachforderungPosten>
      >,
      organisation: {
        viererKanal: stringValue(organisation, "viererKanal"),
        fuehrungsKanal: stringValue(organisation, "fuehrungsKanal"),
        zweierKanal: stringValue(organisation, "zweierKanal"),
        gebFunk: stringValue(organisation, "gebFunk"),
        eigeneFunktion: funktionValue(organisation, "eigeneFunktion"),
      },
      organigramm: organigramm
        .toArray()
        .map((row) => row.toJSON() as AbOrganigrammzeile),
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
      conn.destroy();
    };
  }, [session.room.id, session.token]);

  const setKopf = (field: AbKopfField, value: string) => {
    if (!writable) return;
    kopfRef.current?.set(field, value);
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
    link.download = `arbeitsblatt-${session.room.joinCode}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
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
        <div className="spacer" />
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
          <p>Zeigt die live-synchrone Lagekarte schreibgeschützt an.</p>
        </div>
        <div className="arbeitsblatt-lagebild">
          <Lagekarte session={session} embedded readOnly />
        </div>
      </section>
    </div>
  );
}
