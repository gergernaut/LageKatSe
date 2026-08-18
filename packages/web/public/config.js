// Laufzeit-Konfiguration der LageKatSe-Web-App (#96, Phase 1).
//
// Diese Datei wird NICHT gebündelt (sie liegt unter public/ und landet
// unverändert im Serving-Root). Sie lässt sich pro Deployment überschreiben
// bzw. per Volume einhängen, OHNE die App neu zu bauen — analog zum
// Dual-Mode-Prinzip aus #65 (ein Image, mehrere Umgebungen: LAN/Internet/offline).
//
// Auflösungs-Priorität für die Grundkarte: hier gesetzte Werte gewinnen,
// danach VITE_TILE_URL (Build-Zeit), zuletzt OSM-Public (Default).
// Siehe packages/web/src/config.ts.
//
// tileUrl: Leaflet-Kachel-Template ({s}/{z}/{x}/{y}). Auskommentiert =
//   OSM-Public. Im geschlossenen Netz / LAN-/Offline-Betrieb (#96) auf den
//   lokalen Tile-Server zeigen lassen, z. B.:
//     "http://tiles.lan/tile/{z}/{x}/{y}.png"
// tileMaxZoom / tileAttribution: optionale Overrides für den Tile-Layer.
//   Hinweis: Nutzt der lokale Server OSM-Daten, MUSS die OSM-Attribution
//   (ODbL) erhalten bleiben — der Default deckt das ab.
window.__LAGEKATSE_CONFIG__ = Object.assign(window.__LAGEKATSE_CONFIG__ || {}, {
  // tileUrl: "http://<tile-server>/tile/{z}/{x}/{y}.png",
  // tileMaxZoom: 19,
  // tileAttribution: "&copy; OpenStreetMap-Mitwirkende",
});
