/**
 * Wetter-Panel der Arbeitsblatt-Rückseite (#44 Teil 2 / Wetter-Teil #42).
 *
 * Zeigt den **geteilten** Wetter-Snapshot (aktuelle Werte, 4-h-Trend, DWD-Warnungen)
 * für die Kartenmitte des Lagebilds. Ein schreibberechtigter Nutzer ruft ab → der
 * Snapshot geht via `onSnapshot` ins CRDT (Invariante #1) → alle (auch RO-Monitore)
 * sehen dasselbe. Zusätzlich: leiser Auto-Refresh (Staleness-Check) und ein aktiver
 * Warnhinweis bei neuer Warnung (OS-Notification nur im secure context — sonst nur
 * Banner + der ohnehin ausgelöste Arbeitsblatt-Aktivitäts-Dot).
 */
import { useEffect, useRef, useState } from "react";
import type { AbWetterAlert, AbWetterSnapshot } from "@lagekatse/shared";
import { fetchWetter } from "../wetter";

interface WetterProps {
  snapshot: AbWetterSnapshot | null;
  writable: boolean;
  roomId: string;
  onSnapshot: (snapshot: AbWetterSnapshot) => void;
  onWriteEtb: (inhalt: string) => Promise<void>;
}

const STALE_MS = 10 * 60 * 1000; // Auto-Refresh, wenn der Snapshot älter ist
const MAP_VIEW_KEY_PREFIX = "lagekatse.mapView."; // vgl. Lagekarte.tsx (#46)
const SEEN_ALERTS_KEY_PREFIX = "lagekatse.wetterSeen."; // client-lokal (Invariante #4)
const DEFAULT_CENTER = { lat: 51.163, lon: 10.448 }; // geografische Mitte Deutschlands

function loadMapCenter(roomId: string): { lat: number; lon: number } {
  try {
    const raw = localStorage.getItem(MAP_VIEW_KEY_PREFIX + roomId);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      const center = (parsed as { center?: unknown })?.center;
      if (
        Array.isArray(center) &&
        typeof center[0] === "number" &&
        typeof center[1] === "number"
      ) {
        return { lat: center[0], lon: center[1] };
      }
    }
  } catch {
    // Fällt unten auf die Deutschland-Mitte zurück.
  }
  return DEFAULT_CENTER;
}

function loadSeenAlerts(roomId: string): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_ALERTS_KEY_PREFIX + roomId);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed.filter((x): x is string => typeof x === "string"));
    }
  } catch {
    // ignorieren
  }
  return new Set();
}

function saveSeenAlerts(roomId: string, seen: Set<string>): void {
  try {
    localStorage.setItem(SEEN_ALERTS_KEY_PREFIX + roomId, JSON.stringify([...seen]));
  } catch {
    // Storage nicht verfügbar — Dedup greift dann nur innerhalb der Sitzung.
  }
}

const CONDITION_LABELS: Record<string, string> = {
  dry: "trocken",
  fog: "Nebel",
  rain: "Regen",
  sleet: "Schneeregen",
  snow: "Schnee",
  hail: "Hagel",
  thunderstorm: "Gewitter",
  wind: "windig",
};

const ICON_EMOJI: Record<string, string> = {
  "clear-day": "☀️",
  "clear-night": "🌙",
  "partly-cloudy-day": "⛅",
  "partly-cloudy-night": "☁️",
  cloudy: "☁️",
  fog: "🌫️",
  wind: "💨",
  rain: "🌧️",
  sleet: "🌨️",
  snow: "❄️",
  hail: "🌨️",
  thunderstorm: "⛈️",
};

const SEVERITY_RANK: Record<string, number> = { extreme: 4, severe: 3, moderate: 2, minor: 1 };
const SEVERITY_LABEL: Record<string, string> = {
  extreme: "extrem",
  severe: "schwer",
  moderate: "mäßig",
  minor: "gering",
};

function conditionLabel(condition: string | null): string {
  if (!condition) return "—";
  return CONDITION_LABELS[condition] ?? condition;
}
function iconEmoji(icon: string | null): string {
  return (icon && ICON_EMOJI[icon]) || "🌡️";
}
function compass(deg: number | null): string {
  if (deg === null) return "";
  const dirs = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}
function fmt(value: number | null, unit: string, digits = 0): string {
  return value === null ? "—" : `${digits > 0 ? value.toFixed(digits) : Math.round(value)} ${unit}`;
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}
function fmtHour(iso: string): string {
  // Reine 2-stellige Stunde; das "Uhr" hängt das JSX an (de-DE-Locale würde
  // sonst selbst schon "11 Uhr" liefern → doppeltes "Uhr").
  return String(new Date(iso).getHours()).padStart(2, "0");
}

