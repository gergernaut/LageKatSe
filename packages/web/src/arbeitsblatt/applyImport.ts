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
  AB_AUFTRAEGE,
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
  const auftraegeArr = Array.isArray(s.auftraege) ? s.auftraege : [];
  const rueckArr = Array.isArray(s.rueckmeldungen) ? s.rueckmeldungen : [];
  const kanaeleArr = Array.isArray(s.kanaele) ? s.kanaele : [];

  const kopf = doc.getMap<unknown>(AB_KOPF);
  const auftraege = doc.getArray<Y.Map<unknown>>(AB_AUFTRAEGE);
  const rueck = doc.getArray<Y.Map<unknown>>(AB_RUECKMELD);
  const organisation = doc.getMap<unknown>(AB_ORGANISATION);
  const kanaele = doc.getArray<Y.Map<unknown>>(AB_KANAELE);
  const wetter = doc.getMap<unknown>(AB_WETTER);

  doc.transact(() => {
    // Feld A: Kopf-Skalare überschreiben
    AB_KOPF_FIELDS.forEach((f) => kopf.set(f, asString(kopfObj[f])));

    // Feld D: Aufträge & Maßnahmen (Array ersetzen)
    auftraege.delete(0, auftraege.length);
    for (const r of auftraegeArr) {
      if (!isRecord(r)) continue;
      auftraege.push([
        rowMap({
          id: asString(r.id) || newId(),
          auftrag: asString(r.auftrag),
          massnahmen: asString(r.massnahmen),
          laufenderVorgang: asBool(r.laufenderVorgang),
          erledigt: asBool(r.erledigt),
        }),
      ]);
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
