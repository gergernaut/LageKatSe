/**
 * Data model for the shared situation map (module "lagekarte").
 *
 * The `lagekarte` Yjs document holds one Y.Map named LAGEKARTE_FEATURES, keyed
 * by feature id; each value is a plain SymbolFeature | AreaFeature object set
 * via Y.Map.set (per-feature last-write-wins on the whole value). Coordinates
 * are WGS84 [lat, lng] so they map directly onto OpenStreetMap.
 */
export const LAGEKARTE_FEATURES = "features" as const;

/** A placed tactical sign (DV 102), referencing a symbol from the CC0 index. */
export interface SymbolFeature {
  id: string;
  kind: "symbol";
  /** id into the tactical-sign index (index.json), e.g. "Feuerwehr_Fahrzeuge/Kraftfahrzeug". */
  symbolId: string;
  position: [number, number]; // [lat, lng]
  rotation: number; // degrees, 0 = north
  label?: string;
  description?: string; // shown as tooltip on hover
  createdBy: string;
  createdAt: string; // ISO-8601
  updatedAt: string;
}

/** A masked area on the map (damage area, staging area, …). */
export interface AreaFeature {
  id: string;
  kind: "area";
  shape: "polygon" | "rectangle" | "circle";
  /** polygon/rectangle: ring of [lat,lng]; circle: single [lat,lng] centre + radiusM. */
  geometry: [number, number][];
  radiusM?: number; // circle only, metres
  color: string; // e.g. "#d5372b"
  opacity: number; // fill opacity 0..1
  label?: string;
  description?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type MapFeature = SymbolFeature | AreaFeature;

/** Optional persisted viewport (used by import/export). */
export interface MapView {
  center: [number, number];
  zoom: number;
}
