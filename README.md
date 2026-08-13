# LageKatSe

Modulare, browserbasierte Multi-User-Lageverwaltung für den Katastrophenschutz.
Fach- und Architekturkonzept: **[architecture.md](./architecture.md)**.

> **Status: M0–M3 ✅ komplett, M4 (Härtung & Ausbau) angelaufen.** Auf dem
> M0-Fundament (Stabsräume anlegen/beitreten, Rollen & Rechte, Live-Präsenz & Chat,
> autoritative Echtzeit-Sync-Engine mit Persistenz) laufen alle drei Fachmodule:
> die kollaborative **Lagekarte** (M1 — Leaflet + OSM, taktische Zeichen DV 102 in
> nach Typ gruppierter Palette, Flächen, Tooltips, JSON-Im-/Export, schaltbares
> **DWD-Regenradar** und **KONRAD3D**-Gewitterzellen-Overlay mit Zell-Info per
> Klick, **Pegelstände** der Bundeswasserstraßen (PEGELONLINE/WSV) als schaltbarer
> Layer, raumweise gemerkte Kartenansicht), das **Einsatztagebuch** (M2 — Tabelle
> mit server-vergebener, lückenloser Lfd-Nr. und Serverzeit, Live-Feld-Edits,
> Storno, **JSON- und PDF-Export**) und das **Taktische Arbeitsblatt** (M3 —
> IdF-Vorderseite Felder A–F live-synchron, Gefahren-Randfelder, Feld B als
> eingebettete read-only Lagekarte, **Wetter-Rückseite** via DWD/BrightSky,
> **JSON-Export/-Import und PDF-Export**). Auf der Übersicht gibt es einen
> **Gesamt-Export** (ZIP aller Module) und einen **Bundle-Import** (ZIP wieder
> einspielen, nur S-Rollen). Modulübergreifend zeigt der Rail einen
> kleinen **Aktivitäts-Punkt**, wenn sich in einem gerade nicht geöffneten Modul
> etwas tut — und immer auch als **Zähler im Browser-Tab-Titel**. Wo HTTPS/localhost
> vorhanden ist, gibt es zusätzlich optionale **Desktop-Benachrichtigungen** (pro
> Nutzer per Glocke aktivierbar). Eine S-Funktion kann die **Lage abschließen**
> (Abschluss-Eintrag + Gesamt-Export, dann Raum schließen & löschen). **M4** ist
> weitgehend ausgeliefert (PDF-Export, Rate-Limiting, Auto-Retention, Reverse-Proxy/TLS,
> Bundle-Im-/Export, Offline-Cache).

## Schnellstart

Voraussetzung: **Node ≥ 20** und **pnpm** (`npm i -g pnpm` oder via corepack).

```bash
pnpm install
pnpm dev
```

- Backend läuft auf **http://localhost:8080**
- Web-App auf **http://localhost:5173** → im Browser öffnen

Ohne weitere Konfiguration nutzt der Server einen **In-Memory-Store** (keine
Persistenz über Neustarts — ideal zum Ausprobieren). Zum Testen einfach in zwei
Browserfenstern denselben Lobby-Code beitreten und den Chat/die Online-Liste live
beobachten.

## Persistenz (optional, mit Docker)

Für dauerhafte Stabsräume (überleben Server-Neustarts) eine PostgreSQL-DB starten
und dem Server per `DATABASE_URL` bekannt machen:

```bash
pnpm db:up   # startet Postgres via docker-compose (Schema wird automatisch angelegt)
DATABASE_URL=postgres://lagekatse:lagekatse@localhost:5432/lagekatse pnpm dev:server
# in einem zweiten Terminal:
pnpm dev:web
```

### Konfiguration (`.env`)

Einstellungen kommen aus einer `.env` **im Repo-Root** (`cp .env.example .env`).
Das Backend lädt sie via dotenv, Vite liest die `VITE_*`-Variablen aus derselben
Datei. Werte werden **einmal beim Start** gelesen — nach Änderungen `pnpm dev`
neu starten (und für einen Web-Prod-Build `pnpm build` erneut ausführen). Ohne
`.env` laufen sinnvolle Defaults (Port 8080, Memory-Store, CORS auf `localhost:5173`).

Beim Testen **auf einem Server** müssen zwei Werte auf die *vom Browser
erreichbare* Adresse zeigen (nicht `localhost`): `VITE_API_URL` (Backend-URL) und
`CORS_ORIGIN` (Origin, unter dem die Web-App geöffnet wird). Der Vite-Dev-Server
bindet dank `host: true` auf alle Interfaces.

## Deployment (Reverse-Proxy + TLS, Docker Compose)

