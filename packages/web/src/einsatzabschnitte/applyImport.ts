/**
 * Anwenden eines Einsatzabschnitte-Imports (JSON-Export bzw. Bundle) auf die
 * `abschnitte`-Y.Array. Geteilt vom Einzeldatei-Import (Einsatzabschnitte.tsx) und
 * dem Bundle-Import (importAll.ts). Frei von React — nur Yjs + geteilte Typen.
 *
 * Validierung/Coercion liegt in shared (`parseEinsatzabschnitteExport`), damit sie
 * unit-getestet ist; hier bleibt nur das CRDT-Schreiben.
 */
import * as Y from "yjs";
import { EA_FUEHRUNG, type Einsatzabschnitt, type Fuehrung } from "@lagekatse/shared";

/**
 * Spielt Abschnitte (und optional den Führungs-Singleton, #154) als **eine**
 * Transaktion ein. `replace` leert die Liste zuvor (Bundle-Restore / Einzeldatei-
 * Ersetzen); ohne `replace` werden sie angehängt. Die Führung wird — wenn
 * übergeben — immer ersetzt (es gibt genau eine).
 */
export function applyEinsatzabschnitteImport(
  abschnitte: Y.Array<Y.Map<unknown>>,
  rows: Einsatzabschnitt[],
  opts: { replace: boolean; fuehrung?: Fuehrung },
): void {
  const apply = () => {
    if (opts.replace && abschnitte.length > 0) abschnitte.delete(0, abschnitte.length);
    for (const row of rows) {
      const map = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(row)) map.set(key, value);
      abschnitte.push([map]);
    }
    if (opts.fuehrung && doc) {
      const fuehrung = doc.getMap<unknown>(EA_FUEHRUNG);
      for (const [key, value] of Object.entries(opts.fuehrung)) fuehrung.set(key, value);
    }
  };
  const doc = abschnitte.doc;
  if (doc) doc.transact(apply);
  else apply();
}
