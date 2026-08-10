/**
 * Pegelstände-Datenlayer (#84) für den zuschaltbaren Lagekarte-Overlay.
 *
 * Quelle: **PEGELONLINE** (Wasserstraßen- und Schifffahrtsverwaltung des Bundes),
 * CORS-offen und ohne Key. Ein Aufruf liefert alle Stationen mit Koordinaten und
 * aktuellem Wasserstand:
 *   /stations.json?includeCurrentMeasurement=true&includeTimeseries=true
 * Je Station nutzen wir die W-Zeitreihe (Wasserstand) mit `currentMeasurement`
 * (value/unit/timestamp) und der API-eigenen Status-Klassifikation `stateMnwMhw`
 * (relativ zu mittlerem Niedrig-/Hochwasser) für die Einfärbung.
 *
 * Reine Client-Funktion (Anzeige-Overlay, Invariante #4 — nicht im CRDT). Härtung
 * wie bei wetter.ts / KONRAD3D-Fix (#56): Timeout via AbortController, res.ok +
 * Content-Type prüfen statt blindem res.json(). Die Werte sind **Rohdaten** (WSV)
 * und je Pegel unterschiedlich bezogen — immer mit der API-Einheit anzeigen.
 */

const BASE = "https://www.pegelonline.wsv.de/webservices/rest-api/v2";
const TIMEOUT_MS = 10000;

/** Status aus PEGELONLINE (`stateMnwMhw`), relativ zu mittlerem Niedrig-/Hochwasser. */
export type PegelState = "low" | "normal" | "high" | "unknown" | "commented";

const PEGEL_STATES: readonly PegelState[] = ["low", "normal", "high", "unknown", "commented"];

/** Ein Pegel mit aktuellem Wasserstand, auf das Nötige reduziert. */
export interface PegelStation {
  uuid: string;
  name: string; // longname, z.B. "CELLE"
  water: string; // Gewässer, z.B. "ALLER"
  lat: number;
  lon: number;
  value: number; // aktueller Wasserstand
  unit: string; // z.B. "cm" | "m+NN" | "m+PNP" (variiert je Pegel!)
  timestamp: string; // ISO-8601, Zeitpunkt der Messung
  state: PegelState;
}

/** Punktfarbe je Status — konkrete Hex-Werte (Canvas löst keine CSS-Variablen auf),
 *  abgestimmt auf die App-Palette (--danger/--ok/--forces/--ink-3). */
const STATUS_COLORS: Record<PegelState, string> = {
  high: "#d5372b", // Hochwasser — rot (--danger)
  normal: "#2e9e5b", // normal — grün (--ok)
  low: "#2f6bd8", // Niedrigwasser — blau (--forces)
  unknown: "#7c8da0", // keine Klassifikation — grau (--ink-3)
  commented: "#7c8da0",
};

export const PEGEL_STATUS_LABEL: Record<PegelState, string> = {
  high: "Hochwasser",
  normal: "Normal",
  low: "Niedrigwasser",
  unknown: "unbekannt",
  commented: "kommentiert",
};

export function pegelStatusColor(state: PegelState): string {
  return STATUS_COLORS[state] ?? STATUS_COLORS.unknown;
}

function rec(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
function asState(value: unknown): PegelState {
  return (PEGEL_STATES as readonly unknown[]).includes(value) ? (value as PegelState) : "unknown";
}

/**
 * Koerziert die rohe PEGELONLINE-Antwort defensiv auf `PegelStation[]`. Übersprungen
 * werden Stationen ohne Koordinaten oder ohne W-Wasserstand mit gültigem Messwert.
 * Pure/exportiert für Unit-Tests (kein Netz).
 */
export function coercePegelStations(raw: unknown): PegelStation[] {
  const out: PegelStation[] = [];
  const list = Array.isArray(raw) ? raw : [];
  for (const item of list) {
    const s = rec(item);
    const lat = s.latitude;
    const lon = s.longitude;
    if (typeof lat !== "number" || !Number.isFinite(lat)) continue;
    if (typeof lon !== "number" || !Number.isFinite(lon)) continue;

    const series = Array.isArray(s.timeseries) ? s.timeseries.map(rec) : [];
    const w = series.find((t) => t.shortname === "W" && rec(t.currentMeasurement).value !== undefined);
    if (!w) continue;
    const cm = rec(w.currentMeasurement);
    if (typeof cm.value !== "number" || !Number.isFinite(cm.value)) continue;

    const uuid = typeof s.uuid === "string" ? s.uuid : "";
    if (!uuid) continue;

    out.push({
      uuid,
      name: typeof s.longname === "string" ? s.longname : typeof s.shortname === "string" ? s.shortname : uuid,
      water: typeof rec(s.water).longname === "string" ? (rec(s.water).longname as string) : "",
      lat,
      lon,
      value: cm.value,
      unit: typeof w.unit === "string" ? w.unit : "",
      timestamp: typeof cm.timestamp === "string" ? cm.timestamp : "",
      state: asState(cm.stateMnwMhw),
    });
  }
  return out;
}

/** Ruft die aktuellen Pegelstände ab (mit Timeout). `external` bricht zusätzlich ab. */
export async function fetchPegelStations(external?: AbortSignal): Promise<PegelStation[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  external?.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    const url = `${BASE}/stations.json?includeCurrentMeasurement=true&includeTimeseries=true`;
    const res = await fetch(url, { signal: controller.signal });
    const ct = res.headers.get("content-type") ?? "";
    if (!res.ok || !ct.includes("json")) {
      const body = await res.text();
      throw new Error(`PEGELONLINE HTTP ${res.status} (${ct || "ohne Content-Type"}): ${body.slice(0, 120)}`);
    }
    return coercePegelStations(await res.json());
  } finally {
    clearTimeout(timer);
  }
}
