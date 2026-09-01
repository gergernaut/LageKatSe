/**
 * Distanz-Formatierung für das Mess-Tool (#175). Rein & testbar — Leaflets
 * `map.distance()` liefert Großkreis-Meter (WGS84), hier nur die menschenlesbare
 * Aufbereitung: < 1000 m in Metern, darunter in Kilometern (eine Nachkommastelle).
 */

/** Formatiert eine Distanz in Metern (z. B. 450 → "450 m", 2340 → "2,3 km"). */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
}
