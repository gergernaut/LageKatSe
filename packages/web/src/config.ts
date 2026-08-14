// Zentrale Auflösung der Grundkarten-Konfiguration (#96, Phase 1).
//
// Priorität: Laufzeit (public/config.js → window.__LAGEKATSE_CONFIG__)
//   → Build-Zeit (VITE_TILE_URL) → OSM-Public-Default.
// Die Laufzeit gewinnt, damit dasselbe gebaute Image LAN-, Internet- und
// Offline-Modus bedienen kann, ohne Neu-Build (Dual-Mode-Prinzip, #65).
//
// Die OSM-Attribution (ODbL) bleibt in JEDEM Fall der Default — auch ein
// selbst gehosteter Tile-Server nutzt i. d. R. OSM-Daten und muss sie führen.

type RuntimeConfig = {
  tileUrl?: string;
  tileMaxZoom?: number;
  tileAttribution?: string;
};

const runtime: RuntimeConfig =
  (typeof window !== "undefined" &&
    (window as unknown as { __LAGEKATSE_CONFIG__?: RuntimeConfig }).__LAGEKATSE_CONFIG__) ||
  {};

const OSM_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION = "&copy; OpenStreetMap-Mitwirkende";

export const tileConfig = {
  url: runtime.tileUrl || import.meta.env.VITE_TILE_URL || OSM_TILE_URL,
  maxZoom: runtime.tileMaxZoom ?? 19,
  attribution: runtime.tileAttribution || OSM_ATTRIBUTION,
};
