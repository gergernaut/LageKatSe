/**
 * Anwenden eines Einsatzabschnitte-Imports (JSON-Export bzw. Bundle) auf die
 * `abschnitte`-Y.Array. Geteilt vom Einzeldatei-Import (Einsatzabschnitte.tsx) und
 * dem Bundle-Import (importAll.ts). Frei von React — nur Yjs + geteilte Typen.
 *
 * Validierung/Coercion liegt in shared (`parseEinsatzabschnitteExport`), damit sie
 * unit-getestet ist; hier bleibt nur das CRDT-Schreiben.
 */
import * as Y from "yjs";
import type { Einsatzabschnitt } from "@lagekatse/shared";

/**
 * Spielt Abschnitte als **eine** Transaktion ein. `replace` leert die Liste zuvor
 * (Bundle-Restore / Einzeldatei-Ersetzen); ohne `replace` werden sie angehängt.
 */
export function applyEinsatzabschnitteImport(
  abschnitte: Y.Array<Y.Map<unknown>>,
  rows: Einsatzabschnitt[],
  opts: { replace: boolean },
): void {
  const apply = () => {
    if (opts.replace && abschnitte.length > 0) abschnitte.delete(0, abschnitte.length);
    for (const row of rows) {
      const map = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(row)) map.set(key, value);
      abschnitte.push([map]);
    }
  };
  const doc = abschnitte.doc;
  if (doc) doc.transact(apply);
  else apply();
}
