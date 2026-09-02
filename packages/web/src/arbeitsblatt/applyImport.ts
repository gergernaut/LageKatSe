/**
 * Spielt eine Übersicht (aus dem JSON-Export bzw. Bundle) als **eine**
 * CRDT-Transaktion in das `arbeitsblatt`-Dokument ein — geteilt von der Einzeldatei-
 * Import-Aktion (Arbeitsblatt.tsx) und dem Bundle-Import (importAll.ts), damit beide
 * Pfade nicht divergieren. Ersetzt den gesamten (geteilten!) Zustand.
 *
 * Bewusst frei von React/Leaflet — nur Yjs + geteilte Coercions, so bleibt der
 * Bundle-Import-Pfad schlank.
 */
import * as Y from "yjs";
import {
  AB_MASSNAHMEN,
  AB_KANAELE,
  AB_KANAL_FIELDS,
  AB_KOPF,
  AB_KOPF_FIELDS,
  AB_ORGANISATION,
  AB_RUECKMELD,
  AB_WETTER,
  AB_WETTER_SNAPSHOT,
  asBool,
  asKanalTyp,
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
 * Wendet `sheet` (roh, aus einer Fremddatei) atomar auf das Übersichts-Dokument an.
 * `newId` liefert IDs für Zeilen ohne eigene id (uid() aus dem Client — kein
 * crypto.randomUUID, Invariante #3).
 */
export function applyArbeitsblattImport(doc: Y.Doc, sheet: unknown, newId: () => string): void {
  const s = isRecord(sheet) ? sheet : {};
  const kopfObj = isRecord(s.kopf) ? s.kopf : {};
  const organisationObj = isRecord(s.organisation) ? s.organisation : {};
  const massnahmenObj = isRecord(s.massnahmen) ? s.massnahmen : {};
  const rueckArr = Array.isArray(s.rueckmeldungen) ? s.rueckmeldungen : [];
  const kanaeleArr = Array.isArray(s.kanaele) ? s.kanaele : [];

  const kopf = doc.getMap<unknown>(AB_KOPF);
  const massnahmen = doc.getMap<unknown>(AB_MASSNAHMEN);
  const rueck = doc.getArray<Y.Map<unknown>>(AB_RUECKMELD);
  const organisation = doc.getMap<unknown>(AB_ORGANISATION);
  const kanaele = doc.getArray<Y.Map<unknown>>(AB_KANAELE);
  const wetter = doc.getMap<unknown>(AB_WETTER);

  doc.transact(() => {
    // Feld A: Kopf-Skalare überschreiben
    AB_KOPF_FIELDS.forEach((f) => kopf.set(f, asString(kopfObj[f])));

    // Feld D (#163): Maßnahmen je Führungs-Auftrags-id (Map ersetzen). Die Aufträge
    // selbst kommen read-only aus dem EA-Modul und sind nicht Teil dieses Exports.
    for (const key of [...massnahmen.keys()]) massnahmen.delete(key);
    for (const [auftragId, v] of Object.entries(massnahmenObj)) {
      if (!isRecord(v)) continue;
      massnahmen.set(
        auftragId,
        rowMap({ massnahmen: asString(v.massnahmen), laufenderVorgang: asBool(v.laufenderVorgang) }),
      );
    }

    // Feld E: Notizen (Array ersetzen)
    rueck.delete(0, rueck.length);
    for (const r of rueckArr) {
      if (!isRecord(r)) continue;
      rueck.push([rowMap({ id: asString(r.id) || newId(), text: asString(r.text), erledigt: asBool(r.erledigt) })]);
    }

    // Feld F: feste Funkkanäle (Skalare)
    AB_KANAL_FIELDS.forEach((f) => organisation.set(f, asString(organisationObj[f])));

    // Feld F: frei angelegte Kanäle (Array ersetzen)
    kanaele.delete(0, kanaele.length);
    for (const r of kanaeleArr) {
      if (!isRecord(r)) continue;
      kanaele.push([
        rowMap({
          id: asString(r.id) || newId(),
          typ: asKanalTyp(r.typ),
          gruppe: asString(r.gruppe),
          verwendungszweck: asString(r.verwendungszweck),
        }),
      ]);
    }

    // Rückseite: Wetter-Snapshot (Whole-Value) übernehmen oder leeren
    if (isRecord(s.wetter)) wetter.set(AB_WETTER_SNAPSHOT, s.wetter);
    else wetter.delete(AB_WETTER_SNAPSHOT);
  });
}
