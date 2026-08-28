/**
 * DWD-Regenradar über die Bright-Sky-API statt des langsamen DWD-WMS (das
 * serverseitig on-the-fly rendert, 4–39 s — s. #116). Bright Sky liefert das
 * RADOLAN-RV-Produkt als **rohes Gitter** (schnell, gecacht, CORS-offen wie das
 * Wetter in `wetter.ts`), Einheit 0,01 mm / 5 min.
 *
 * Das Gitter liegt in der **DE1200-Projektion** (polar-stereografisch), nicht in
 * Web-Mercator. OpenLayers (Bright-Sky-Demo) reprojiziert ein ImageStatic dafür
 * automatisch — Leaflet kann das NICHT. Deshalb reprojizieren wir das Raster hier
 * selbst per proj4 nach Web-Mercator (EPSG:3857) und legen es dann als
 * achsenparalleles `L.imageOverlay` (in Mercator-Pixeln linear = exakt). Konstanten
 * (Projektion, Extent, Gittergröße) 1:1 aus der offiziellen Bright-Sky-Demo.
 */
import proj4 from "proj4";
import { unzlibSync } from "fflate";

// --- DWD-DE1200-Gitter (Konstanten aus der Bright-Sky-Radar-Demo) ---
const GRID_W = 1100;
const GRID_H = 1200;
const CELL_M = 1000; // 1-km-Zellen
const DE1200 =
  "+proj=stere +lat_0=90 +lat_ts=60 +lon_0=10 +a=6378137 +b=6356752.3142451802 +no_defs +x_0=543196.83521776402 +y_0=3622588.8619310018";
// Extent in DE1200-Metern [minX, minY, maxX, maxY]; maxY = obere (nördliche) Kante = Zeile 0.
const EXT_MIN_X = -500;
const EXT_MAX_Y = 500;

proj4.defs("DE1200", DE1200);
// EPSG:3857 ist in proj4 vordefiniert; zur Sicherheit idempotent registrieren.
proj4.defs(
  "EPSG:3857",
  "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs",
);
const MERC_TO_GRID = proj4("EPSG:3857", "DE1200");
const MERC_TO_WGS = proj4("EPSG:3857", "EPSG:4326");
const GRID_TO_MERC = proj4("DE1200", "EPSG:3857");

// Ohne Zeitfenster liefert die API ~25 Frames (2h-Historie). Ein enges Fenster
// (letzte 15 min) liefert 1–3 Frames; wir nehmen den neuesten.
function radarUrl(): string {
  const now = new Date();
  const from = new Date(now.getTime() - 15 * 60 * 1000);
  const params = new URLSearchParams({
    format: "compressed",
    date: from.toISOString(),
    last_date: now.toISOString(),
  });
  return `https://api.brightsky.dev/radar?${params.toString()}`;
}

export interface RadarFrame {
  canvas: HTMLCanvasElement; // bereits nach Web-Mercator reprojiziert
  /** WGS84-Bounds [[südLat, westLon], [nordLat, ostLon]] des Mercator-Rasters. */
  bounds: [[number, number], [number, number]];
  timestamp: string; // ISO (Serveruhr DWD)
}

interface RadarApiResponse {
  radar: { timestamp: string; source: string; precipitation_5: string }[];
}

/** base64 → zlib-inflate → Uint16-Gitter (2-Byte-Integer, wie in der Demo). */
function decodeGrid(base64: string): Uint16Array {
  const compressed = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const raw = unzlibSync(compressed);
  return new Uint16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2));
}

// Farbstops (Position 0..1 → RGB), an die „turbo"-Rampe der Bright-Sky-Demo
// angelehnt: blau → türkis → grün → gelb → orange → rot → magenta, damit starke
// Zellen kräftig herausstechen. Normiert gegen 2,5 mm/5 min (= Wert 250).
const RADAR_STOPS: [number, [number, number, number]][] = [
  [0.0, [60, 120, 216]],
  [0.2, [40, 200, 200]],
  [0.4, [60, 200, 90]],
  [0.6, [235, 220, 50]],
  [0.78, [240, 140, 30]],
  [0.9, [220, 40, 40]],
  [1.0, [150, 20, 90]],
];

/**
 * Farbrampe für die Intensität (0,01 mm/5 min). 0/negativ/unplausibel → transparent;
 * sonst interpoliert über RADAR_STOPS mit intensitätsabhängiger Deckkraft (leichter
 * Regen dezent, starke Zellen deckend). Rein (unit-testbar).
 */
