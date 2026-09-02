/**
 * Anwenden eines Einsatzabschnitte-Imports (JSON-Export bzw. Bundle) auf die
 * `abschnitte`-Y.Array. Geteilt vom Einzeldatei-Import (Einsatzabschnitte.tsx) und
 * dem Bundle-Import (importAll.ts). Frei von React — nur Yjs + geteilte Typen.
 *
 * Validierung/Coercion liegt in shared (`parseEinsatzabschnitteExport`), damit sie
 * unit-getestet ist; hier bleibt nur das CRDT-Schreiben.
 */
import * as Y from "yjs";
import {
  EA_BEREITSTELLUNG,
  EA_FUEHRUNG,
  EA_FUEHRUNG_AUFTRAEGE,
  EA_LISTS,
  type Bereitstellung,
  type EaListItem,
  type Einsatzabschnitt,
  type Fuehrung,
} from "@lagekatse/shared";

/**
 * Baut die Abschnitts-Y.Map aus einem (ggf. importierten) Plain-Objekt. Die drei
 * Listen (#161) werden als **verschachtelte** Y.Array<Y.Map> angelegt, damit
 * Abhaken/Editieren item-level mergen (nicht Whole-Value-LWW). Geteilt von der
 * Anlage (Einsatzabschnitte.tsx) und dem Import.
 */
/** Eine Listen-Zeile als Y.Map — inkl. optionalem Zeitstempel/„übermittelt" (#180),
 *  originalgetreu erhalten (fehlende Felder bleiben weg). */
function listItemToYMap(item: EaListItem): Y.Map<unknown> {
  const im = new Y.Map<unknown>();
  im.set("id", item.id);
  im.set("text", item.text);
  im.set("erledigt", item.erledigt);
  if (item.createdAt) im.set("createdAt", item.createdAt);
  if (item.uebermittelt) im.set("uebermittelt", true);
  return im;
}

export function abschnittToYMap(a: Einsatzabschnitt): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  const listKeys = EA_LISTS as readonly string[];
  for (const [key, value] of Object.entries(a)) {
    if (listKeys.includes(key)) {
      const arr = new Y.Array<Y.Map<unknown>>();
      for (const item of value as EaListItem[]) arr.push([listItemToYMap(item)]);
      map.set(key, arr);
    } else {
      map.set(key, value);
    }
  }
  return map;
}

/**
 * Spielt Abschnitte (und optional den Führungs-Singleton samt Auftrags-Liste,
 * #154/#177) als **eine** Transaktion ein. `replace` leert die Liste zuvor
 * (Bundle-Restore / Einzeldatei-Ersetzen); ohne `replace` werden sie angehängt.
 * Die Führung wird — wenn übergeben — immer ersetzt (es gibt genau eine).
 */
export function applyEinsatzabschnitteImport(
  abschnitte: Y.Array<Y.Map<unknown>>,
  rows: Einsatzabschnitt[],
  opts: {
    replace: boolean;
    fuehrung?: Fuehrung;
    fuehrungAuftraege?: EaListItem[];
    bereitstellung?: Bereitstellung;
  },
): void {
  const apply = () => {
    if (opts.replace && abschnitte.length > 0) abschnitte.delete(0, abschnitte.length);
    for (const row of rows) {
      abschnitte.push([abschnittToYMap(row)]);
    }
    if (opts.fuehrung && doc) {
      const fuehrung = doc.getMap<unknown>(EA_FUEHRUNG);
      for (const [key, value] of Object.entries(opts.fuehrung)) fuehrung.set(key, value);
    }
    // Auftrags-Liste der Führung (#177) als verschachtelte Y.Array ersetzen —
    // nur wenn übergeben (ältere Importe ohne bleiben unangetastet).
    if (opts.fuehrungAuftraege && doc) {
      const fuehrung = doc.getMap<unknown>(EA_FUEHRUNG);
      const arr = new Y.Array<Y.Map<unknown>>();
      for (const item of opts.fuehrungAuftraege) arr.push([listItemToYMap(item)]);
      fuehrung.set(EA_FUEHRUNG_AUFTRAEGE, arr);
    }
    // Bereitstellungsraum-Singleton (#180): Felder + drei verschachtelte Listen
    // ersetzen — nur wenn übergeben (ältere Importe ohne bleiben unangetastet).
    if (opts.bereitstellung && doc) {
      const br = doc.getMap<unknown>(EA_BEREITSTELLUNG);
      const listKeys = EA_LISTS as readonly string[];
      for (const [key, value] of Object.entries(opts.bereitstellung)) {
        if (listKeys.includes(key)) {
          const arr = new Y.Array<Y.Map<unknown>>();
          for (const item of value as EaListItem[]) arr.push([listItemToYMap(item)]);
          br.set(key, arr);
        } else {
          br.set(key, value);
        }
      }
    }
  };
  const doc = abschnitte.doc;
  if (doc) doc.transact(apply);
  else apply();
}
