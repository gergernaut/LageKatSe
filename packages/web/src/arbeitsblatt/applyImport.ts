/**
 * Spielt ein Arbeitsblatt-Sheet (aus dem JSON-Export bzw. Bundle) als **eine**
 * CRDT-Transaktion in das `arbeitsblatt`-Dokument ein — geteilt von der Einzeldatei-
 * Import-Aktion (Arbeitsblatt.tsx) und dem Bundle-Import (importAll.ts), damit beide
 * Pfade nicht divergieren. Ersetzt den gesamten (geteilten!) Zustand.
 *
 * Bewusst frei von React/Leaflet — nur Yjs + geteilte Coercions, so bleibt der
 * Bundle-Import-Pfad schlank.
 */
import * as Y from "yjs";
import {
  AB_EIGENELAGE,
  AB_FUEHRUNG,
  AB_GEFAHREN,
  AB_GEFAHREN_KATALOG,
  AB_KANAL_FIELDS,
  AB_KOPF,
  AB_KOPF_FIELDS,
  AB_NACHFORDERUNG,
  AB_ORGANIGRAMM,
  AB_ORGANISATION,
  AB_RUECKMELD,
  AB_WETTER,
  AB_WETTER_SNAPSHOT,
  asBool,
  asFunktion,
  asPrio,
  asString,
  isRecord,
} from "@lagekatse/shared";

/** Baut eine Y.Map-Zeile aus einem einfachen Objekt (für die Array-Felder). */
function rowMap(entries: Record<string, unknown>): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  Object.entries(entries).forEach(([key, value]) => map.set(key, value));
  return map;
}

/**
 * Wendet `sheet` (roh, aus einer Fremddatei) atomar auf das Arbeitsblatt-Dokument an.
 * `newId` liefert IDs für Zeilen ohne eigene id (uid() aus dem Client — kein
 * crypto.randomUUID, Invariante #3).
 */
export function applyArbeitsblattImport(doc: Y.Doc, sheet: unknown, newId: () => string): void {
  const s = isRecord(sheet) ? sheet : {};
  const kopfObj = isRecord(s.kopf) ? s.kopf : {};
  const gefahrenObj = isRecord(s.gefahren) ? s.gefahren : {};
  const eigeneLageObj = isRecord(s.eigeneLage) ? s.eigeneLage : {};
  const organisationObj = isRecord(s.organisation) ? s.organisation : {};
  const fuehrungArr = Array.isArray(s.fuehrungsvorgang) ? s.fuehrungsvorgang : [];
  const rueckArr = Array.isArray(s.rueckmeldungen) ? s.rueckmeldungen : [];
  const nachArr = Array.isArray(s.nachforderung) ? s.nachforderung : [];
  const orgaArr = Array.isArray(s.organigramm) ? s.organigramm : [];

  const kopf = doc.getMap<unknown>(AB_KOPF);
  const gefahren = doc.getMap<unknown>(AB_GEFAHREN);
  const fuehrung = doc.getArray<Y.Map<unknown>>(AB_FUEHRUNG);
  const rueck = doc.getArray<Y.Map<unknown>>(AB_RUECKMELD);
  const eigeneLage = doc.getMap<unknown>(AB_EIGENELAGE);
  const nach = doc.getArray<Y.Map<unknown>>(AB_NACHFORDERUNG);
  const organisation = doc.getMap<unknown>(AB_ORGANISATION);
  const organigramm = doc.getArray<Y.Map<unknown>>(AB_ORGANIGRAMM);
  const wetter = doc.getMap<unknown>(AB_WETTER);

  doc.transact(() => {
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
          id: asString(r.id) || newId(),
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
      rueck.push([rowMap({ id: asString(r.id) || newId(), text: asString(r.text), erledigt: asBool(r.erledigt) })]);
    }

    // Feld E: eigene Lage (Skalare) + Nachforderung (Array)
    eigeneLage.set("auftragMr", asBool(eigeneLageObj.auftragMr));
    eigeneLage.set("auftragBb", asBool(eigeneLageObj.auftragBb));
    eigeneLage.set("auftragText", asString(eigeneLageObj.auftragText));
    eigeneLage.set("kraefteuebersicht", asString(eigeneLageObj.kraefteuebersicht));
    nach.delete(0, nach.length);
    for (const r of nachArr) {
      if (!isRecord(r)) continue;
      nach.push([rowMap({ id: asString(r.id) || newId(), text: asString(r.text) })]);
    }

    // Feld F: Organisation (Skalare) + Organigramm (Array)
    AB_KANAL_FIELDS.forEach((f) => organisation.set(f, asString(organisationObj[f])));
    organisation.set("eigeneFunktion", asFunktion(organisationObj.eigeneFunktion));
    organigramm.delete(0, organigramm.length);
    for (const r of orgaArr) {
      if (!isRecord(r)) continue;
      organigramm.push([
        rowMap({
          id: asString(r.id) || newId(),
          rolle: asString(r.rolle),
          auftrag: asString(r.auftrag),
          fuehrer: asString(r.fuehrer),
          rufname: asString(r.rufname),
        }),
      ]);
    }

    // Rückseite: Wetter-Snapshot (Whole-Value) übernehmen oder leeren
    if (isRecord(s.wetter)) wetter.set(AB_WETTER_SNAPSHOT, s.wetter);
    else wetter.delete(AB_WETTER_SNAPSHOT);
  });
}