Für den Produktiv-/Pilotbetrieb liegt eine `docker-compose.yml` mit vier Services
bereit: **Caddy** (Reverse-Proxy, TLS), **Web** (statische SPA), **Backend**
(Node), **PostgreSQL**. Caddy terminiert TLS (Let's-Encrypt für öffentliche
Domains, `tls internal` für geschlossene Netze) und routet `/api` + `/ws` ans
Backend, `/` ans statische Frontend.

### Einrichtung

```bash
cp .env.example .env
# In .env mindestens setzen:
#   DOMAIN=lagekatse.example.org      # öffentliche Domain (für Let's-Encrypt)
#   CADDY_EMAIL=admin@example.org     # Let's-Encrypt-Benachrichtigungen
#   JWT_SECRET=<starkes, zufälliges Passwort>
#   POSTGRES_PASSWORD=<sicheres Passwort>

docker compose up -d
```

Caddy holt automatisch ein Let's-Encrypt-Zertifikat für `DOMAIN`. Die App ist
dann unter `https://<DOMAIN>` erreichbar — inkl. Secure Context (Desktop-
Benachrichtigungen greifen automatisch).

### Dual-Mode (HTTPS-Internet + HTTP-LAN)

- **HTTPS-Internet** (Pilot): `DOMAIN=lagekatse.example.org` → Caddy holt
  automatisch ein Let's-Encrypt-Zertifikat. Secure Context greift → Desktop-
  Benachrichtigungen funktionieren.
- **Geschlossenes Netz** (kein öffentliches DNS): gleiche Einrichtung, aber im
  `Caddyfile` `tls internal` aktivieren (selbstsigniertes Zertifikat) oder die
  `tls`-Direktive auskommentieren für plain HTTP (`DOMAIN=:80`). Letzteres ist
  die einfachste Variante für Übungsbetrieb im LAN — kein Secure Context, aber
  keine Browser-Warnung.

`VITE_API_URL` ist per Default `""` (Same-Origin) — der Bundle ist
deployment-unabhängig. Für Dev oder Split-Deployments auf eine absolute URL setzen.

### Verifikation

```bash
curl -I https://<DOMAIN>/            # Frontend (200, Caddy)
curl https://<DOMAIN>/api/health     # Backend (200, { ok: true })
```

In zwei Browsern dem Raum beitreten, Sync sichtbar (Symbol platzieren, ETB-Eintrag)
→ WSS-Handshake funktioniert. Bei HTTPS: Desktop-Notifications aktivierbar.