/** Kompakter Wetter-Text für einen ETB-Eintrag. */
function formatEtbText(s: AbWetterSnapshot): string {
  const c = s.current;
  const wind =
    c.windSpeed === null
      ? "Wind —"
      : `Wind ${Math.round(c.windSpeed)} km/h${c.windDirection !== null ? ` aus ${compass(c.windDirection)}` : ""}${
          c.windGust !== null ? ` (Böen ${Math.round(c.windGust)} km/h)` : ""
        }`;
  const warn =
    s.alerts.length === 0
      ? "keine"
      : s.alerts
          .map((a) => `${a.event ?? "Warnung"}${a.severity ? ` (${SEVERITY_LABEL[a.severity]})` : ""}`)
          .join("; ");
  const ort = s.stationName ? `Station ${s.stationName}` : `${s.lat.toFixed(2)}, ${s.lon.toFixed(2)}`;
  return (
    `Wetter (Kartenmitte, ${ort}, ${fmtTime(s.fetchedAt)}): ` +
    `${fmt(c.temperature, "°C")}, ${wind}, Bewölkung ${fmt(c.cloudCover, "%")}, ` +
    `Niederschlag ${fmt(c.precipitation, "mm/10min", 1)}, ${fmt(c.pressure, "hPa")}, ` +
    `rel. Feuchte ${fmt(c.humidity, "%")}, Lage: ${conditionLabel(c.condition)}. Warnungen: ${warn}.`
  );
}

function sortedAlerts(alerts: AbWetterAlert[]): AbWetterAlert[] {
  return [...alerts].sort(
    (a, b) => (b.severity ? SEVERITY_RANK[b.severity] : 0) - (a.severity ? SEVERITY_RANK[a.severity] : 0),
  );
}

/** OS-Notification bei neuer Warnung — nur wo möglich (secure context + Erlaubnis). */
function maybeNotify(alerts: AbWetterAlert[]): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (!window.isSecureContext || Notification.permission !== "granted") return;
  const first = alerts[0];
  const title = alerts.length > 1 ? `${alerts.length} Wetterwarnungen` : `Wetterwarnung: ${first.event ?? ""}`;
  const body = first.headline ?? first.event ?? "Neue DWD-Warnung für den Standort.";
  try {
    new Notification(title, { body });
  } catch {
    // ignorieren
  }
}