export function radarColor(value: number): [number, number, number, number] {
  if (value <= 0 || value > 1000) return [0, 0, 0, 0]; // kein Regen / Nodata-Clutter
  const v = Math.min(value, 250) / 250; // 0..1
  let rgb = RADAR_STOPS[RADAR_STOPS.length - 1][1];
  for (let i = 1; i < RADAR_STOPS.length; i++) {
    const [p1, c1] = RADAR_STOPS[i];
    if (v <= p1) {
      const [p0, c0] = RADAR_STOPS[i - 1];
      const t = p1 > p0 ? (v - p0) / (p1 - p0) : 0;
      rgb = [
        Math.round(c0[0] + (c1[0] - c0[0]) * t),
        Math.round(c0[1] + (c1[1] - c0[1]) * t),
        Math.round(c0[2] + (c1[2] - c0[2]) * t),
      ];
      break;
    }
  }
  // Deckkraft wie in der Demo: jeder Regen mind. ~0,2, ansteigend bis 0,8.
  const alpha = Math.round(Math.max(Math.min(v * 10, 0.8), 0.2) * 255);
  return [rgb[0], rgb[1], rgb[2], alpha];
}

/** Reprojiziert das DE1200-Gitter in ein Web-Mercator-Canvas + liefert dessen WGS84-Bounds. */
function reprojectToMercator(grid: Uint16Array): {
  canvas: HTMLCanvasElement;
  bounds: RadarFrame["bounds"];
} {
  // Mercator-Bounding-Rechteck aus den vier DE1200-Eckpunkten.
  const extMaxX = EXT_MIN_X + GRID_W * CELL_M;
  const extMinY = EXT_MAX_Y - GRID_H * CELL_M;
  const corners: [number, number][] = [
    [EXT_MIN_X, extMinY],
    [EXT_MIN_X, EXT_MAX_Y],
    [extMaxX, extMinY],
    [extMaxX, EXT_MAX_Y],
  ];
  let mMinX = Infinity;
  let mMinY = Infinity;
  let mMaxX = -Infinity;
  let mMaxY = -Infinity;
  for (const c of corners) {
    const [x, y] = GRID_TO_MERC.forward(c);
    mMinX = Math.min(mMinX, x);
    mMinY = Math.min(mMinY, y);
    mMaxX = Math.max(mMaxX, x);
    mMaxY = Math.max(mMaxY, y);
  }

  const spanX = mMaxX - mMinX;
  const spanY = mMaxY - mMinY;
  const tw = GRID_W;
  const th = Math.max(1, Math.round((tw * spanY) / spanX));
  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const img = ctx.createImageData(tw, th);
    for (let ty = 0; ty < th; ty++) {
      const mercY = mMaxY - ((ty + 0.5) / th) * spanY; // ty=0 → oben (Nord)
      for (let tx = 0; tx < tw; tx++) {
        const mercX = mMinX + ((tx + 0.5) / tw) * spanX;
        const [gx, gy] = MERC_TO_GRID.forward([mercX, mercY]);
        const col = Math.floor((gx - EXT_MIN_X) / CELL_M);
        const row = Math.floor((EXT_MAX_Y - gy) / CELL_M);
        const o = (ty * tw + tx) * 4;
        if (col >= 0 && col < GRID_W && row >= 0 && row < GRID_H) {
          const [r, g, b, a] = radarColor(grid[row * GRID_W + col] ?? 0);
          img.data[o] = r;
          img.data[o + 1] = g;
          img.data[o + 2] = b;
          img.data[o + 3] = a;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  const [swLon, swLat] = MERC_TO_WGS.forward([mMinX, mMinY]);
  const [neLon, neLat] = MERC_TO_WGS.forward([mMaxX, mMaxY]);
  return {
    canvas,
    bounds: [
      [swLat, swLon],
      [neLat, neLon],
    ],
  };
}

/** Holt den aktuellsten Radar-Frame und reprojiziert ihn nach Web-Mercator. */
export async function fetchLatestRadar(signal?: AbortSignal): Promise<RadarFrame> {
  const res = await fetch(radarUrl(), { signal });
  if (!res.ok) throw new Error(`Bright-Sky-Radar HTTP ${res.status}`);
  const data = (await res.json()) as RadarApiResponse;
  const frame = data.radar.at(-1);
  if (!frame) throw new Error("Bright-Sky-Radar: kein aktueller Frame");
  const grid = decodeGrid(frame.precipitation_5);
  const { canvas, bounds } = reprojectToMercator(grid);
  return { canvas, bounds, timestamp: frame.timestamp };
}
