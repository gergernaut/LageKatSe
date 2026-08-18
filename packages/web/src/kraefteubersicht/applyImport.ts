/**
 * Anwenden eines Kräfteübersicht-Imports (JSON-Export bzw. Bundle) auf die
 * `vehicles`-Y.Array. Geteilt vom Einzeldatei-Import (Kraefteubersicht.tsx) und
 * dem Bundle-Import (importAll.ts). Frei von React — nur Yjs + geteilte Typen.
 *
 * Die Validierung/Coercion liegt in shared (`parseKraftExport`), damit sie
 * unit-getestet ist; hier bleibt nur das CRDT-Schreiben.
 */
import * as Y from "yjs";
import type { KraftVehicle } from "@lagekatse/shared";

/**
 * Spielt Fahrzeuge als **eine** Transaktion ein. `replace` leert die Liste zuvor
 * (Bundle-Restore); ohne `replace` werden sie angehängt.
 */
export function applyKraftImport(
  vehicles: Y.Array<Y.Map<unknown>>,
  rows: KraftVehicle[],
  opts: { replace: boolean },
): void {
  const apply = () => {
    if (opts.replace && vehicles.length > 0) vehicles.delete(0, vehicles.length);
    for (const row of rows) {
      const map = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(row)) map.set(key, value);
      vehicles.push([map]);
    }
  };
  const doc = vehicles.doc;
  if (doc) doc.transact(apply);
  else apply();
}
