import { type ChangeEvent, useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import type { Map as YMap, YMapEvent } from "yjs";
import { canWrite, LAGEKARTE_FEATURES, type MapFeature } from "@lagekatse/shared";
import type { Session } from "../session";
import { connectModule } from "../sync/provider";
import { uid } from "../uid";
import { Palette, type PaletteSymbol } from "./Palette";

interface SymbolIndex {
  symbols: PaletteSymbol[];
}

type SymbolFeature = Extract<MapFeature, { kind: "symbol" }>;
type AreaFeature = Extract<MapFeature, { kind: "area" }>;
type DrawShape = "Polygon" | "Rectangle" | "Circle";

interface ActiveDraw {
  shape: DrawShape;
  color: string;
  opacity: number;
}

const AREA_COLORS = [
  { color: "#d5372b", label: "Schaden, rot" },
  { color: "#2f6bd8", label: "Blau" },
  { color: "#f7a81b", label: "Amber" },
  { color: "#2e9e5b", label: "Grün" },
];

const SYMBOL_SIZE_KEY = "lagekatse.symbolSize";
const LABELS_VISIBLE_KEY = "lagekatse.labelsVisible";
const RADAR_VISIBLE_KEY = "lagekatse.radarVisible";
const KONRAD_VISIBLE_KEY = "lagekatse.konradVisible";
const SYMBOL_SIZE_MIN = 0.6;
const SYMBOL_SIZE_MAX = 2;

function clampSymbolSize(value: number): number {
  return Math.min(SYMBOL_SIZE_MAX, Math.max(SYMBOL_SIZE_MIN, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCoordinate(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

const MAP_VIEW_KEY_PREFIX = "lagekatse.mapView.";

interface StoredMapView {
  center: [number, number];
  zoom: number;
}

// Kartenansicht (Center + Zoom) je Raum betrachter-lokal merken, damit sie über
// Modulwechsel (Lagekarte ↔ Arbeitsblatt) und zwischen voller/eingebetteter Karte
// erhalten bleibt — localStorage, nicht im CRDT (wie E9 / Invariante #4).
function loadMapView(roomId: string): StoredMapView | null {
  try {
    const raw = localStorage.getItem(MAP_VIEW_KEY_PREFIX + roomId);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      isRecord(parsed) &&
      isCoordinate(parsed.center) &&
      typeof parsed.zoom === "number" &&
      Number.isFinite(parsed.zoom)
    ) {
      return { center: parsed.center, zoom: parsed.zoom };
    }
    return null;
  } catch {
    return null;
  }
}

function saveMapView(roomId: string, center: [number, number], zoom: number): void {
  try {
    localStorage.setItem(MAP_VIEW_KEY_PREFIX + roomId, JSON.stringify({ center, zoom }));
  } catch {
    // Storage nicht verfügbar — die Ansicht fällt beim nächsten Mount auf den Default zurück.
  }
}

function isMapFeature(value: unknown): value is MapFeature {
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

function areaFromLayer(
  layer: L.Layer,
  draw: ActiveDraw,
  createdBy: string,
): AreaFeature | null {
  let area:
    | Pick<AreaFeature, "shape" | "geometry" | "radiusM">
    | Pick<AreaFeature, "shape" | "geometry">;

  if (draw.shape === "Polygon" && layer instanceof L.Polygon) {
    const ring = (layer.getLatLngs()[0] as L.LatLng[]).map(
      (point) => [point.lat, point.lng] as [number, number],
    );
    if (ring.length === 0) return null;
    area = { shape: "polygon", geometry: ring };
  } else if (draw.shape === "Rectangle" && layer instanceof L.Rectangle) {
    const bounds = layer.getBounds();
    area = {
      shape: "rectangle",
      geometry: [
        [bounds.getSouth(), bounds.getWest()],
        [bounds.getNorth(), bounds.getEast()],
      ],
    };
  } else if (draw.shape === "Circle" && layer instanceof L.Circle) {
    const center = layer.getLatLng();
    area = {
      shape: "circle",
      geometry: [[center.lat, center.lng]],
      radiusM: layer.getRadius(),
    };
  } else {
    return null;
  }

  const now = new Date().toISOString();
  return {
    id: uid(),
    kind: "area",
    ...area,
    color: draw.color,
    opacity: draw.opacity,
    label: "",
    description: "",
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
}

// Build the hover tooltip: label as a bold heading, description as body below —
// both shown when set. DOM built with textContent (not innerHTML) so user text
// can never inject markup.
function buildTooltip(feature: MapFeature): HTMLElement | null {
  const title = feature.label?.trim();
  const body = feature.description?.trim();
  if (!title && !body) return null;

  const el = document.createElement("div");
  if (title) {
    const heading = document.createElement("b");
    heading.textContent = title;
    el.appendChild(heading);
  }
  if (body) {
    const text = document.createElement("span");
    text.textContent = body;
    el.appendChild(text);
  }
  return el;
}

function createLayer(
  feature: MapFeature,
  symbolFiles: Map<string, string>,
  writable: boolean,
  symbolSize: number,
  labelsVisible: boolean,
): L.Layer | null {
  let layer: L.Layer;

  if (feature.kind === "symbol") {
    const file = symbolFiles.get(feature.symbolId);
    if (!file) return null;

    const size = 40 * symbolSize;
    const image = document.createElement("img");
    image.src = `/taktische-zeichen/${encodeURI(file)}`;
    image.alt = "";
    image.style.transform = `rotate(${feature.rotation}deg)`;

    const content = document.createElement("div");
    content.className = "lagekarte-symbol__content";
    content.appendChild(image);
    const label = feature.label?.trim();
    if (labelsVisible && label) {
      const caption = document.createElement("div");
      caption.className = "lagekarte-symbol__label";
      caption.textContent = label;
      content.appendChild(caption);
    }

    const icon = L.divIcon({
      className: "lagekarte-symbol",
      html: content,
      iconAnchor: [size / 2, size / 2],
      iconSize: [size, size],
    });
    layer = L.marker(feature.position, { icon, draggable: writable });
  } else {
    const options: L.PathOptions = {
      color: feature.color,
      fillColor: feature.color,
      fillOpacity: feature.opacity,
    };
    let shape: L.Circle | L.Rectangle | L.Polygon;

    if (feature.shape === "circle") {
      const center = feature.geometry[0];
      if (!center) return null;
      shape = L.circle(center, { ...options, radius: feature.radiusM ?? 0 });
    } else if (feature.shape === "rectangle") {
      if (feature.geometry.length === 0) return null;
      shape = L.rectangle(L.latLngBounds(feature.geometry), options);
    } else {
      if (feature.geometry.length === 0) return null;
      shape = L.polygon(feature.geometry, options);
    }

    const tip = buildTooltip(feature);
    if (tip) {
      shape.bindTooltip(tip, {
        className: "lagekarte-tip",
        direction: "top",
        sticky: true,
      });
    }

    const label = feature.label?.trim();
    if (!labelsVisible || !label) return shape;

    const labelElement = document.createElement("div");
    labelElement.className = "lagekarte-area-label__text";
    labelElement.textContent = label;
    labelElement.style.backgroundColor = `color-mix(in srgb, ${feature.color} 14%, transparent)`;
    labelElement.style.color = `color-mix(in srgb, ${feature.color} 72%, black)`;
    labelElement.style.borderColor = feature.color;
    const center =
      feature.shape === "circle" ? feature.geometry[0] : shape.getBounds().getCenter();
    if (!center) return shape;
    const labelMarker = L.marker(center, {
      icon: L.divIcon({
        className: "lagekarte-area-label",
        html: labelElement,
        iconAnchor: [0, 0],
        iconSize: [0, 0],
      }),
      interactive: false,
      keyboard: false,
    });
    return L.featureGroup([shape, labelMarker]);
  }

  const tip = buildTooltip(feature);
  if (tip) {
    layer.bindTooltip(tip, {
      className: "lagekarte-tip",
      direction: "top",
      sticky: false,
    });
  }
  return layer;
}

export function Lagekarte({
  session,
  readOnly = false,
  embedded = false,
}: {
  session: Session;
  readOnly?: boolean;
  embedded?: boolean;
}) {
  const mapElementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const featuresMapRef = useRef<YMap<MapFeature> | null>(null);
  const selectedSymbolRef = useRef<PaletteSymbol | null>(null);
  const selectedFeatureIdRef = useRef<string | null>(null);
  const activeDrawRef = useRef<ActiveDraw | null>(null);
  const writableRef = useRef(false);
  const renderForRightsRef = useRef<(() => void) | null>(null);
  const refreshSymbolsRef = useRef<(() => void) | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [symbols, setSymbols] = useState<PaletteSymbol[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<PaletteSymbol | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<MapFeature | null>(null);
  const [importMessage, setImportMessage] = useState("");
  const [activeDraw, setActiveDraw] = useState<ActiveDraw | null>(null);
  const [drawColor, setDrawColor] = useState("#d5372b");
  const [drawOpacity, setDrawOpacity] = useState(0.3);
  const [areaColor, setAreaColor] = useState("#d5372b");
  const [areaOpacity, setAreaOpacity] = useState(0.3);
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [symbolSize, setSymbolSize] = useState(() => {
    try {
      const stored = Number.parseFloat(localStorage.getItem(SYMBOL_SIZE_KEY) ?? "");
      return Number.isFinite(stored) && stored > 0 ? clampSymbolSize(stored) : 1;
    } catch {
      return 1;
    }
  });
  const symbolSizeRef = useRef(symbolSize);
  const [labelsVisible, setLabelsVisible] = useState(() => {
    try {
      return localStorage.getItem(LABELS_VISIBLE_KEY) !== "false";
    } catch {
      return true;
    }
  });
  const labelsVisibleRef = useRef(labelsVisible);
  // DWD-Regenradar-Overlay: client-lokale Anzeige-Option (localStorage, Invariante #4) —
  // gilt für alle Rollen inkl. Nur-Lese-Monitor, geht nicht ins CRDT.
  const [radarVisible, setRadarVisible] = useState(() => {
    try {
      return localStorage.getItem(RADAR_VISIBLE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const radarVisibleRef = useRef(radarVisible);
  const radarLayerRef = useRef<L.TileLayer.WMS | null>(null);
  // DWD-KONRAD3D-Overlay: client-lokale Anzeige-Option (localStorage, Invariante #4) —
  // gilt für alle Rollen inkl. Nur-Lese-Monitor, geht nicht ins CRDT.
  const [konradVisible, setKonradVisible] = useState(() => {
    try {
      return localStorage.getItem(KONRAD_VISIBLE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const konradVisibleRef = useRef(konradVisible);
  const konradLayerRef = useRef<L.TileLayer.WMS | null>(null);
  // KONRAD3D Info-Modus: wenn aktiv, fragt ein Klick auf eine Zelle per
  // GetFeatureInfo die Zell-Attribute ab und zeigt sie als Popup.
  const [konradInfoActive, setKonradInfoActive] = useState(false);
  const konradInfoActiveRef = useRef(konradInfoActive);
  const writable = !readOnly && canWrite(session.roles, "lagekarte", {
    allowMonitorChat: session.room.settings.allowMonitorChat,
  });

  useEffect(() => {
    selectedSymbolRef.current = selectedSymbol;
  }, [selectedSymbol]);

  useEffect(() => {
    symbolSizeRef.current = symbolSize;
    try {
      localStorage.setItem(SYMBOL_SIZE_KEY, String(symbolSize));
    } catch {
      // The preference remains active for this session when storage is unavailable.
    }
    refreshSymbolsRef.current?.();
  }, [symbolSize]);

  useEffect(() => {
    labelsVisibleRef.current = labelsVisible;
    try {
      localStorage.setItem(LABELS_VISIBLE_KEY, String(labelsVisible));
    } catch {
      // The preference remains active for this session when storage is unavailable.
    }
    renderForRightsRef.current?.();
  }, [labelsVisible]);

  useEffect(() => {
    radarVisibleRef.current = radarVisible;
    try {
      localStorage.setItem(RADAR_VISIBLE_KEY, String(radarVisible));
    } catch {
      // The preference remains active for this session when storage is unavailable.
    }
    const map = mapRef.current;
    const layer = radarLayerRef.current;
    if (map && layer) {
      if (radarVisible) layer.addTo(map);
      else layer.remove();
    }
  }, [radarVisible]);

  useEffect(() => {
    konradVisibleRef.current = konradVisible;
    try {
      localStorage.setItem(KONRAD_VISIBLE_KEY, String(konradVisible));
    } catch {
      // The preference remains active for this session when storage is unavailable.
    }
    const map = mapRef.current;
    const layer = konradLayerRef.current;
    if (map && layer) {
      if (konradVisible) layer.addTo(map);
      else layer.remove();
    }
  }, [konradVisible]);

  useEffect(() => {
    konradInfoActiveRef.current = konradInfoActive;
    const map = mapRef.current;
    if (!map) return;
    // Cursor wechselt auf "help", wenn der Info-Modus aktiv ist
    const container = map.getContainer();
    if (konradInfoActive) container.classList.add("lagekarte-info-cursor");
    else container.classList.remove("lagekarte-info-cursor");
  }, [konradInfoActive]);

  useEffect(() => {
    writableRef.current = writable;
    renderForRightsRef.current?.();
    if (!writable) {
      mapRef.current?.pm.disableDraw();
      activeDrawRef.current = null;
      selectedSymbolRef.current = null;
      selectedFeatureIdRef.current = null;
      setActiveDraw(null);
      setSelectedSymbol(null);
      setSelectedFeature(null);
    }
  }, [writable]);

  useEffect(() => {
    if (!selectedFeature) return;
    setLabel(selectedFeature.label ?? "");
    setDescription(selectedFeature.description ?? "");
    if (selectedFeature.kind === "area") {
      setAreaColor(selectedFeature.color);
      setAreaOpacity(selectedFeature.opacity);
    }
  }, [selectedFeature]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      mapRef.current?.pm.disableDraw();
      activeDrawRef.current = null;
      selectedSymbolRef.current = null;
      setActiveDraw(null);
      setSelectedSymbol(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const clearFeatureSelection = () => {
    selectedFeatureIdRef.current = null;
    setSelectedFeature(null);
  };

  const selectPaletteSymbol = (symbol: PaletteSymbol) => {
    mapRef.current?.pm.disableDraw();
    activeDrawRef.current = null;
    setActiveDraw(null);
    const next = selectedSymbolRef.current?.id === symbol.id ? null : symbol;
    selectedSymbolRef.current = next;
    setSelectedSymbol(next);
  };

  const disarmPlacement = () => {
    selectedSymbolRef.current = null;
    setSelectedSymbol(null);
  };

  const cancelDrawing = () => {
    mapRef.current?.pm.disableDraw();
    activeDrawRef.current = null;
    setActiveDraw(null);
  };

  const enableDrawing = (shape: DrawShape, color = drawColor, opacity = drawOpacity) => {
    if (!writableRef.current) return;
    if (activeDrawRef.current?.shape === shape && color === drawColor && opacity === drawOpacity) {
      cancelDrawing();
      return;
    }

    selectedSymbolRef.current = null;
    setSelectedSymbol(null);
    const draw = { shape, color, opacity };
    activeDrawRef.current = draw;
    setActiveDraw(draw);
    const map = mapRef.current;
    if (!map) return;
    map.pm.disableDraw();
    map.pm.enableDraw(shape, {
      pathOptions: { color, fillColor: color, fillOpacity: opacity },
    });
  };

  const changeDrawColor = (color: string) => {
    setDrawColor(color);
    const current = activeDrawRef.current;
    if (current) enableDrawing(current.shape, color, current.opacity);
  };

  const changeDrawOpacity = (opacity: number) => {
    setDrawOpacity(opacity);
    const current = activeDrawRef.current;
    if (current) enableDrawing(current.shape, current.color, opacity);
  };

  const saveSelectedFeature = () => {
    if (!writableRef.current || !selectedFeature) return;
    const featuresMap = featuresMapRef.current;
    const current = featuresMap?.get(selectedFeature.id);
    if (!featuresMap || !current) {
      clearFeatureSelection();
      return;
    }
    const updatedAt = new Date().toISOString();
    if (current.kind === "area") {
      featuresMap.set(current.id, {
        ...current,
        color: areaColor,
        opacity: areaOpacity,
        label,
        description,
        updatedAt,
      });
    } else {
      featuresMap.set(current.id, {
        ...current,
        label,
        description,
        updatedAt,
      });
    }
    clearFeatureSelection();
  };

  const deleteSelectedFeature = () => {
    if (!writableRef.current || !selectedFeature) return;
    featuresMapRef.current?.delete(selectedFeature.id);
    clearFeatureSelection();
  };

  const exportMap = () => {
    const map = mapRef.current;
    const center = map?.getCenter();
    const payload = {
      format: "lagekatse.lagekarte",
      version: 1,
      exportedAt: new Date().toISOString(),
      view: {
        center: center ? [center.lat, center.lng] : [51.16, 10.45],
        zoom: map?.getZoom() ?? 6,
      },
      features: featuresMapRef.current ? [...featuresMapRef.current.values()] : [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lagekarte-${session.room.joinCode}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const importMap = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];

    try {
      if (!file) return;
      if (!writableRef.current) {
        setImportMessage("Import nicht erlaubt.");
        return;
      }

      const parsed: unknown = JSON.parse(await file.text());
      if (
        !isRecord(parsed) ||
        parsed.format !== "lagekatse.lagekarte" ||
        !Array.isArray(parsed.features)
      ) {
        setImportMessage("Import fehlgeschlagen: ungültiges Dateiformat.");
        return;
      }

      const features = parsed.features.filter(isMapFeature);
      const featuresMap = featuresMapRef.current;
      if (!writableRef.current || !featuresMap) {
        setImportMessage("Import fehlgeschlagen: Karte ist noch nicht bereit.");
        return;
      }

      for (const feature of features) featuresMap.set(feature.id, feature);

      if (
        isRecord(parsed.view) &&
        isCoordinate(parsed.view.center) &&
        typeof parsed.view.zoom === "number" &&
        Number.isFinite(parsed.view.zoom)
      ) {
        mapRef.current?.setView(parsed.view.center, parsed.view.zoom);
      }

      const skipped = parsed.features.length - features.length;
      setImportMessage(
        `${features.length} Feature${features.length === 1 ? "" : "s"} importiert${
          skipped > 0 ? `, ${skipped} ungültig` : ""
        }.`,
      );
    } catch {
      setImportMessage("Import fehlgeschlagen: ungültige JSON-Datei.");
    } finally {
      input.value = "";
    }
  };

  useEffect(() => {
    const mapElement = mapElementRef.current;
    if (!mapElement) return;

    const savedView = loadMapView(session.room.id);
    const map = L.map(mapElement).setView(savedView?.center ?? [51.16, 10.45], savedView?.zoom ?? 6);
    mapRef.current = map;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap-Mitwirkende",
    }).addTo(map);

    // DWD-Regenradar als optionales WMS-Overlay (Bild-Kacheln → kein CORS, kein Server).
    // Sichtbarkeit ist client-lokal (radarVisible); Layer wird nur bei Bedarf zugefügt.
    const radarLayer = L.tileLayer.wms("https://maps.dwd.de/geoserver/ows?", {
      layers: "dwd:Niederschlagsradar",
      format: "image/png",
      transparent: true,
      version: "1.3.0",
      opacity: 0.55,
      attribution: "Regenradar: Deutscher Wetterdienst",
    });
    radarLayerRef.current = radarLayer;
    if (radarVisibleRef.current) radarLayer.addTo(map);

    // DWD-KONRAD3D (Konvektionserkennung) als optionales WMS-Overlay.
    // current_cells: gefuellllte Zellpolygone (rot/gelb/gruen nach Schweregrad),
    // cur_track_lines: schwarze Verbindungslinien vergangener Zellschwerpunkte.
    // Zusaetzliche Zell-Infos (Hagel, Windboeen, VIL etc.) werden per
    // GetFeatureInfo bei Klick auf eine Zelle als Popup angezeigt —
    // statt als cell_info-Bildlayer, der die Zellfarben uebermalt.
    // Bild-Kacheln direkt vom DWD → kein CORS.
    const konradLayer = L.tileLayer.wms("https://maps.dwd.de/geoserver/ows?", {
      layers: "dwd:K3D_EVAL_current_cells,dwd:K3D_EVAL_cur_track_lines",
      styles: "",
      format: "image/png",
      transparent: true,
      version: "1.3.0",
      opacity: 0.75,
      attribution: "KONRAD3D: Deutscher Wetterdienst",
    });
    konradLayerRef.current = konradLayer;
    if (konradVisibleRef.current) konradLayer.addTo(map);

    // GetFeatureInfo bei Klick auf eine KONRAD3D-Zelle — zeigt Roh-Attribute
    // (Schweregrad, Hagel, Windboeen, VIL, Echo-Top, Zellgeschwindigkeit etc.)
    // als Leaflet-Popup an. Wird nur ausgefuehrt, wenn das KONRAD3D-Overlay an ist
    // und der Klick nicht auf eine taktische Zeichnung traf.
    const konradClick = (e: L.LeafletMouseEvent) => {
      if (!konradVisibleRef.current || !konradInfoActiveRef.current) return;
      const point = e.containerPoint;
      const size = map.getSize();
      // WMS 1.3.0 mit CRS=EPSG:3857: bbox muss in Web-Mercator-Koordinaten sein
      // (nicht Pixel-Koordinaten). Leaflet's CRS-Konvertierung liefert die
      // korrekten Projektionskoordinaten aus LatLng.
      const bounds = map.getBounds();
      const sw = map.options.crs?.project(bounds.getSouthWest()) ?? L.Projection.SphericalMercator.project(bounds.getSouthWest());
      const ne = map.options.crs?.project(bounds.getNorthEast()) ?? L.Projection.SphericalMercator.project(bounds.getNorthEast());
      // WMS 1.3.0 mit CRS=EPSG:3857: bbox = minX,minY,maxX,maxY
      const bbox = `${sw.x},${sw.y},${ne.x},${ne.y}`;

      const params = new URLSearchParams({
        service: "WMS",
        version: "1.3.0",
        request: "GetFeatureInfo",
        layers: "dwd:K3D_EVAL_current_cells",
        styles: "",
        crs: "EPSG:3857",
        bbox,
        width: String(size.x),
        height: String(size.y),
        query_layers: "dwd:K3D_EVAL_current_cells",
        info_format: "application/json",
        i: String(point.x),
        j: String(point.y),
        feature_count: "1",
      });

      fetch(`https://maps.dwd.de/geoserver/ows?${params}`)
        .then((res) => res.json())
        .then((data: { features: { properties: Record<string, unknown> }[] }) => {
          const feature = data.features?.[0];
          if (!feature?.properties) return;
          const p = feature.properties;
          const sev = Number(p.SEVERITY ?? -1);
          const sevLabels = ["0 (leicht)", "1 (maessig)", "2 (stark)", "3 (extrem)"];
          const sevText = sev >= 0 && sev <= 3 ? sevLabels[sev] : "?";
          const hail = p.HAIL_FLAG === 1 || p.HAIL_FLAG === "1";
          const gust = p.GUST_FLAG === 1 || p.GUST_FLAG === "1";
          const heavyRain = p.HEAVY_RAIN_FLAG === 1 || p.HEAVY_RAIN_FLAG === "1";
          const rows: [string, string][] = [
            ["Schweregrad", sevText],
            ["Hagel", hail ? "ja" : "nein"],
            ["Windböen", gust ? "ja" : "nein"],
            ["Starkregen", heavyRain ? "ja" : "nein"],
            ["Max. Windböe", `${p.MAXIMUM_ESTIMATED_WIND_GUST ?? "?"} km/h`],
            ["Zellgeschw.", `${p.CELL_SPEED ?? "?"} km/h`],
            ["Echo-Top", `${p.ECHO_TOP_45_DBZ ?? "?"} m`],
            ["VIL", `${p.CELL_BASED_VIL ?? "?"} kg/m²`],
            ["Fläche", `${p.COVERED_AREA ?? "?"} km²`],
          ];
          const html = `<div class="konrad-popup"><b>KONRAD3D-Zelle</b><table>${rows
            .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
            .join("")}</table></div>`;
          L.popup({ className: "konrad-popup-wrapper", maxWidth: 280 })
            .setLatLng(e.latlng)
            .setContent(html)
            .openOn(map);
        })
        .catch(() => { /* DWD unreachable — silently ignore */ });
    };
    map.on("click", konradClick);

    // DWD-WMS-Layer (Regenradar + KONRAD3D) periodisch aktualisieren.
    // Der DWD liefert neue Zeitschritte ca. alle 5 Min. Wir erzwingen ein
    // Neu-Laden der Kacheln via redraw() — ohne time-Parameter, damit der
    // DWD automatisch den neuesten verfuegbaren Zeitschritt liefert (ein
    // expliziter time-Wert wuerde ggf. in der Zukunft liegen und leere
    // Kacheln zurueckliefern, weil die Daten noch nicht vorhanden sind).
    const refreshWmsLayers = () => {
      radarLayerRef.current?.redraw();
      konradLayerRef.current?.redraw();
    };
    const wmsRefreshTimer = window.setInterval(refreshWmsLayers, 5 * 60 * 1000);

    map.pm.setGlobalOptions({ pathOptions: {} });

    const layers = new Map<string, L.Layer>();
    const symbolFiles = new Map<string, string>();
    let features = new Map<string, MapFeature>();
    const conn = connectModule(session.room.id, "lagekarte", session.token);
    const featuresMap = conn.doc.getMap<MapFeature>(LAGEKARTE_FEATURES);
    featuresMapRef.current = featuresMap;

    const renderFeature = (id: string) => {
      const previous = layers.get(id);
      if (previous) {
        previous.remove();
        layers.delete(id);
      }

      const feature = features.get(id);
      if (!feature) return;
      const layer = createLayer(
        feature,
        symbolFiles,
        writableRef.current,
        symbolSizeRef.current,
        labelsVisibleRef.current,
      );
      if (!layer) return;
      if (feature.kind === "symbol" && layer instanceof L.Marker) {
        layer.on("dragend", () => {
          if (!writableRef.current) return;
          const current = featuresMap.get(id);
          if (current?.kind !== "symbol") return;
          const position = layer.getLatLng();
          featuresMap.set(id, {
            ...current,
            position: [position.lat, position.lng],
            updatedAt: new Date().toISOString(),
          });
        });
        layer.on("click", (event) => {
          L.DomEvent.stopPropagation(event);
          if (!writableRef.current) return;
          const current = featuresMap.get(id);
          if (current?.kind !== "symbol") return;
          selectedFeatureIdRef.current = id;
          setSelectedFeature(current);
        });
      } else if (feature.kind === "area") {
        layer.on("click", (event) => {
          L.DomEvent.stopPropagation(event);
          if (!writableRef.current) return;
          const current = featuresMap.get(id);
          if (current?.kind !== "area") return;
          selectedFeatureIdRef.current = id;
          setSelectedFeature(current);
        });
      }
      layer.addTo(map);
      layers.set(id, layer);
    };

    const renderAll = () => {
      const ids = new Set([...layers.keys(), ...features.keys()]);
      for (const id of ids) renderFeature(id);
    };
    const refreshSymbols = () => {
      for (const [id, feature] of features) {
        if (feature.kind === "symbol") renderFeature(id);
      }
    };
    renderForRightsRef.current = renderAll;
    refreshSymbolsRef.current = refreshSymbols;

    const abortController = new AbortController();
    void fetch("/taktische-zeichen/index.json", { signal: abortController.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Symbolindex konnte nicht geladen werden: ${response.status}`);
        return response.json() as Promise<SymbolIndex>;
      })
      .then((index) => {
        for (const symbol of index.symbols) symbolFiles.set(symbol.id, symbol.file);
        setSymbols(index.symbols);
        renderAll();
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.error(error);
        }
      });

    const refresh = (event: YMapEvent<MapFeature>) => {
      features = new Map(featuresMap.entries());
      for (const id of event.keysChanged) renderFeature(id);
      const selectedId = selectedFeatureIdRef.current;
      if (selectedId && event.keysChanged.has(selectedId)) {
        const current = featuresMap.get(selectedId);
        if (current) setSelectedFeature(current);
        else {
          selectedFeatureIdRef.current = null;
          setSelectedFeature(null);
        }
      }
    };
    featuresMap.observe(refresh);
    features = new Map(featuresMap.entries());
    renderAll();

    const onMapClick = (event: L.LeafletMouseEvent) => {
      if (!writableRef.current) return;
      if (activeDrawRef.current) return;
      const symbol = selectedSymbolRef.current;
      if (!symbol) return;
      const id = uid();
      const now = new Date().toISOString();
      const feature: SymbolFeature = {
        id,
        kind: "symbol",
        symbolId: symbol.id,
        position: [event.latlng.lat, event.latlng.lng],
        rotation: 0,
        label: symbol.label,
        description: "",
        createdBy: session.name,
        createdAt: now,
        updatedAt: now,
      };
      featuresMap.set(id, feature);
    };
    map.on("click", onMapClick);

    const onCreate = (event: L.LeafletEvent) => {
      const { layer } = event as L.LeafletEvent & { shape: string; layer: L.Layer };
      const draw = activeDrawRef.current;
      map.removeLayer(layer);
      if (!writableRef.current || !draw) return;
      const feature = areaFromLayer(layer, draw, session.name);
      if (feature) featuresMap.set(feature.id, feature);
      map.pm.disableDraw();
      activeDrawRef.current = null;
      setActiveDraw(null);
    };
    map.on("pm:create", onCreate);

    // Kartenansicht je Raum merken (client-lokal), damit sie den Modulwechsel überlebt.
    const persistView = () => {
      const center = map.getCenter();
      saveMapView(session.room.id, [center.lat, center.lng], map.getZoom());
    };
    map.on("moveend", persistView);

    return () => {
      abortController.abort();
      map.off("click", onMapClick);
      map.off("click", konradClick);
      map.off("pm:create", onCreate);
      map.off("moveend", persistView);
      featuresMap.unobserve(refresh);
      if (featuresMapRef.current === featuresMap) featuresMapRef.current = null;
      if (mapRef.current === map) mapRef.current = null;
      radarLayerRef.current = null;
      konradLayerRef.current = null;
      window.clearInterval(wmsRefreshTimer);
      if (renderForRightsRef.current === renderAll) renderForRightsRef.current = null;
      if (refreshSymbolsRef.current === refreshSymbols) refreshSymbolsRef.current = null;
      conn.destroy();
      map.remove();
      layers.clear();
    };
  }, [session.room.id, session.sid, session.token, session.name]);

  return (
    <div className={`lagekarte-view ${embedded ? "lagekarte-view--embedded" : ""}`}>
      {!embedded && (
        <div className="lagekarte-bar">
          <div className="spacer" />
          <button className="btn btn--ghost" type="button" onClick={exportMap}>
            Export
          </button>
          <label className="lagekarte-symbol-size">
            <span>Symbolgröße</span>
            <input
              type="range"
              min={SYMBOL_SIZE_MIN}
              max={SYMBOL_SIZE_MAX}
              step="0.1"
              value={symbolSize}
              aria-label="Symbolgröße"
              onChange={(event) => setSymbolSize(clampSymbolSize(event.currentTarget.valueAsNumber))}
            />
            <output>{Math.round(symbolSize * 100)} %</output>
          </label>
          <label className="lagekarte-label-toggle">
            <input
              type="checkbox"
              checked={labelsVisible}
              aria-label="Beschriftung anzeigen"
              onChange={(event) => setLabelsVisible(event.currentTarget.checked)}
            />
            <span>Beschriftung</span>
          </label>
          <label className="lagekarte-radar-toggle">
            <input
              type="checkbox"
              checked={radarVisible}
              aria-label="Regenradar anzeigen"
              onChange={(event) => setRadarVisible(event.currentTarget.checked)}
            />
            <span>Regenradar</span>
          </label>
          <label className="lagekarte-radar-toggle">
            <input
              type="checkbox"
              checked={konradVisible}
              aria-label="KONRAD3D anzeigen"
              onChange={(event) => {
                const v = event.currentTarget.checked;
                setKonradVisible(v);
                if (!v) setKonradInfoActive(false);
              }}
            />
            <span>KONRAD3D</span>
          </label>
          {konradVisible && (
            <button
              className={`btn btn--ghost lagekarte-info-btn ${konradInfoActive ? "is-active" : ""}`}
              type="button"
              title="KONRAD3D Zell-Info: aktivieren, dann auf eine Zelle klicken"
              aria-pressed={konradInfoActive}
              onClick={() => setKonradInfoActive((v) => !v)}
            >
              ℹ
            </button>
          )}
          {writable && (
            <>
              <button
                className="btn btn--ghost"
                type="button"
                onClick={() => importInputRef.current?.click()}
              >
                Import
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={importMap}
              />
            </>
          )}
          {importMessage && (
            <span className="chip" role="status" aria-live="polite">
              {importMessage}
            </span>
          )}
          <span className="chip">{writable ? "Bearbeiten" : "Nur Lesen"}</span>
        </div>
      )}
      <div className="lagekarte-stage">
        <div
          className={`lagekarte-map ${selectedSymbol || activeDraw ? "lagekarte-map--placing" : ""}`}
          ref={mapElementRef}
        />
        {writable && (
          <div className="lagekarte-draw" role="toolbar" aria-label="Fläche zeichnen">
            <div className="lagekarte-draw__shapes">
              {(
                [
                  ["Polygon", "Polygon"],
                  ["Rectangle", "Rechteck"],
                  ["Circle", "Kreis"],
                ] as const
              ).map(([shape, text]) => (
                <button
                  className={activeDraw?.shape === shape ? "lagekarte-draw__shape--active" : ""}
                  type="button"
                  key={shape}
                  aria-pressed={activeDraw?.shape === shape}
                  onClick={() => enableDrawing(shape)}
                >
                  {text}
                </button>
              ))}
            </div>
            <div className="lagekarte-swatches" aria-label="Flächenfarbe">
              {AREA_COLORS.map(({ color, label: colorLabel }) => (
                <button
                  className={drawColor === color ? "lagekarte-swatch--active" : ""}
                  type="button"
                  key={color}
                  title={colorLabel}
                  aria-label={colorLabel}
                  aria-pressed={drawColor === color}
                  style={{ backgroundColor: color }}
                  onClick={() => changeDrawColor(color)}
                />
              ))}
            </div>
            <label className="lagekarte-opacity">
              <span>Deckkraft {Math.round(drawOpacity * 100)} %</span>
              <input
                type="range"
                min="0.1"
                max="0.6"
                step="0.05"
                value={drawOpacity}
                onChange={(event) => changeDrawOpacity(Number(event.target.value))}
              />
            </label>
            {activeDraw && (
              <button className="lagekarte-draw__cancel" type="button" onClick={cancelDrawing}>
                Abbrechen <span>Esc</span>
              </button>
            )}
          </div>
        )}
        {writable && (
          <Palette
            symbols={symbols}
            selectedSymbolId={selectedSymbol?.id ?? null}
            onSelect={selectPaletteSymbol}
            onDisarm={disarmPlacement}
          />
        )}
        {writable && selectedFeature && (
          <aside
            className="lagekarte-editor"
            aria-label={selectedFeature.kind === "area" ? "Fläche bearbeiten" : "Taktisches Zeichen bearbeiten"}
          >
            <div className="lagekarte-panel__head">
              <div>
                <span className="eyebrow">Auswahl</span>
                <h2>{selectedFeature.kind === "area" ? "Fläche bearbeiten" : "Zeichen bearbeiten"}</h2>
              </div>
              <button
                className="lagekarte-editor__close"
                type="button"
                aria-label="Bearbeitung schließen"
                onClick={clearFeatureSelection}
              >
                ×
              </button>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                saveSelectedFeature();
              }}
            >
              {selectedFeature.kind === "area" && (
                <>
                  <fieldset className="lagekarte-field lagekarte-field--swatches">
                    <legend>Farbe</legend>
                    <div className="lagekarte-swatches">
                      {AREA_COLORS.map(({ color, label: colorLabel }) => (
                        <button
                          className={areaColor === color ? "lagekarte-swatch--active" : ""}
                          type="button"
                          key={color}
                          title={colorLabel}
                          aria-label={colorLabel}
                          aria-pressed={areaColor === color}
                          style={{ backgroundColor: color }}
                          onClick={() => setAreaColor(color)}
                        />
                      ))}
                    </div>
                  </fieldset>
                  <label className="lagekarte-field lagekarte-opacity">
                    <span>Deckkraft {Math.round(areaOpacity * 100)} %</span>
                    <input
                      type="range"
                      min="0.1"
                      max="0.6"
                      step="0.05"
                      value={areaOpacity}
                      onChange={(event) => setAreaOpacity(Number(event.target.value))}
                    />
                  </label>
                </>
              )}
              <label className="lagekarte-field">
                <span>Bezeichnung</span>
                <input value={label} onChange={(event) => setLabel(event.target.value)} />
              </label>
              <label className="lagekarte-field">
                <span>Beschreibung</span>
                <textarea
                  rows={4}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <div className="lagekarte-editor__actions">
                <button className="lagekarte-delete" type="button" onClick={deleteSelectedFeature}>
                  Löschen
                </button>
                <button className="btn btn--primary" type="submit">
                  Speichern
                </button>
              </div>
            </form>
          </aside>
        )}
      </div>
    </div>
  );
}
