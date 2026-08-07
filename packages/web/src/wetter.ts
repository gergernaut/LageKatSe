/**
 * Wetterabruf für die Rückseite des Arbeitsblatts (#44 Teil 2 / Wetter-Teil #42).
 *
 * Quelle: **BrightSky** (DWD OpenData), CORS-offen und ohne Key — ein Anbieter
 * deckt aktuelles Wetter, stündliche Vorhersage und DWD-Warnungen ab:
 *   /current_weather  Momentanwerte (Wind/Niederschlag in den _10-Feldern)
 *   /weather          stündliche Werte für einen Tagesbereich → nächste ~4 h
 *   /alerts           aktive DWD-Warnungen (CAP)
 *
 * Reine Client-Funktion; das Ergebnis wird als geteilter Snapshot ins Arbeitsblatt-
 * CRDT geschrieben. Härtung wie beim KONRAD3D-Fix (#56): Timeout via AbortController,
 * res.ok + Content-Type prüfen statt blindem res.json().
 */
import type {
  AbWetterAlert,
  AbWetterCurrent,
  AbWetterForecastHour,
  AbWetterSeverity,
  AbWetterSnapshot,
} from "@lagekatse/shared";

const BASE = "https://api.brightsky.dev";
const TIMEOUT_MS = 8000;
const FORECAST_HOURS = 4;

function rec(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal });
  const ct = res.headers.get("content-type") ?? "";
  if (!res.ok || !ct.includes("json")) {
    const body = await res.text();
    throw new Error(`BrightSky HTTP ${res.status} (${ct || "ohne Content-Type"}): ${body.slice(0, 120)}`);
  }
  return res.json();
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function mapCurrent(raw: unknown): AbWetterCurrent {
  const w = rec(rec(raw).weather);
  return {
    temperature: num(w.temperature),
    windSpeed: num(w.wind_speed_10),
    windDirection: num(w.wind_direction_10),
    windGust: num(w.wind_gust_speed_10),
    precipitation: num(w.precipitation_10),
    cloudCover: num(w.cloud_cover),
    pressure: num(w.pressure_msl),
    humidity: num(w.relative_humidity),
    condition: str(w.condition),
    icon: str(w.icon),
  };
}

function stationName(raw: unknown): string | null {
  const sources = arr(rec(raw).sources);
  return sources.length > 0 ? str(rec(sources[0]).station_name) : null;
}

function mapForecast(raw: unknown, now: Date): AbWetterForecastHour[] {
  // Ab der aktuellen (angebrochenen) Stunde bis zu FORECAST_HOURS Stundenwerte.
  const fromMs = new Date(now).setMinutes(0, 0, 0);
  return arr(rec(raw).weather)
    .map(rec)
    .filter((h) => {
      const t = Date.parse(String(h.timestamp));
      return Number.isFinite(t) && t >= fromMs;
    })
    .sort((a, b) => Date.parse(String(a.timestamp)) - Date.parse(String(b.timestamp)))
    .slice(0, FORECAST_HOURS)
    .map((h) => ({
      time: String(h.timestamp),
      temperature: num(h.temperature),
      windSpeed: num(h.wind_speed),
      precipitation: num(h.precipitation),
      precipitationProbability: num(h.precipitation_probability),
      condition: str(h.condition),
      icon: str(h.icon),
    }));
}

function mapSeverity(value: unknown): AbWetterSeverity {
  return value === "minor" || value === "moderate" || value === "severe" || value === "extreme"
    ? value
    : null;
}

function mapAlerts(raw: unknown): AbWetterAlert[] {
  return arr(rec(raw).alerts).map(rec).map((a) => {
    const event = str(a.event_de) ?? str(a.event_en);
    const onset = str(a.onset);
    return {
      id: String(a.alert_id ?? a.id ?? `${event ?? "warnung"}-${onset ?? ""}`),
      event,
      severity: mapSeverity(a.severity),
      headline: str(a.headline_de) ?? str(a.headline_en),
      description: (str(a.description_de) ?? str(a.description_en))?.slice(0, 400) ?? null,
      onset,
      expires: str(a.expires),
    };
  });
}

/**
 * Ruft einen Wetter-Snapshot für die gegebenen Koordinaten (Kartenmitte) ab.
 * `current` ist Pflicht — schlägt der Abruf fehl, wirft die Funktion. Vorhersage
 * und Warnungen sind best-effort (fallen bei Fehler auf leere Liste zurück), damit
 * eine Teil-Störung nicht die ganze Anzeige verhindert.
 */
export async function fetchWetter(lat: number, lon: number): Promise<AbWetterSnapshot> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const now = new Date();
    const q = `lat=${lat}&lon=${lon}`;
    const forecastUrl = `${BASE}/weather?${q}&date=${isoDate(now)}&last_date=${isoDate(
      new Date(now.getTime() + 24 * 3600 * 1000),
    )}`;

    const [currentRaw, forecastRaw, alertsRaw] = await Promise.all([
      getJson(`${BASE}/current_weather?${q}`, controller.signal),
      getJson(forecastUrl, controller.signal).catch(() => null),
      getJson(`${BASE}/alerts?${q}`, controller.signal).catch(() => null),
    ]);

    return {
      fetchedAt: now.toISOString(),
      lat,
      lon,
      stationName: stationName(currentRaw),
      current: mapCurrent(currentRaw),
      forecast: forecastRaw ? mapForecast(forecastRaw, now) : [],
      alerts: alertsRaw ? mapAlerts(alertsRaw) : [],
    };
  } finally {
    clearTimeout(timer);
  }
}
