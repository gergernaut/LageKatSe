import { type ChangeEvent, useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import type { Map as YMap, YMapEvent } from "yjs";
import { canWrite, LAGEKARTE_FEATURES, type MapFeature } from "@lagekatse/shared";
import {
  applyLagekarteImport,
  isCoordinate,
  isRecord,
  parseLagekarteFeatures,
} from "./applyImport";
import type { Session } from "../session";
import { connectModule } from "../sync/provider";
import { uid } from "../uid";
import { dug } from "../dug";
import { formatDateTime } from "../format";
import { api } from "../api";
import { toPng } from "html-to-image";
import { tileConfig } from "../config";
import { fetchPegelStations, pegelStatusColor, pegelStatusText, type PegelStation } from "../pegel";
import { formatDistance } from "../distance";
import { fetchLatestRadar, fetchRadarFrames, type RadarFrame } from "../brightskyRadar";
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
  dashArray: string;
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
const RADAR_PLAYING_KEY = "lagekatse.radarPlaying";
const KONRAD_VISIBLE_KEY = "lagekatse.konradVisible";
// Radar-Animation (#166): Fenster der Historie und Anzeigetakt pro Frame.
const RADAR_LOOP_MINUTES = 60; // ~12 Frames à 5 min
const RADAR_FRAME_MS = 600; // Wiedergabe-Geschwindigkeit

// Kompakte Uhrzeit (HH:MM, lokal) des gerade gezeigten Radar-Frames.
function formatRadarTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
const PEGEL_VISIBLE_KEY = "lagekatse.pegelVisible";
// Quellenvermerk der Pegeldaten (WSV/PEGELONLINE, Behördendaten mit
// Namensnennung). Analog zu den DWD-Overlays; nur sichtbar wenn das Overlay an
// ist. Anders als bei tileLayern trägt eine layerGroup ihre attribution nicht
// automatisch, daher verwalten wir sie am Toggle selbst.
const PEGEL_ATTRIBUTION = "Pegel: PEGELONLINE (WSV)";
const SYMBOL_SIZE_MIN = 0.6;
const SYMBOL_SIZE_MAX = 2;

function clampSymbolSize(value: number): number {
  return Math.min(SYMBOL_SIZE_MAX, Math.max(SYMBOL_SIZE_MIN, value));
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
    dashArray: draw.dashArray || "",
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
      dashArray: feature.dashArray || undefined,
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

    // Zusatz-Layer (Mittelpunkt-Punkt, Beschriftung) — dem Kreis/der Fläche
    // beigelegt, ohne sie selbst zu mutieren (Invariante #1: reiner Render-Pfad).
    const extras: L.Layer[] = [];

    // Mittelpunkt bei Kreisen (#186): kleiner, gleichfarbiger, nicht-interaktiver
    // Punkt am Zentrum — macht das exakte Zentrum sichtbar (radius in Pixeln).
    if (feature.shape === "circle" && feature.geometry[0]) {
      extras.push(
        L.circleMarker(feature.geometry[0], {
          radius: 3,
          color: feature.color,
          fillColor: feature.color,
          fillOpacity: 1,
          weight: 1,
          interactive: false,
        }),
      );
    }

    const label = feature.label?.trim();
    if (labelsVisible && label) {
      const labelElement = document.createElement("div");
      labelElement.className = "lagekarte-area-label__text";
      labelElement.textContent = label;
      labelElement.style.backgroundColor = `color-mix(in srgb, ${feature.color} 14%, transparent)`;
      labelElement.style.color = `color-mix(in srgb, ${feature.color} 72%, black)`;
      labelElement.style.borderColor = feature.color;
      const center =
        feature.shape === "circle" ? feature.geometry[0] : shape.getBounds().getCenter();
      if (center) {
        extras.push(
          L.marker(center, {
            icon: L.divIcon({
              className: "lagekarte-area-label",
              html: labelElement,
              iconAnchor: [0, 0],
              iconSize: [0, 0],
            }),
            interactive: false,
            keyboard: false,
          }),
        );
      }
    }

    if (extras.length === 0) return shape;
    return L.featureGroup([shape, ...extras]);
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
  // Lokale Rotations-Vorschau: dreht das Icon des ausgewählten Symbols direkt beim
  // Slider-Ziehen, ohne ins CRDT zu schreiben (persistiert wird erst beim Speichern).
  const previewRotationRef = useRef<((id: string, deg: number) => void) | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [symbols, setSymbols] = useState<PaletteSymbol[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<PaletteSymbol | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<MapFeature | null>(null);
  const [importMessage, setImportMessage] = useState("");
  const [activeDraw, setActiveDraw] = useState<ActiveDraw | null>(null);
  const [drawColor, setDrawColor] = useState("#d5372b");
  const [drawOpacity, setDrawOpacity] = useState(0.3);
  const [drawDash, setDrawDash] = useState("");
  // Mess-Tool (#175): client-lokal, ephemeral (Invariante #4) — kein CRDT-Write.
  const [measureActive, setMeasureActive] = useState(false);
  const [measureResult, setMeasureResult] = useState<string | null>(null);
  const measureActiveRef = useRef(measureActive);
  const measureStartRef = useRef<L.LatLng | null>(null);
  const measureLayerRef = useRef<L.LayerGroup | null>(null);
  // Live-Vorschau der Messlinie ab dem Startpunkt (#187): folgt dem Cursor bis
  // zum zweiten Klick. Liegt im measureLayer, wird also beim Moduswechsel
  // mit-geleert; die Ref hier nur, um sie zwischen den Effekten zu nullen.
  const measurePreviewRef = useRef<{ line: L.Polyline; label: L.Marker } | null>(null);
  const [areaColor, setAreaColor] = useState("#d5372b");
  const [areaOpacity, setAreaOpacity] = useState(0.3);
  const [areaDash, setAreaDash] = useState("");
  // Radius des ausgewählten Kreises in Metern, im Editor bearbeitbar (#186).
  const [areaRadius, setAreaRadius] = useState(0);
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  // Ausrichtung des ausgewählten Symbols (0–359°, 0 = Norden). Pro Symbol, nicht global
  // (anders als Symbolgröße/E9); wird beim Speichern über die Feature-Y.Map gesetzt (#69).
  const [rotation, setRotation] = useState(0);
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
  // Regenradar via Bright Sky (#166): reprojiziertes Bild-Overlay statt WMS.
  const radarLayerRef = useRef<L.ImageOverlay | null>(null);
  const [radarLoading, setRadarLoading] = useState(false);
  // Radar-Animations-Loop (#166): optional per Play-Button, client-lokal
  // (localStorage, Invariante #4) wie die Sichtbarkeit selbst.
  const [radarPlaying, setRadarPlaying] = useState(() => {
    try {
      return localStorage.getItem(RADAR_PLAYING_KEY) === "true";
    } catch {
      return false;
    }
  });
  const radarPlayingRef = useRef(radarPlaying);
  // Uhrzeit des aktuell gezeigten Frames (nur während der Animation angezeigt).
  const [radarFrameTime, setRadarFrameTime] = useState<string | null>(null);
  // Steuerung des Radar-Overlays (Einzelbild vs. Loop); vom Map-Init-Effekt gesetzt.
  const radarCtlRef = useRef<{
    refresh: () => void;
    setPlaying: (playing: boolean) => void;
    hide: () => void;
    teardown: () => void;
  } | null>(null);
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
  // Pegelstände-Overlay (#84, PEGELONLINE/WSV): client-lokale Anzeige-Option
  // (localStorage, Invariante #4) — wie Radar/KONRAD3D, nicht im CRDT.
  const [pegelVisible, setPegelVisible] = useState(() => {
    try {
      return localStorage.getItem(PEGEL_VISIBLE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const pegelVisibleRef = useRef(pegelVisible);
  const pegelLayerRef = useRef<L.LayerGroup | null>(null);
  const pegelLoadedRef = useRef(false);
  const [pegelLoading, setPegelLoading] = useState(false);
  const loadPegelRef = useRef<(() => void) | null>(null);
  const writable = !readOnly && canWrite(session.roles, "lagekarte", {
    allowMonitorChat: session.room.settings.allowMonitorChat,
  });
  // Pegel→ETB ist ein server-autoritativer ETB-Eintrag (Invariante #6) → braucht
  // etb-Schreibrecht und ist in der eingebetteten Read-only-Karte deaktiviert.
  const etbWritable = !readOnly && canWrite(session.roles, "etb", {
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
    if (!radarCtlRef.current) return; // vor Map-Init: der Init-Effekt lädt initial selbst
    if (radarVisible) radarCtlRef.current.refresh(); // Einzelbild oder Loop je nach Play-Status
    else radarCtlRef.current.hide();
  }, [radarVisible]);

  useEffect(() => {
    radarPlayingRef.current = radarPlaying;
    try {
      localStorage.setItem(RADAR_PLAYING_KEY, String(radarPlaying));
    } catch {
      // The preference remains active for this session when storage is unavailable.
    }
    if (!radarCtlRef.current || !radarVisibleRef.current) return;
    radarCtlRef.current.setPlaying(radarPlaying);
  }, [radarPlaying]);

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
    pegelVisibleRef.current = pegelVisible;
    try {
      localStorage.setItem(PEGEL_VISIBLE_KEY, String(pegelVisible));
    } catch {
      // The preference remains active for this session when storage is unavailable.
    }
    const map = mapRef.current;
    const layer = pegelLayerRef.current;
    if (!map || !layer) return; // vor Map-Init: der Init-Effekt lädt initial selbst
    if (pegelVisible) {
      layer.addTo(map);
      map.attributionControl.addAttribution(PEGEL_ATTRIBUTION);
      loadPegelRef.current?.(); // erster Abruf beim Einschalten (Guard in loadPegel)
    } else {
      layer.remove();
      map.attributionControl.removeAttribution(PEGEL_ATTRIBUTION);
    }
  }, [pegelVisible]);

  useEffect(() => {
    konradInfoActiveRef.current = konradInfoActive;
    const map = mapRef.current;
    if (!map) return;
    // Cursor wechselt auf "help", wenn der Info-Modus aktiv ist
    const container = map.getContainer();
    if (konradInfoActive) container.classList.add("lagekarte-info-cursor");
    else container.classList.remove("lagekarte-info-cursor");
  }, [konradInfoActive]);

  // Mess-Tool-Toggle (#175): LayerGroup an/aus, Cursor wechseln, Messung zurücksetzen.
  useEffect(() => {
    measureActiveRef.current = measureActive;
    // Symmetrischer Ausschluss: Messen an => Zeichnen abbrechen + Symbolwahl leeren
    // (die anderen Richtungen machen enableDrawing/selectPaletteSymbol).
    if (measureActive) {
      mapRef.current?.pm.disableDraw();
      activeDrawRef.current = null;
      setActiveDraw(null);
      selectedSymbolRef.current = null;
      setSelectedSymbol(null);
    }
    const map = mapRef.current;
    const layer = measureLayerRef.current;
    if (layer) {
      if (measureActive) layer.addTo(map!);
      // Messmodus verlassen: Linien/Labels verwerfen (nicht nur ausblenden) —
      // sonst tauchen alle alten Messungen beim erneuten Aktivieren wieder auf (#175).
      else {
        layer.clearLayers();
        layer.remove();
      }
    }
    measureStartRef.current = null;
    measurePreviewRef.current = null; // Vorschau wurde mit clearLayers() entfernt (#187)
    if (!measureActive) setMeasureResult(null);
    const container = map?.getContainer();
    if (container) container.classList.toggle("lagekarte-measure-cursor", measureActive);
  }, [measureActive]);

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
      setAreaDash(selectedFeature.dashArray ?? "");
      setAreaRadius(Math.round(selectedFeature.radiusM ?? 0));
    } else {
      setRotation(selectedFeature.rotation ?? 0);
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
    // Marker mit dem persistierten Stand abgleichen: bei Abbruch revertiert das die
    // lokale Vorschau, beim Speichern (CRDT bereits gesetzt) bestätigt es den neuen Wert.
    const prevId = selectedFeatureIdRef.current;
    if (prevId) {
      const feature = featuresMapRef.current?.get(prevId);
      if (feature?.kind === "symbol") previewRotationRef.current?.(prevId, feature.rotation);
    }
    selectedFeatureIdRef.current = null;
    setSelectedFeature(null);
  };

  const selectPaletteSymbol = (symbol: PaletteSymbol) => {
    mapRef.current?.pm.disableDraw();
    activeDrawRef.current = null;
    setActiveDraw(null);
    setMeasureActive(false); // Mess-Tool und Symbol-Platzieren schließen sich aus (#175)
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

  const enableDrawing = (shape: DrawShape, color = drawColor, opacity = drawOpacity, dash = drawDash) => {
    if (!writableRef.current) return;
    setMeasureActive(false); // Mess-Tool und Zeichnen schließen sich gegenseitig aus (#175)
    if (activeDrawRef.current?.shape === shape && color === drawColor && opacity === drawOpacity && dash === drawDash) {
      cancelDrawing();
      return;
    }

    selectedSymbolRef.current = null;
    setSelectedSymbol(null);
    const draw = { shape, color, opacity, dashArray: dash };
    activeDrawRef.current = draw;
    setActiveDraw(draw);
    const map = mapRef.current;
    if (!map) return;
    map.pm.disableDraw();
    map.pm.enableDraw(shape, {
      pathOptions: { color, fillColor: color, fillOpacity: opacity, dashArray: dash || undefined },
    });
  };

  const changeDrawColor = (color: string) => {
    setDrawColor(color);
    const current = activeDrawRef.current;
    if (current) enableDrawing(current.shape, color, current.opacity, current.dashArray);
  };

  const changeDrawOpacity = (opacity: number) => {
    setDrawOpacity(opacity);
    const current = activeDrawRef.current;
    if (current) enableDrawing(current.shape, current.color, opacity, current.dashArray);
  };

  const changeDrawDash = (dash: string) => {
    setDrawDash(dash);
    const current = activeDrawRef.current;
    if (current) enableDrawing(current.shape, current.color, current.opacity, dash);
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
        dashArray: areaDash || "",
        // Radius nur bei Kreisen mitschreiben (#186); >0 erzwingen, damit ein
        // versehentlich geleertes Feld den Kreis nicht kollabieren lässt.
        ...(current.shape === "circle" ? { radiusM: Math.max(1, areaRadius) } : {}),
        label,
        description,
        updatedAt,
      });
    } else {
      featuresMap.set(current.id, {
        ...current,
        rotation: ((Math.round(rotation) % 360) + 360) % 360, // auf 0–359 normalisieren
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
    link.download = `lagekarte-${session.room.joinCode}-${dug()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  // ---- PDF-Export (aktueller Kartenausschnitt) ----
  const [pdfBusy, setPdfBusy] = useState(false);
  const exportPdf = async () => {
    if (pdfBusy) return;
    const map = mapRef.current;
    if (!map) return;
    setPdfBusy(true);
    try {
      // 1. Auf Kacheln warten (damit die Karte vollständig geladen ist)
      await new Promise((resolve) => setTimeout(resolve, 500));
      // 2. Karten-Container rastern (html-to-image inlined die Kacheln per fetch;
      //    OSM sendet CORS-Header → untainted). DWD-Overlay-Kacheln werden im
      //    filter übersprungen (nicht per fetch inline-bar).
      const container = map.getContainer();
      const pngDataUri = await toPng(container, {
        cacheBust: true,
        pixelRatio: 2,
        filter: (node) => {
          // Leaflet-Controls (Zoom etc.) ausblenden — nur die Karte
          if (node instanceof HTMLElement && node.className?.includes?.("leaflet-control"))
            return false;
          // DWD-WMS-Overlay-Kacheln (Radar/KONRAD3D) überspringen — html-to-image kann
          // sie nicht inlinen ("Failed to fetch"), sonst bricht der PDF-Export ab.
          if (node instanceof HTMLImageElement && node.src.includes("maps.dwd.de"))
            return false;
          return true;
        },
      });
      // 3. PDF bauen (pdf-lib, client-seitig)
      const { lagekarteToPngPdf } = await import("../pdf");
      const bytes = await lagekarteToPngPdf(pngDataUri, {
        roomName: session.room.name,
        joinCode: session.room.joinCode,
        stamp: dug(),
      });
      // 4. Download
      const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `lagekarte-${session.room.joinCode}-${dug()}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.debug("Lagekarten-PDF-Export fehlgeschlagen", err);
      window.alert("PDF-Export fehlgeschlagen.");
    } finally {
      setPdfBusy(false);
    }
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
      const result = parseLagekarteFeatures(parsed);
      if (!result) {
        setImportMessage("Import fehlgeschlagen: ungültiges Dateiformat.");
        return;
      }

      const featuresMap = featuresMapRef.current;
      if (!writableRef.current || !featuresMap) {
        setImportMessage("Import fehlgeschlagen: Karte ist noch nicht bereit.");
        return;
      }

      // Einzeldatei-Import mischt in den Bestand (replace:false); der Bundle-Import
      // ersetzt. Kartenansicht ist Leaflet-lokal, daher hier (nicht im Apply-Helfer).
      applyLagekarteImport(featuresMap, result.valid, { replace: false });

      if (
        isRecord(parsed) &&
        isRecord(parsed.view) &&
        isCoordinate(parsed.view.center) &&
        typeof parsed.view.zoom === "number" &&
        Number.isFinite(parsed.view.zoom)
      ) {
        mapRef.current?.setView(parsed.view.center, parsed.view.zoom);
      }

      const skipped = result.total - result.valid.length;
      setImportMessage(
        `${result.valid.length} Feature${result.valid.length === 1 ? "" : "s"} importiert${
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

    // Eigene Panes für die Wetter-Overlays, damit die Stapelreihenfolge stimmt
    // (#166-Folge): Basiskarte (tilePane z200) < Regenradar < KONRAD3D < taktische
    // Flächen (overlayPane z400) < Symbole (markerPane z600). Ohne das läge das
    // Radar-imageOverlay (overlayPane) über dem KONRAD3D-WMS (tilePane) und
    // verdeckte die Gewitterzellen. pointer-events: none → Klicks fallen zur Karte
    // durch (KONRAD3D-Zell-Info läuft über den map-click-Handler, nicht den Layer).
    const radarPane = map.createPane("radarPane");
    radarPane.style.zIndex = "250";
    radarPane.style.pointerEvents = "none";
    const konradPane = map.createPane("konradPane");
    konradPane.style.zIndex = "300";
    konradPane.style.pointerEvents = "none";
    // Grundkarte: URL/Zoom/Attribution kommen aus der Konfiguration (#96),
    // damit im geschlossenen Netz auf einen lokalen Tile-Server gezeigt werden
    // kann. Default bleibt OSM-Public. Siehe src/config.ts.
    L.tileLayer(tileConfig.url, {
      maxZoom: tileConfig.maxZoom,
      attribution: tileConfig.attribution,
    }).addTo(map);

    // DWD-Regenradar via Bright Sky (#166): Das DWD-WMS rendert on-the-fly (kein
    // GeoWebCache, 4–39 s, s. #116). Bright Sky liefert dasselbe RADOLAN-RV-Produkt
    // als Rohgitter in ~0,15–1 s (CORS-offen wie das Wetter); wir reprojizieren es
    // client-seitig nach Web-Mercator (proj4, s. brightskyRadar.ts) und legen es als
    // Bild-Overlay. Sichtbarkeit client-lokal (radarVisible, Invariante #4).
    //
    // Zwei Modi: Einzelbild (neuester Frame) oder Animations-Loop über die letzte
    // Stunde. Der Loop hält alle Frames als vorgerenderte Daten-URLs vor und tauscht
    // im Takt nur die src eines EINZIGEN, dauerhaften imageOverlay (setUrl) → keine
    // Layer-Neuanlage, kein Flackern. Frames werden bewusst nur bei sichtbarem Radar
    // geladen (radarVisibleRef-Guards).
    let radarAbort: AbortController | null = null;
    let radarUrls: string[] = [];
    let radarTimes: string[] = [];
    let radarBounds: RadarFrame["bounds"] | null = null;
    let frameIdx = 0;
    let animTimer: number | null = null;

    const stopAnim = () => {
      if (animTimer != null) {
        window.clearInterval(animTimer);
        animTimer = null;
      }
    };

    // Zeigt Frame i: ein persistentes Overlay, nur die src (und Bounds) wechseln.
    const showFrame = (i: number) => {
      if (i < 0 || i >= radarUrls.length || !radarBounds || !mapRef.current) return;
      frameIdx = i;
      if (radarLayerRef.current) {
        radarLayerRef.current.setUrl(radarUrls[i]);
        radarLayerRef.current.setBounds(L.latLngBounds(radarBounds));
      } else {
        radarLayerRef.current = L.imageOverlay(radarUrls[i], radarBounds, {
          opacity: 1,
          interactive: false,
          pane: "radarPane", // unter KONRAD3D (s. Pane-Setup)
          attribution: "Radar: DWD via Bright Sky",
        }).addTo(mapRef.current);
      }
    };

    const ignoreAbort = (error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        console.debug("Bright-Sky-Radar fehlgeschlagen", error);
      }
    };

    // Einzelbild: neuester Frame, kein Loop.
    const loadStatic = () => {
      radarAbort?.abort();
      radarAbort = new AbortController();
      const signal = radarAbort.signal;
      stopAnim();
      setRadarLoading(true);
      fetchLatestRadar(signal)
        .then((frame) => {
          if (signal.aborted || !radarVisibleRef.current || radarPlayingRef.current) return;
          radarUrls = [frame.canvas.toDataURL("image/png")];
          radarTimes = [frame.timestamp];
          radarBounds = frame.bounds;
          showFrame(0);
          setRadarFrameTime(null);
        })
        .catch(ignoreAbort)
        .finally(() => {
          if (!signal.aborted) setRadarLoading(false);
        });
    };

    // Loop: Frames der letzten Stunde laden, ab dem neuesten im Takt durchspielen.
    const loadLoop = () => {
      radarAbort?.abort();
      radarAbort = new AbortController();
      const signal = radarAbort.signal;
      stopAnim();
      setRadarLoading(true);
      fetchRadarFrames(RADAR_LOOP_MINUTES, signal)
        .then((frames) => {
          if (signal.aborted || !radarVisibleRef.current || !radarPlayingRef.current) return;
          radarUrls = frames.map((f) => f.canvas.toDataURL("image/png"));
          radarTimes = frames.map((f) => f.timestamp);
          radarBounds = frames[0].bounds;
          frameIdx = radarUrls.length - 1; // beim Neuesten starten
          showFrame(frameIdx);
          setRadarFrameTime(radarTimes[frameIdx]);
          animTimer = window.setInterval(() => {
            if (!radarPlayingRef.current || radarUrls.length === 0) return;
            const next = (frameIdx + 1) % radarUrls.length;
            showFrame(next);
            setRadarFrameTime(radarTimes[next]);
          }, RADAR_FRAME_MS);
        })
        .catch(ignoreAbort)
        .finally(() => {
          if (!signal.aborted) setRadarLoading(false);
        });
    };

    radarCtlRef.current = {
      refresh: () => {
        if (!radarVisibleRef.current) return;
        if (radarPlayingRef.current) loadLoop();
        else loadStatic();
      },
      setPlaying: (playing) => {
        if (playing) loadLoop();
        else loadStatic();
      },
      hide: () => {
        radarAbort?.abort();
        stopAnim();
        radarLayerRef.current?.remove();
        radarLayerRef.current = null;
        radarUrls = [];
        radarTimes = [];
        setRadarFrameTime(null);
      },
      teardown: () => {
        radarAbort?.abort();
        stopAnim();
      },
    };
    if (radarVisibleRef.current) radarCtlRef.current.refresh();

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
      pane: "konradPane", // über dem Regenradar (s. Pane-Setup)
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
        // WMS 1.3.0 verlangt ganzzahlige Pixel-Indizes fuer i/j. containerPoint
        // liefert bei fraktionalem Display-Scaling / Browser-Zoom Nachkommastellen
        // → GeoServer lehnt sie mit ServiceException "InvalidPoint" ab. Runden und
        // auf den gueltigen Bereich [0, width|height - 1] clampen.
        i: String(Math.max(0, Math.min(Math.round(point.x), size.x - 1))),
        j: String(Math.max(0, Math.min(Math.round(point.y), size.y - 1))),
        feature_count: "1",
      });

      fetch(`https://maps.dwd.de/geoserver/ows?${params}`)
        .then(async (res) => {
          // Defense-in-depth: nicht blind res.json(). Bei HTTP-Fehler oder
          // Nicht-JSON-Antwort (z.B. GeoServer-ServiceException als XML, Proxy-/
          // Portal-HTML) liefert das die Ursache statt eines nackten SyntaxError.
          const ct = res.headers.get("content-type") ?? "";
          if (!res.ok || !ct.includes("json")) {
            const body = await res.text();
            throw new Error(
              `unerwartete Antwort (HTTP ${res.status}, ${ct || "ohne Content-Type"}): ${body.slice(0, 200)}`,
            );
          }
          return res.json();
        })
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
        .catch((err: unknown) => {
          console.debug("KONRAD3D GetFeatureInfo fehlgeschlagen", err);
        });
    };
    map.on("click", konradClick);

    // Overlays periodisch aktualisieren (DWD liefert neue Zeitschritte ~alle 5 Min):
    // Regenradar (Bright Sky) neu holen + reprojizieren, KONRAD3D-WMS via redraw().
    const refreshWmsLayers = () => {
      radarCtlRef.current?.refresh(); // Einzelbild neu holen bzw. Loop-Fenster nachladen
      konradLayerRef.current?.redraw();
    };
    const wmsRefreshTimer = window.setInterval(refreshWmsLayers, 5 * 60 * 1000);

    // --- Pegelstände-Overlay (#84, PEGELONLINE/WSV) ---
    // Punkte via Canvas-Renderer (performant bei ~700 Pegeln); Daten lazy beim
    // ersten Einschalten, danach alle 5 Min aktualisiert. API ist CORS-offen →
    // reiner Client-Abruf, kein Server-/CRDT-Anteil (Invariante #4).
    const pegelCanvas = L.canvas({ padding: 0.5 });
    const pegelLayer = L.layerGroup();
    pegelLayerRef.current = pegelLayer;
    if (pegelVisibleRef.current) {
      pegelLayer.addTo(map);
      map.attributionControl.addAttribution(PEGEL_ATTRIBUTION);
    }

    // --- Mess-Tool (#175) ---
    // Messlinien/Labels sammeln sich in einer eigenen LayerGroup; beim Deaktivieren
    // alles wegwerfen. Ephemeral (Invariante #4) — nichts synchronisiert.
    const measureLayer = L.layerGroup();
    measureLayerRef.current = measureLayer;
    if (measureActiveRef.current) measureLayer.addTo(map);

    const buildPegelPopup = (st: PegelStation): HTMLElement => {
      const el = document.createElement("div");
      el.className = "pegel-popup";
      const title = document.createElement("b");
      title.textContent = st.water ? `${st.name} · ${st.water}` : st.name;
      el.appendChild(title);
      const table = document.createElement("table");
      const addRow = (k: string, v: string) => {
        const tr = document.createElement("tr");
        const tdK = document.createElement("td");
        tdK.textContent = k;
        const tdV = document.createElement("td");
        tdV.textContent = v;
        tr.append(tdK, tdV);
        table.appendChild(tr);
      };
      addRow("Wasserstand", `${st.value} ${st.unit}`.trim());
      addRow(st.state === "commented" ? "Hinweis" : "Status", pegelStatusText(st));
      addRow("Stand", formatDateTime(st.timestamp));
      el.appendChild(table);
      // Pegel→ETB (Bonus): server-autoritativer Eintrag (Invariante #6), nur mit
      // etb-Schreibrecht. Textcontent statt innerHTML → keine Injection über Namen.
      if (etbWritable) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pegel-etb-btn";
        btn.textContent = "In ETB übernehmen";
        btn.onclick = async () => {
          btn.disabled = true;
          btn.textContent = "…";
          try {
            await api.createEtbEntry(session.room.joinCode, session.token, {
              inhalt: `Pegel ${st.name}${st.water ? ` (${st.water})` : ""}: ${st.value} ${st.unit} (${pegelStatusText(st)}), Stand ${formatDateTime(st.timestamp)}`,
              von: "PEGELONLINE/WSV",
            });
            btn.textContent = "✓ im ETB";
          } catch {
            btn.disabled = false;
            btn.textContent = "Fehler — erneut";
          }
        };
        el.appendChild(btn);
      }
      return el;
    };

    const buildPegelMarkers = (stations: PegelStation[]) => {
      pegelLayer.clearLayers();
      for (const st of stations) {
        const marker = L.circleMarker([st.lat, st.lon], {
          renderer: pegelCanvas,
          radius: 5,
          weight: 1.5,
          color: "#ffffff",
          fillColor: pegelStatusColor(st.state),
          fillOpacity: 0.9,
        });
        marker.bindPopup(() => buildPegelPopup(st), { className: "pegel-popup-wrapper", maxWidth: 260 });
        pegelLayer.addLayer(marker);
      }
    };

    let pegelCancelled = false;
    const loadPegel = async () => {
      if (pegelLoadedRef.current) return; // in diesem Mount bereits geladen — Marker liegen im Layer
      setPegelLoading(true);
      try {
        const stations = await fetchPegelStations();
        if (pegelCancelled) return; // Karte inzwischen abgebaut (StrictMode-Remount / Modulwechsel)
        pegelLoadedRef.current = true;
        buildPegelMarkers(stations);
      } catch (err) {
        console.debug("Pegel-Abruf fehlgeschlagen", err);
      } finally {
        if (!pegelCancelled) setPegelLoading(false);
      }
    };
    loadPegelRef.current = loadPegel;
    if (pegelVisibleRef.current) void loadPegel();

    const pegelRefreshTimer = window.setInterval(() => {
      if (!pegelVisibleRef.current) return;
      pegelLoadedRef.current = false; // erneutes Laden zulassen
      void loadPegel();
    }, 5 * 60 * 1000);

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
          // Ist ein Palette-Symbol aktiv, setzt der Klick ein Zeichen (auch über
          // einem vorhandenen), statt dieses auszuwählen (#152).
          if (placePendingSymbol(event.latlng)) return;
          if (!writableRef.current) return;
          const current = featuresMap.get(id);
          if (current?.kind !== "symbol") return;
          selectedFeatureIdRef.current = id;
          setSelectedFeature(current);
        });
      } else if (feature.kind === "area") {
        layer.on("click", (event) => {
          L.DomEvent.stopPropagation(event);
          // Klick in eine Fläche soll im Platzier-Modus ein Zeichen setzen, statt
          // die Fläche auszuwählen — sonst ließe sich in Flächen nichts setzen (#152).
          if (placePendingSymbol(event.latlng)) return;
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
    // Nur die Icon-Rotation des Markers lokal setzen (kein CRDT-Write, kein Broadcast).
    previewRotationRef.current = (id, deg) => {
      const layer = layers.get(id);
      const element = layer instanceof L.Marker ? layer.getElement() : null;
      const image = element?.querySelector("img");
      if (image) image.style.transform = `rotate(${deg}deg)`;
    };

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

    // Setzt das in der Palette aktive Symbol an `latlng` und meldet, ob platziert
    // wurde. Wird sowohl vom leeren Karten-Klick als auch von den Feature-Klick-
    // Handlern genutzt: interaktive Layer (Flächen/Marker) schlucken sonst den
    // Karten-`click`, sodass man kein Zeichen in eine Fläche setzen könnte (#152).
    const placePendingSymbol = (latlng: L.LatLng): boolean => {
      if (!writableRef.current) return false;
      if (activeDrawRef.current) return false;
      const symbol = selectedSymbolRef.current;
      if (!symbol) return false;
      const id = uid();
      const now = new Date().toISOString();
      const feature: SymbolFeature = {
        id,
        kind: "symbol",
        symbolId: symbol.id,
        position: [latlng.lat, latlng.lng],
        rotation: 0,
        label: symbol.label,
        description: "",
        createdBy: session.name,
        createdAt: now,
        updatedAt: now,
      };
      featuresMap.set(id, feature);
      return true;
    };

    const measureLabelIcon = (text: string) =>
      L.divIcon({ className: "lagekarte-measure-label", html: `<span>${text}</span>`, iconSize: [0, 0] });
    const midpoint = (a: L.LatLng, b: L.LatLng) =>
      L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);

    const onMapClick = (event: L.LeafletMouseEvent) => {
      placePendingSymbol(event.latlng);
      // Mess-Tool (#175): zwei Klicks = eine Entfernung. Client-lokal & ephemeral
      // (Invariante #4) — Messlinien sind Anzeige, kein synchronisierter Zustand.
      // Auch für den Monitor (reine Anzeige, kein CRDT-Write).
      if (measureActiveRef.current) {
        const start = measureStartRef.current;
        if (!start) {
          measureStartRef.current = event.latlng;
          return;
        }
        const meters = map.distance(start, event.latlng);
        const text = formatDistance(meters);
        L.polyline([start, event.latlng], {
          color: "var(--signal)", weight: 2, dashArray: "6,6", interactive: false,
        }).addTo(measureLayer);
        L.marker(midpoint(start, event.latlng), {
          icon: measureLabelIcon(text), interactive: false, keyboard: false,
        }).addTo(measureLayer);
        setMeasureResult(text);
        // Vorschau in die feste Linie überführt → entfernen (#187).
        if (measurePreviewRef.current) {
          measureLayer.removeLayer(measurePreviewRef.current.line);
          measureLayer.removeLayer(measurePreviewRef.current.label);
          measurePreviewRef.current = null;
        }
        measureStartRef.current = null; // nächste zwei Klicks = neue Messung
      }
    };
    map.on("click", onMapClick);

    // Live-Vorschau (#187): ab dem ersten Klick eine gestrichelte Linie + Distanz
    // am Cursor zeigen (analog zum Kreis-Radius-Tooltip), bis der zweite Klick sie
    // fixiert. Rein ephemeral im measureLayer (Invariante #4).
    const onMeasureMove = (event: L.LeafletMouseEvent) => {
      const start = measureActiveRef.current ? measureStartRef.current : null;
      if (!start) return;
      const text = formatDistance(map.distance(start, event.latlng));
      const mid = midpoint(start, event.latlng);
      const preview = measurePreviewRef.current;
      if (!preview) {
        const line = L.polyline([start, event.latlng], {
          color: "var(--signal)", weight: 2, dashArray: "6,6", opacity: 0.6, interactive: false,
        }).addTo(measureLayer);
        const label = L.marker(mid, {
          icon: measureLabelIcon(text), interactive: false, keyboard: false,
        }).addTo(measureLayer);
        measurePreviewRef.current = { line, label };
      } else {
        preview.line.setLatLngs([start, event.latlng]);
        preview.label.setLatLng(mid);
        preview.label.setIcon(measureLabelIcon(text));
      }
    };
    map.on("mousemove", onMeasureMove);

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
      workingCircle = null;
    };
    map.on("pm:create", onCreate);

    // Radius-Anzeige beim Kreis-Ziehen (#175): Geoman feuert beim Ziehen KEIN
    // dediziertes drawmove-Event (nur pm:drawstart/-end) — daher lauschen wir auf
    // Leaflets map.mousemove, solange ein Kreis im Zeichnen ist, und zeigen den
    // aktuellen Radius (Meter, Großkreis) als permanenter Tooltip am workingLayer.
    // Reine Anzeige, client-lokal (Invariante #4).
    let workingCircle: L.Circle | null = null;
    const onDrawStart = (event: { shape?: string; workingLayer?: L.Layer }) => {
      if (event.shape !== "Circle") return;
      const layer = event.workingLayer as L.Circle | undefined;
      if (layer) {
        workingCircle = layer;
        layer.bindTooltip("0 m", { permanent: true, direction: "top", className: "lagekarte-radius-tip" });
      }
    };
    const onDrawMove = () => {
      if (workingCircle) {
        workingCircle.setTooltipContent(formatDistance(workingCircle.getRadius()));
      }
    };
    map.on("pm:drawstart", onDrawStart);
    map.on("mousemove", onDrawMove);
    // Abbruch (Esc/Anderes Werkzeug) → Referenz auf den entfernten workingLayer lösen.
    const onDrawEnd = () => {
      workingCircle = null;
    };
    map.on("pm:drawend", onDrawEnd);

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
      map.off("pm:drawstart", onDrawStart);
      map.off("pm:drawend", onDrawEnd);
      map.off("mousemove", onDrawMove);
      map.off("mousemove", onMeasureMove);
      map.off("moveend", persistView);
      featuresMap.unobserve(refresh);
      if (featuresMapRef.current === featuresMap) featuresMapRef.current = null;
      if (mapRef.current === map) mapRef.current = null;
      radarCtlRef.current?.teardown();
      radarCtlRef.current = null;
      radarLayerRef.current = null;
      konradLayerRef.current = null;
      pegelCancelled = true;
      measureLayerRef.current = null;
      window.clearInterval(wmsRefreshTimer);
      window.clearInterval(pegelRefreshTimer);
      pegelLayerRef.current = null;
      loadPegelRef.current = null;
      if (renderForRightsRef.current === renderAll) renderForRightsRef.current = null;
      if (refreshSymbolsRef.current === refreshSymbols) refreshSymbolsRef.current = null;
      previewRotationRef.current = null;
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
          <button className="btn btn--ghost" type="button" onClick={exportPdf} disabled={pdfBusy}>
            {pdfBusy ? "…" : "PDF"}
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
          <label className="lagekarte-radar-toggle" title="DWD-Regenradar (RADOLAN via Bright Sky)">
            <input
              type="checkbox"
              checked={radarVisible}
              aria-label="Regenradar anzeigen"
              onChange={(event) => {
                const v = event.currentTarget.checked;
                setRadarVisible(v);
                if (!v) setRadarPlaying(false); // beim Ausschalten Loop beenden
              }}
            />
            <span>Regenradar{radarVisible && radarLoading ? " …" : ""}</span>
          </label>
          {radarVisible && (
            <button
              className={`btn btn--ghost lagekarte-info-btn ${radarPlaying ? "is-active" : ""}`}
              type="button"
              title={
                radarPlaying
                  ? "Radar-Animation stoppen"
                  : "Radar-Animation abspielen (letzte Stunde)"
              }
              aria-pressed={radarPlaying}
              aria-label="Radar-Animation"
              onClick={() => setRadarPlaying((v) => !v)}
            >
              {radarPlaying ? "⏸" : "▶"}
            </button>
          )}
          {radarVisible && radarPlaying && radarFrameTime && (
            <span className="lagekarte-radar-time" aria-live="polite">
              {formatRadarTime(radarFrameTime)}
            </span>
          )}
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
          <label className="lagekarte-radar-toggle" title="Pegelstände der Bundeswasserstraßen (PEGELONLINE/WSV)">
            <input
              type="checkbox"
              checked={pegelVisible}
              aria-label="Pegelstände anzeigen"
              onChange={(event) => setPegelVisible(event.currentTarget.checked)}
            />
            <span>Pegel{pegelLoading ? " …" : ""}</span>
          </label>
          {/* Mess-Tool (#175): reine Anzeige (Invariante #4) — auch für den Monitor. */}
          <button
            className={`btn btn--ghost lagekarte-measure-btn ${measureActive ? "is-active" : ""}`}
            type="button"
            title={measureActive ? "Messen beenden" : "Entfernung messen: zwei Klicks auf die Karte"}
            aria-pressed={measureActive}
            onClick={() => setMeasureActive((v) => !v)}
          >
            {measureActive ? "Messen beenden" : "Messen"}
          </button>
          {measureResult && <span className="chip lagekarte-measure-result">{measureResult}</span>}
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
            <fieldset className="lagekarte-dash">
              <legend>Linie</legend>
              <button type="button" title="Durchgehend" aria-pressed={drawDash === ""} onClick={() => changeDrawDash("")}>━</button>
              <button type="button" title="Gestrichelt" aria-pressed={drawDash === "5,5"} onClick={() => changeDrawDash("5,5")}>╌</button>
              <button type="button" title="Gepunktet" aria-pressed={drawDash === "2,4"} onClick={() => changeDrawDash("2,4")}>┄</button>
            </fieldset>
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
                  <fieldset className="lagekarte-dash">
                    <legend>Linie</legend>
                    <button type="button" title="Durchgehend" aria-pressed={areaDash === ""} onClick={() => setAreaDash("")}>━</button>
                    <button type="button" title="Gestrichelt" aria-pressed={areaDash === "5,5"} onClick={() => setAreaDash("5,5")}>╌</button>
                    <button type="button" title="Gepunktet" aria-pressed={areaDash === "2,4"} onClick={() => setAreaDash("2,4")}>┄</button>
                  </fieldset>
                  {selectedFeature.shape === "circle" && (
                    <label className="lagekarte-field">
                      <span>Radius {formatDistance(Math.max(1, areaRadius))}</span>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={areaRadius}
                        aria-label="Radius in Metern"
                        onChange={(event) => setAreaRadius(Math.max(0, Math.round(Number(event.target.value))))}
                      />
                    </label>
                  )}
                </>
              )}
              {selectedFeature.kind === "symbol" && (
                <div className="lagekarte-field lagekarte-rotation">
                  <span>
                    Ausrichtung {(((Math.round(rotation) % 360) + 360) % 360)}° <small>(0° = Norden)</small>
                  </span>
                  <div className="lagekarte-rotation__row">
                    <span
                      className="lagekarte-rotation__preview"
                      style={{ transform: `rotate(${rotation}deg)` }}
                      aria-hidden="true"
                    >
                      ↑
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="360"
                      step="5"
                      value={rotation}
                      aria-label="Ausrichtung (Grad)"
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setRotation(value);
                        if (selectedFeature) previewRotationRef.current?.(selectedFeature.id, value);
                      }}
                    />
                    <input
                      type="number"
                      className="lagekarte-rotation__num"
                      min="0"
                      max="360"
                      step="5"
                      value={rotation}
                      aria-label="Ausrichtung in Grad"
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setRotation(value);
                        if (selectedFeature) previewRotationRef.current?.(selectedFeature.id, value);
                      }}
                    />
                  </div>
                </div>
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
