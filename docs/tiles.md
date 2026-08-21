# Eigener Tile-Server (optional, #96 Phase 2)

Für **offline- bzw. geschlossene Netze** kann LageKatSe die Grundkarte aus einem
**selbst gehosteten Tile-Server** beziehen, statt von OpenStreetMap-Public. Damit
funktioniert die Karte auch ohne Internet, unabhängig von einem Drittanbieter und
ohne dass Kachel-Anfragen die eigene Umgebung verlassen.

> **Brauche ich das?** Für den Internet-Betrieb **nein** — der Default (OSM-Public)
> bzw. eine per `tileUrl` konfigurierte URL auf einen vorhandenen/kommerziellen
> Tile-Dienst reicht. Dieser Abschnitt ist nur für **echt offline** / geschlossene
> Netze relevant. Der Tile-Server ist **opt-in** und Default bleibt OSM-Public.

Es kommt der bewährte Standard-Container **[`overv/openstreetmap-tile-server`](https://github.com/Overv/openstreetmap-tile-server)**
zum Einsatz — er liefert **exakt die PNG-Raster-Kacheln**, die die Karte ohnehin
erwartet (`/tile/{z}/{x}/{y}.png`). Es sind **keine Änderungen an der App** nötig,
nur an der Konfiguration.

## Ressourcen (grobe Richtwerte, stark hardwareabhängig)

| Datenumfang | PBF-Download | DB-Speicher | Import-Dauer |
|-------------|-------------:|------------:|-------------:|
| Ein Bundesland (z. B. Niedersachsen) | ~0,5–1 GB | ~10–20 GB | ~1–3 h |
| Ganz Deutschland | ~4 GB | ~50–100 GB | mehrere Stunden bis ~1 Tag |

Empfehlung: den **kleinstmöglichen Regionalauszug** wählen, der das Einsatzgebiet
abdeckt. RAM/CPU wirken sich stark auf die Import- und Renderzeit aus.

## Schritt 1 — Regionalauszug herunterladen

Auszüge gibt es bei **[Geofabrik](https://download.geofabrik.de/europe/germany.html)**
als `.osm.pbf`, z. B.:

```bash
# Beispiel: Niedersachsen
curl -O https://download.geofabrik.de/europe/germany/niedersachsen-latest.osm.pbf
mv niedersachsen-latest.osm.pbf region.osm.pbf
```

## Schritt 2 — Daten importieren (einmalig)

Der Import füllt die PostGIS-Datenbank im Volume `osm_tiles_db`. **Einmalig** und
je nach Region **stundenlang** — währenddessen ist der Server noch nicht nutzbar.

```bash
docker compose --profile tiles run --rm \
  -v "$(pwd)/region.osm.pbf:/data/region.osm.pbf" \
  tiles import
```

## Schritt 3 — Tile-Server starten

```bash
docker compose --profile tiles up -d
```

Danach liefert der Dienst Kacheln unter `http://<host>:8081/tile/{z}/{x}/{y}.png`.
**Hinweis:** Kacheln werden **on-demand** gerendert — der erste Blick auf ein
Gebiet ist langsam, danach sind sie gecacht (Volume `osm_tiles_tiles`).

## Schritt 4 — Die App auf den Tile-Server zeigen

Zwei Wege — je nach Betrieb:

### Variante 1 — Same-Origin über Caddy (empfohlen, auch HTTPS-tauglich)

1. Im `Caddyfile` den optionalen `/tile/*`-Block **einkommentieren**:
   ```caddy
   handle /tile/* {
       reverse_proxy tiles:80
   }
   ```
2. Proxy neu laden: `docker compose restart proxy`
3. In `config.js` (siehe `config.js.example`):
   ```js
   window.__LAGEKATSE_CONFIG__ = { tileUrl: "/tile/{z}/{x}/{y}.png" };
   ```
   Same-Origin → kein Extra-Port, keine Mixed-Content-Probleme unter HTTPS.

### Variante 2 — Direkter Port (am einfachsten im HTTP-LAN)

In `config.js` direkt auf den Port zeigen:
```js
window.__LAGEKATSE_CONFIG__ = { tileUrl: "http://<host>:8081/tile/{z}/{x}/{y}.png" };
```
> ⚠️ Läuft die App über **HTTPS**, blockiert der Browser HTTP-Kacheln
> (Mixed Content) — dann Variante 1 nutzen. Für den HTTP-LAN-Übungsbetrieb ist
> Variante 2 der schnellste Weg.

`config.js` als Volume einhängen (siehe `docker-compose.yml`, `web`-Service):
```yaml
    volumes:
      - ./config.js:/srv/config.js:ro
```
Danach `docker compose up -d` — kein Neu-Build nötig.

## Attribution (Pflicht beibehalten)

Die Kacheln basieren auf **OpenStreetMap-Daten (ODbL)** — die Attribution muss
erhalten bleiben. Der App-Default trägt sie bereits; setzt man `tileAttribution`
in `config.js`, dort weiterhin „© OpenStreetMap-Mitwirkende" führen.

## Updates

Für aktuellere Kartendaten den Import mit einem neuen `region.osm.pbf` wiederholen
(Schritt 1–2). Inkrementelle Diff-Updates unterstützt der Container ebenfalls —
Details in der [Doku des Images](https://github.com/Overv/openstreetmap-tile-server#automatic-updating-optional).

## Vektor-Kacheln als spätere Option

Vektor-Kacheln (Planetiler → `.pmtiles`) wären kleiner und schneller aktualisierbar
und ließen sich sogar als **statische Datei** vom vorhandenen Caddy ausliefern —
erfordern aber einen Vektor-Renderer + Style im Client (z. B. `protomaps-leaflet`).
Das ist eine bewusste **spätere Optimierung**, falls der Raster-Ansatz an
Speicher/Update-Aufwand stößt; für den Standardfall genügt Raster.
