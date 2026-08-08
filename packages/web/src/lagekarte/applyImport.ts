/**
 * Validierung + Anwenden eines Lagekarten-Imports (JSON-Export bzw. Bundle) auf die
 * `features`-Y.Map. Geteilt von der Einzeldatei-Import-Aktion (Lagekarte.tsx) und dem
 * Bundle-Import (importAll.ts). Frei von React/Leaflet — nur Yjs + geteilte Typen.
 *
 * Die reinen Feature-Validatoren leben hier (nicht in der Leaflet-Komponente), damit
 * der Bundle-Import-Pfad kein Leaflet mitzieht; Lagekarte.tsx importiert sie zurück.
 */
import * as Y from "yjs";
import type { MapFeature } from "@lagekatse/shared";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isCoordinate(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

export function isMapFeature(value: unknown): value is MapFeature {
  if (!isRecord(value) || typeof value.id !== "string") return false;

  if (value.kind === "symbol") {
    return typeof value.symbolId === "string" && isCoordinate(value.position);
  }

  if (value.kind === "area") {
    return (
      (value.shape === "polygon" || value.shape === "rectangle" || value.shape === "circle") &&
      Array.isArray(value.geometry) &&
      value.geometry.every(isCoordinate)
    );
  }

  return false;
}

/**
 * Prüft den Export-Envelope und filtert gültige Features. `null` = ungültiges
 * Dateiformat; sonst die gültigen Features plus die Gesamtzahl (für „n ungültig").
 */
export function parseLagekarteFeatures(
  payload: unknown,
): { valid: MapFeature[]; total: number } | null {
  if (!isRecord(payload) || payload.format !== "lagekatse.lagekarte" || !Array.isArray(payload.features)) {
    return null;
  }
  return { valid: payload.features.filter(isMapFeature), total: payload.features.length };
}

/**
 * Spielt Features als **eine** Transaktion ein. `replace` leert die Karte zuvor
 * (Bundle-Restore); ohne `replace` werden sie in den Bestand gemischt (per id-set,
 * wie der bisherige Einzeldatei-Import).
 */
export function applyLagekarteImport(
  featuresMap: Y.Map<MapFeature>,
  features: MapFeature[],
  opts: { replace: boolean },
): void {
  const apply = () => {
    if (opts.replace) [...featuresMap.keys()].forEach((k) => featuresMap.delete(k));
    for (const feature of features) featuresMap.set(feature.id, feature);
  };
  const doc = featuresMap.doc;
  if (doc) doc.transact(apply);
  else apply();
}