export function Wetter({ snapshot, writable, roomId, onSnapshot, onWriteEtb }: WetterProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [etbDone, setEtbDone] = useState(false);

  // Refs, damit der Auto-Refresh-Timer stets die frischen Werte sieht, ohne neu
  // zu abonnieren (sonst Timer-Neustart bei jedem Snapshot).
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onSnapshotRef = useRef(onSnapshot);
  onSnapshotRef.current = onSnapshot;
  const refreshingRef = useRef(false);

  const doRefresh = async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setError(null);
    setLoading(true);
    try {
      const { lat, lon } = loadMapCenter(roomId);
      onSnapshotRef.current(await fetchWetter(lat, lon));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Abruf fehlgeschlagen");
    } finally {
      refreshingRef.current = false;
      setLoading(false);
    }
  };
  // Ref auf die aktuelle doRefresh-Closure, damit der Timer-Effekt stabil bleibt
  // (deps [writable, roomId]) und trotzdem stets die frische Logik ruft.
  const doRefreshRef = useRef(doRefresh);
  doRefreshRef.current = doRefresh;

  // Leiser Auto-Refresh: nur schreibberechtigte Clients, nur wenn der geteilte
  // Snapshot fehlt oder veraltet ist (Staleness-Check + Jitter → kein Thundering-Herd;
  // LWW auf dem einen Snapshot-Key löst gleichzeitige Writes harmlos).
  useEffect(() => {
    if (!writable) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled || refreshingRef.current) return;
      const fetchedAt = snapshotRef.current?.fetchedAt;
      const stale = !fetchedAt || Date.now() - Date.parse(fetchedAt) > STALE_MS;
      if (stale) void doRefreshRef.current?.();
    };
    const jitter = 2000 + Math.floor(Math.random() * 4000);
    const initial = setTimeout(tick, jitter);
    const interval = setInterval(tick, 2 * 60 * 1000);
    return () => {
      cancelled = true;
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [writable, roomId]);

  // Aktiver Warnhinweis: neue Warnung (nach id dedupt) → OS-Notification wo möglich.
  // Reagiert auch auf Remote-Updates, da `snapshot` aus dem CRDT kommt.
  useEffect(() => {
    const alerts = snapshot?.alerts ?? [];
    if (alerts.length === 0) return;
    const seen = loadSeenAlerts(roomId);
    const fresh = alerts.filter((a) => !seen.has(a.id));
    if (fresh.length === 0) return;
    fresh.forEach((a) => seen.add(a.id));
    saveSeenAlerts(roomId, seen);
    maybeNotify(sortedAlerts(fresh));
  }, [snapshot, roomId]);

  const handleEtb = async () => {
    if (!snapshot) return;
    try {
      await onWriteEtb(formatEtbText(snapshot));
      setEtbDone(true);
      setTimeout(() => setEtbDone(false), 3000);
    } catch {
      setError("ETB-Eintrag fehlgeschlagen");
    }
  };

  const current = snapshot?.current;
  const alerts = snapshot ? sortedAlerts(snapshot.alerts) : [];

  return (
    <section className="arbeitsblatt-panel wetter" aria-labelledby="arbeitsblatt-wetter-title">
      <div className="arbeitsblatt-panel__head">
        <h3 id="arbeitsblatt-wetter-title">
          <span className="arbeitsblatt-panel__letter">W</span>
          <span aria-hidden="true">·</span> Wetter
        </h3>
        <p>Aktuelle Lage, 4-h-Trend und DWD-Warnungen für die Kartenmitte des Lagebilds.</p>
      </div>

      <div className="wetter__bar">
        <span className="wetter__meta">
          {snapshot
            ? `Stand ${fmtTime(snapshot.fetchedAt)}${snapshot.stationName ? ` · Station ${snapshot.stationName}` : ""}`
            : "Noch nicht abgerufen"}
        </span>
        <div className="spacer" />
        {writable && (
          <button className="tool" type="button" onClick={doRefresh} disabled={loading}>
            {loading ? "Lädt…" : snapshot ? "Aktualisieren" : "Wetter abrufen"}
          </button>
        )}
        {writable && snapshot && (
          <button className="tool" type="button" onClick={handleEtb}>
            {etbDone ? "✓ Eingetragen" : "Ins ETB eintragen"}
          </button>
        )}
      </div>

      {error && <p className="wetter__error">Wetter aktuell nicht abrufbar: {error}</p>}

      {alerts.length > 0 && (
        <div className="wetter__alerts">
          {alerts.map((a) => (
            <div
              className={`wetter-alert wetter-alert--${a.severity ?? "minor"}`}
              key={a.id}
              role="alert"
            >
              <span className="wetter-alert__event">
                ⚠ {a.event ?? "Warnung"}
                {a.severity ? ` · ${SEVERITY_LABEL[a.severity]}` : ""}
              </span>
              {a.headline && <span className="wetter-alert__headline">{a.headline}</span>}
            </div>
          ))}
        </div>
      )}

      {current ? (
        <>
          <div className="wetter-metrics">
            <div className="wetter-metric wetter-metric--lead">
              <span className="wetter-metric__icon" aria-hidden="true">{iconEmoji(current.icon)}</span>
              <span className="wetter-metric__value">{fmt(current.temperature, "°C")}</span>
              <span className="wetter-metric__label">{conditionLabel(current.condition)}</span>
            </div>
            <div className="wetter-metric">
              <span className="wetter-metric__value">
                {fmt(current.windSpeed, "km/h")}
                {current.windDirection !== null ? ` ${compass(current.windDirection)}` : ""}
              </span>
              <span className="wetter-metric__label">Wind</span>
            </div>
            <div className="wetter-metric">
              <span className="wetter-metric__value">{fmt(current.windGust, "km/h")}</span>
              <span className="wetter-metric__label">Böen</span>
            </div>
            <div className="wetter-metric">
              <span className="wetter-metric__value">{fmt(current.cloudCover, "%")}</span>
              <span className="wetter-metric__label">Bewölkung</span>
            </div>
            <div className="wetter-metric">
              <span className="wetter-metric__value">{fmt(current.precipitation, "mm", 1)}</span>
              <span className="wetter-metric__label">Niederschl. (10 min)</span>
            </div>
            <div className="wetter-metric">
              <span className="wetter-metric__value">{fmt(current.pressure, "hPa")}</span>
              <span className="wetter-metric__label">Luftdruck</span>
            </div>
            <div className="wetter-metric">
              <span className="wetter-metric__value">{fmt(current.humidity, "%")}</span>
              <span className="wetter-metric__label">Feuchte</span>
            </div>
          </div>

          {snapshot && snapshot.forecast.length > 0 && (
            <div className="wetter-forecast">
              {snapshot.forecast.map((h) => (
                <div className="wetter-forecast__hour" key={h.time}>
                  <span className="wetter-forecast__time">{fmtHour(h.time)} Uhr</span>
                  <span className="wetter-forecast__icon" aria-hidden="true">{iconEmoji(h.icon)}</span>
                  <span className="wetter-forecast__temp">{fmt(h.temperature, "°C")}</span>
                  <span className="wetter-forecast__rain">
                    {h.precipitationProbability !== null ? `${Math.round(h.precipitationProbability)} %` : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        !error && <p className="arbeitsblatt-empty">Noch keine Wetterdaten abgerufen.</p>
      )}

      <p className="wetter__source">Quelle: Deutscher Wetterdienst (via BrightSky)</p>
    </section>
  );
}