Details: [architecture.md §16](./architecture.md#16-deployment).

## Skripte

| Befehl | Wirkung |
|--------|---------|
| `pnpm dev` | Server + Web parallel (Dev-Modus mit Hot-Reload) |
| `pnpm dev:server` / `pnpm dev:web` | nur Backend / nur Frontend |
| `pnpm typecheck` | TypeScript-Prüfung über alle Pakete |
| `pnpm build` | Produktions-Build aller Pakete |
| `pnpm db:up` / `pnpm db:down` | PostgreSQL via Docker starten/stoppen |

## Monorepo-Aufbau

```
packages/
  shared/   @lagekatse/shared — Rollen, Rechte-Logik, Protokoll-/Datentypen (Client+Server)
  server/   @lagekatse/server — Fastify HTTP-API + WebSocket-Sync-Gateway (Yjs) + Persistenz
  web/      @lagekatse/web    — React/Vite SPA (Lobby, Übersicht, Chat, Präsenz, Lagekarte, Einsatztagebuch, Arbeitsblatt)
```

## Wie M0 funktioniert

- **Ein Yjs-Dokument pro Raum × Modul.** Die Dokumentgrenze ist die Rechtegrenze.
  Real existieren die Dokumente `chat` (M0), `lagekarte` (M1), `etb` (M2) und
  `arbeitsblatt` (M3); die Sync-Engine ist modul-agnostisch.
- **Autoritativer Server, kein P2P.** Jede WebSocket-Verbindung wird pro Dokument
  als *read-write* oder *read-only* gebunden (`packages/server/src/sync/gateway.ts`).
  Schreibversuche einer RO-Verbindung werden verworfen und der Client resynchronisiert
  (`room-hub.ts`). Die Rechte-Logik selbst liegt in `packages/shared/src/roles.ts`
  (`effectiveWriteScopes` / `canWrite`) — additive Vereinigung bei Mehrfachrollen.
- **Hot-Join & Persistenz.** Beim Beitritt bekommt der Client per Yjs-Sync sofort
  den vollständigen Stand. Änderungen werden als Update-Log + periodischer Snapshot
  persistiert; beim Laden eines Raums wird daraus rekonstruiert.
- **Zugang.** Lobby-Code + optionales Raum-Passwort, selbst deklarierter Name,
  Session-Token (JWT). Rollen werden serverseitig signiert; Rechte serverseitig
  durchgesetzt.
- **Rate-Limiting.** Grundschutz gegen Brute-Force/Enumeration: ein globales Limit
  pro Client-IP und ein strengeres für Lobby-Join & Raum-Anlegen (konfigurierbar,
  s. `.env.example`; hinter einem Reverse-Proxy `TRUST_PROXY=true` für die echte IP).

## Wie M1 funktioniert (Lagekarte)

Das erste Fachmodul (`packages/web/src/lagekarte/`): eine gemeinsame, live-synchrone
Lagekarte, in die der Stab die Lage grafisch führt.

- **Karte & Bedienung.** Leaflet mit OpenStreetMap-Kacheln. Taktische Zeichen
  (DV 102) werden aus einer durchsuchbaren, **nach Typ gruppierten Palette**
  (Untermenüs je Organisation, statt einer flachen Liste) per Klick platziert, per
  Drag verschoben, **ausgerichtet** (Rotation je Symbol per Slider/Winkel-Eingabe),
  beschriftet (Bezeichnung + Beschreibung) und gelöscht. Flächen
  (Polygon/Rechteck/Kreis) werden mit Leaflet-Geoman gezeichnet und tragen Farbe
  und Deckkraft. Bezeichnung + Beschreibung erscheinen als Tooltip.
- **DWD-Wetterlayer (optional).** Zwei schaltbare Overlays direkt vom Deutschen
  Wetterdienst (WMS, `maps.dwd.de`): das **Regenradar** und **KONRAD3D**
  (Gewitterzellen nach Schweregrad + Zugbahnen); ein Klick auf eine KONRAD3D-Zelle
  zeigt per GetFeatureInfo deren Kennwerte (Hagel, Windböen, VIL, Echo-Top …) als
  Popup. Die Ein/Aus-Schalter sind **betrachter-lokal** (localStorage) — greifen
  also auch für den Nur-Lese-Monitor.
- **Pegelstände (optional).** Schaltbarer Layer der Bundeswasserstraßen-Pegel
  (PEGELONLINE/WSV): gefärbte Punkte je Wasserstand-Status (Hochwasser/normal/
  Niedrigwasser), Klick zeigt Messwert + Zeitpunkt; mit ETB-Schreibrecht lässt sich
  ein Pegel per Klick ins Einsatztagebuch übernehmen. Rohdaten (vorläufig), rein
  client-seitig abgerufen.
- **Kartenansicht-Persistenz.** Kartenmitte und Zoomstufe werden **pro Raum**
  betrachter-lokal gemerkt (localStorage) und überleben Modul-Wechsel und Reload.
- **Zeichensatz.** 894 gemeinfreie SVGs (CC0) aus
  [jonas-koeritz/Taktische-Zeichen](https://github.com/jonas-koeritz/Taktische-Zeichen)
  liegen unter `packages/web/public/taktische-zeichen/`. Der durchsuchbare Index
  (`index.json`) wird daraus generiert:
  `node packages/web/scripts/build-symbol-index.mjs`. Im CRDT steht nur die
  `symbolId`, nicht die SVG-Daten.
- **Sync & Rechte.** Alle Änderungen laufen über **ein** `lagekarte`-Yjs-Dokument
  (`Y.Map` `features`); die Karte rendert ausschließlich aus dem beobachteten
  CRDT-Zustand (lokal wie remote). Schreiben darf nur, wer den Scope `lagekarte`
  hat (Lagekartenführer/S-Rollen) — der Server setzt das autoritativ durch, die UI
  blendet die Werkzeuge für Nur-Lese-Rollen aus.
- **Persistenz & Import/Export.** Der Kartenstand überlebt Reload (F5, Session via
  `sessionStorage`) und Server-Neustart (Snapshot + Update-Log). Zusätzlich lässt
  sich die Lage als JSON sichern/importieren (`format: "lagekatse.lagekarte"`, v1).
- **Ladeverhalten.** Die Karte samt Leaflet/Geoman wird per `React.lazy` erst bei
  Bedarf geladen (kleineres Initial-Bundle).

Sync und Rechte-Durchsetzung der Karte deckt ein Smoke-Test ab:
`node packages/web/scripts/lagekarte-e2e.mjs`.

## Wie M2 funktioniert (Einsatztagebuch)

Das zweite Fachmodul (`packages/web/src/etb/`): ein fortlaufendes, tabellarisches
Einsatztagebuch (ETB), in das der Stab ein- und ausgehende Meldungen führt.

- **Server-autoritatives Anlegen.** Lfd-Nr. (monoton, **lückenlos**) und Zeit
  (Serveruhr) dürfen nicht vom Client kommen — ein neuer Eintrag wird über
  `POST /api/rooms/:code/etb/entries` angelegt; der Server prüft Token + Scope,
  vergibt Nummer und Zeit und pusht den Eintrag ins `etb`-Yjs-Dokument, das per
  Sync bei allen ankommt.
- **Feld-genaues Editieren.** Jeder Eintrag ist ein `Y.Map` in der `Y.Array`
  `entries`; Zellen (Von/An/Weg/Inhalt/…) werden feldweise gesetzt — zwei Personen
  an verschiedenen Spalten derselben Zeile kollidieren nicht.
- **Storno statt Löschen.** Ein Eintrag wird als storniert markiert (bleibt sichtbar,
  durchgestrichen), damit die Lfd-Nr.-Kette lückenlos bleibt.
- **Rechte.** Schreiben darf, wer den Scope `etb` hat (Einsatztagebuchführer/S-Rollen);
  Nur-Lese-Rollen sehen die Tabelle ohne Editier-Steuerelemente (serverseitig erzwungen).
- **JSON-Im-/Export und PDF-Export** (wie beim Arbeitsblatt). Das **JSON** ist verlustfrei
  (inkl. `lfdNr`/`zeit`/`storniert`); der **JSON-Import** ersetzt das ETB **server-autoritativ**
  (`/etb/import`, nur S-Rollen, Invariante #6) — dieselbe Form spielt auch der Bundle-Import ein.
  Das **PDF** (A4 quer) wird
  client-seitig mit pdf-lib erzeugt (eingebettete Schrift für Umlaute/Sonderzeichen,
  Wort-Umbruch, Paginierung) — für Ablage und Übergabe. (Der frühere CSV-Export
  entfiel mit #71 zugunsten von JSON + PDF, wie beim Arbeitsblatt.)

Der ETB-Pfad (autoritatives Anlegen, RO-Sperre, Hot-Join) ist Teil des Sync-Smoke-Tests:
`node packages/web/scripts/e2e.mjs`.

## Wie M3 funktioniert (Taktisches Arbeitsblatt)

Das dritte Fachmodul (`packages/web/src/arbeitsblatt/`): das digitale IdF-Arbeitsblatt,
ein strukturiertes, live-synchrones Formular pro Stabsraum.

- **Felder A–F, feldweise synchron.** Kopfzeile, Führungsvorgang, Rückmeldungen,
  eigene Lage/Nachforderung und Organisation/Organigramm liegen als top-level
  Yjs-Typen im `arbeitsblatt`-Dokument; Edits mergen feld-/zeilenweise. Es gibt
  **keine server-autoritativen Felder** — anders als das ETB braucht das Modul
  keinen eigenen Endpoint.
- **Feld B — Lagebild.** Die Lagekarte ist read-only eingebettet (eine Quelle der
  Wahrheit); daneben werden die **neun Gefahren der Einsatzstelle** (4 A · 1 C · 4 E)
  als geteilte Randfelder beurteilt. Direktes Editieren der Karte aus dem Arbeitsblatt
  ist bewusst nicht vorgesehen (das Kartenfeld ist zu klein).
- **Wetter-Rückseite.** Für die Kartenmitte des Lagebilds werden aktuelle Wetterdaten,
  eine 4-Stunden-Vorhersage und DWD-Warnungen über **BrightSky** (DWD OpenData,
  ohne Schlüssel) abgerufen. Der Snapshot ist geteilt (ein Schreibberechtigter ruft
  ab, alle sehen dasselbe); ein Klick trägt die aktuelle Wetterlage ins ETB ein.
- **Export/Import.** Voller Formularzustand als **JSON** (Export **und** Import —
  Import validiert gegen das Schema und spielt als eine CRDT-Transaktion ein) sowie
  **PDF** (A4 hoch, client-seitig via pdf-lib).

Sync und Rechte-Durchsetzung deckt ein Smoke-Test ab:
`node packages/web/scripts/arbeitsblatt-e2e.mjs`.

## Nächste Schritte

- ~~**M1** Gemeinsame Lagekarte~~ ✅ umgesetzt (PR #2)
- ~~**M2** Einsatztagebuch (Tabelle, Auto-Lfd-Nr./Zeit, Storno, JSON/PDF-Export)~~ ✅ umgesetzt (PR #31)
- ~~**M3** Taktisches Arbeitsblatt (Felder A–F, eingebettetes Live-Lagebild, Gefahren-Randfelder, Wetter, JSON-Im-/Export, PDF)~~ ✅ umgesetzt
- **M4 — Härtung & Ausbau** (angelaufen): PDF-Export ✅, DWD-Wetter ✅, Gesamt-Export ✅, Bundle-Import ✅, Rate-Limiting ✅, Test-Framework (Vitest) + CI ✅, Startseiten-Disclaimer ✅, Auto-Retention ✅, Reverse-Proxy/TLS ✅; **offen:** Self-Service „Lage abschließen"

Offene Punkte mit ⚠️ in [architecture.md §17](./architecture.md).
