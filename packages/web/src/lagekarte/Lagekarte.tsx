import { useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import type { YMapEvent } from "yjs";
import { canWrite, LAGEKARTE_FEATURES, type MapFeature } from "@lagekatse/shared";
import type { Session } from "../session";
import { connectModule } from "../sync/provider";
import "leaflet/dist/leaflet.css";

interface SymbolIndex {
  symbols: { id: string; file: string }[];
}

function tooltipText(feature: MapFeature): string | undefined {
  return feature.description || feature.label;
}

function createLayer(feature: MapFeature, symbolFiles: Map<string, string>): L.Layer | null {
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
    layer = L.marker(feature.position, { icon });
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
  const [connected, setConnected] = useState(false);
  const writable = canWrite(session.roles, "lagekarte", {
    allowMonitorChat: session.room.settings.allowMonitorChat,
  });

  useEffect(() => {
    const mapElement = mapElementRef.current;
    if (!mapElement) return;

    setConnected(false);
    const map = L.map(mapElement).setView([51.16, 10.45], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap-Mitwirkende",
    }).addTo(map);

    const layers = new Map<string, L.Layer>();
    const symbolFiles = new Map<string, string>();
    let features = new Map<string, MapFeature>();

    const renderFeature = (id: string) => {
      const previous = layers.get(id);
      if (previous) {
        previous.remove();
        layers.delete(id);
      }

      const feature = features.get(id);
      if (!feature) return;
      const layer = createLayer(feature, symbolFiles);
      if (!layer) return;
      layer.addTo(map);
      layers.set(id, layer);
    };

    const renderAll = () => {
      const ids = new Set([...layers.keys(), ...features.keys()]);
      for (const id of ids) renderFeature(id);
    };

    const abortController = new AbortController();
    void fetch("/taktische-zeichen/index.json", { signal: abortController.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Symbolindex konnte nicht geladen werden: ${response.status}`);
        return response.json() as Promise<SymbolIndex>;
      })
      .then((index) => {
        for (const symbol of index.symbols) symbolFiles.set(symbol.id, symbol.file);
        renderAll();
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.error(error);
        }
      });

    const conn = connectModule(session.room.id, "lagekarte", session.token);
    const featuresMap = conn.doc.getMap<MapFeature>(LAGEKARTE_FEATURES);
    const refresh = (event: YMapEvent<MapFeature>) => {
      features = new Map(featuresMap.entries());
      for (const id of event.keysChanged) renderFeature(id);
    };
    featuresMap.observe(refresh);
    features = new Map(featuresMap.entries());
    renderAll();

    const onStatus = (event: { status: string }) => setConnected(event.status === "connected");
    conn.provider.on("status", onStatus);

    return () => {
      abortController.abort();
      featuresMap.unobserve(refresh);
      conn.provider.off("status", onStatus);
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
      <div className="lagekarte-map" ref={mapElementRef} />
    </div>
  );
}
