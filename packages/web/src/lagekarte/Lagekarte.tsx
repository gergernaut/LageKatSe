import { useEffect, useRef, useState } from "react";
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

function tooltipText(feature: MapFeature): string | undefined {
  return feature.description || feature.label;
}

function createLayer(
  feature: MapFeature,
  symbolFiles: Map<string, string>,
  writable: boolean,
): L.Layer | null {
  let layer: L.Layer;

  if (feature.kind === "symbol") {
    const file = symbolFiles.get(feature.symbolId);
    if (!file) return null;

    const scale = Number.isFinite(feature.scale) && feature.scale > 0 ? feature.scale : 1;
    const size = 40 * scale;
    const image = document.createElement("img");
    image.src = `/taktische-zeichen/${encodeURI(file)}`;
    image.alt = "";
    image.style.transform = `rotate(${feature.rotation}deg)`;

    const icon = L.divIcon({
      className: "lagekarte-symbol",
      html: image,
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

    if (feature.shape === "circle") {
      const center = feature.geometry[0];
      if (!center) return null;
      layer = L.circle(center, { ...options, radius: feature.radiusM ?? 0 });
    } else if (feature.shape === "rectangle") {
      if (feature.geometry.length === 0) return null;
      layer = L.rectangle(L.latLngBounds(feature.geometry), options);
    } else {
      if (feature.geometry.length === 0) return null;
      layer = L.polygon(feature.geometry, options);
    }
  }

  const tooltip = tooltipText(feature);
  if (tooltip) layer.bindTooltip(tooltip);
  return layer;
}

export function Lagekarte({ session, onBack }: { session: Session; onBack: () => void }) {
  const mapElementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const featuresMapRef = useRef<YMap<MapFeature> | null>(null);
  const selectedSymbolRef = useRef<PaletteSymbol | null>(null);
  const selectedFeatureIdRef = useRef<string | null>(null);
  const activeDrawRef = useRef<ActiveDraw | null>(null);
  const writableRef = useRef(false);
  const renderForRightsRef = useRef<(() => void) | null>(null);
  const [connected, setConnected] = useState(false);
  const [symbols, setSymbols] = useState<PaletteSymbol[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<PaletteSymbol | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<MapFeature | null>(null);
  const [activeDraw, setActiveDraw] = useState<ActiveDraw | null>(null);
  const [drawColor, setDrawColor] = useState("#d5372b");
  const [drawOpacity, setDrawOpacity] = useState(0.3);
  const [areaColor, setAreaColor] = useState("#d5372b");
  const [areaOpacity, setAreaOpacity] = useState(0.3);
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const writable = canWrite(session.roles, "lagekarte", {
    allowMonitorChat: session.room.settings.allowMonitorChat,
  });

  useEffect(() => {
    selectedSymbolRef.current = selectedSymbol;
  }, [selectedSymbol]);

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

  useEffect(() => {
    const mapElement = mapElementRef.current;
    if (!mapElement) return;

    setConnected(false);
    const map = L.map(mapElement).setView([51.16, 10.45], 6);
    mapRef.current = map;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap-Mitwirkende",
    }).addTo(map);
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
      const layer = createLayer(feature, symbolFiles, writableRef.current);
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
    renderForRightsRef.current = renderAll;

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
        scale: 1,
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

    const onStatus = (event: { status: string }) => setConnected(event.status === "connected");
    conn.provider.on("status", onStatus);

    return () => {
      abortController.abort();
      map.off("click", onMapClick);
      map.off("pm:create", onCreate);
      featuresMap.unobserve(refresh);
      conn.provider.off("status", onStatus);
      if (featuresMapRef.current === featuresMap) featuresMapRef.current = null;
      if (mapRef.current === map) mapRef.current = null;
      if (renderForRightsRef.current === renderAll) renderForRightsRef.current = null;
      conn.destroy();
      map.remove();
      layers.clear();
    };
  }, [session.room.id, session.sid, session.token, session.name]);

  return (
    <div className="app">
      <header className="topbar">
        <button className="btn btn--ghost" type="button" onClick={onBack}>
          ← Übersicht
        </button>
        <div className="room">
          <b>{session.room.name}</b>
        </div>
        <span className="chip chip--code">⬡ {session.room.joinCode}</span>
        <div className="spacer" />
        <span className="live">
          <span className={`dot ${connected ? "dot--ok" : "dot--off"}`} />
          {connected ? "Live synchronisiert" : "Verbinde…"}
        </span>
        <span className="chip">{writable ? "Bearbeiten" : "Nur Lesen"}</span>
      </header>
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
