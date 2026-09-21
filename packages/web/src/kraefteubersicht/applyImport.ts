/**
 * Anwenden eines Kräfteübersicht-Imports (JSON-Export bzw. Bundle) auf die
 * `vehicles`-Y.Array. Geteilt vom Einzeldatei-Import (Kraefteubersicht.tsx) und
 * dem Bundle-Import (importAll.ts). Frei von React — nur Yjs + geteilte Typen.
 *
 * Die Validierung/Coercion liegt in shared (`parseKraftExport`), damit sie
 * unit-getestet ist; hier bleibt nur das CRDT-Schreiben.
 */
import * as Y from "yjs";
import { KRAFT_HISTORY, type KraftHistoryEntry, type KraftVehicle } from "@lagekatse/shared";

/**
 * Spielt Fahrzeuge als **eine** Transaktion ein. `replace` leert die Liste zuvor
 * (Bundle-Restore); ohne `replace` werden sie angehängt. Optional wird die
 * Verschiebe-Historie (#227) im selben Dokument mit-ersetzt (nur wenn übergeben —
 * ältere Exporte ohne bleiben unangetastet).
 */
export function applyKraftImport(
  vehicles: Y.Array<Y.Map<unknown>>,
  rows: KraftVehicle[],
  opts: { replace: boolean; history?: KraftHistoryEntry[] },
): void {
  const apply = () => {
    if (opts.replace && vehicles.length > 0) vehicles.delete(0, vehicles.length);
    for (const row of rows) {
      const map = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(row)) map.set(key, value);
      vehicles.push([map]);
    }
    // Historie im selben Dokument ersetzen (#227), wenn im Export vorhanden.
    const doc = vehicles.doc;
    if (opts.history && doc) {
      const historyArr = doc.getArray<Y.Map<unknown>>(KRAFT_HISTORY);
      if (historyArr.length > 0) historyArr.delete(0, historyArr.length);
      for (const entry of opts.history) {
        const map = new Y.Map<unknown>();
        for (const [key, value] of Object.entries(entry)) map.set(key, value);
        historyArr.push([map]);
      }
    }
  };
  const doc = vehicles.doc;
  if (doc) doc.transact(apply);
  else apply();
}
