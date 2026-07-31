# LageKatSe

Modulare, browserbasierte Multi-User-Lageverwaltung für den Katastrophenschutz.
Fach- und Architekturkonzept: **[architecture.md](./architecture.md)**.

> **Status: M2 — Gemeinsames Einsatztagebuch.** Auf dem M0-Fundament (Stabsräume
> anlegen/beitreten, Rollen & Rechte, Live-Präsenz & Chat, autoritative
> Echtzeit-Sync-Engine mit Persistenz) laufen jetzt zwei Fachmodule: die
> kollaborative **Lagekarte** (M1 — Leaflet + OSM, taktische Zeichen DV 102,
> Flächen, Tooltips, JSON-Im-/Export) und das **Einsatztagebuch** (M2 — Tabelle mit
> server-vergebener, lückenloser Lfd-Nr. und Serverzeit, Live-Feld-Edits, Storno,
> CSV-Export). Das taktische Arbeitsblatt folgt in M3.

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
  web/      @lagekatse/web    — React/Vite SPA (Lobby, Übersicht, Chat, Präsenz, Lagekarte, Einsatztagebuch)
```

## Wie M0 funktioniert

- **Ein Yjs-Dokument pro Raum × Modul.** Die Dokumentgrenze ist die Rechtegrenze.
  Real existieren die Dokumente `chat` (M0), `lagekarte` (M1) und `etb` (M2); die
  Sync-Engine ist modul-agnostisch und trägt das letzte Modul (M3) ohne Änderung.
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

## Wie M1 funktioniert (Lagekarte)

Das erste Fachmodul (`packages/web/src/lagekarte/`): eine gemeinsame, live-synchrone
Lagekarte, in die der Stab die Lage grafisch führt.

- **Karte & Bedienung.** Leaflet mit OpenStreetMap-Kacheln. Taktische Zeichen
  (DV 102) werden aus einer durchsuchbaren Palette per Klick platziert, per Drag
  verschoben, beschriftet (Bezeichnung + Beschreibung) und gelöscht. Flächen
  (Polygon/Rechteck/Kreis) werden mit Leaflet-Geoman gezeichnet und tragen Farbe
  und Deckkraft. Bezeichnung + Beschreibung erscheinen als Tooltip.
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
- **CSV-Export.** Excel-tauglich (`;`-getrennt, UTF-8-BOM), inkl. vollem Zeitstempel
  und Storno-Kennzeichnung.

Der ETB-Pfad (autoritatives Anlegen, RO-Sperre, Hot-Join) ist Teil des Sync-Smoke-Tests:
`node packages/web/scripts/e2e.mjs`.

## Nächste Schritte

- ~~**M1** Gemeinsame Lagekarte~~ ✅ umgesetzt (PR #2)
- ~~**M2** Einsatztagebuch (Tabelle, Auto-Lfd-Nr./Zeit, Storno, CSV-Export)~~ ✅ umgesetzt (PR #31)
- **M3** Taktisches Arbeitsblatt (Felder A–F, eingebettetes Live-Lagebild) ⟵ als Nächstes

Offene Punkte mit ⚠️ in [architecture.md §17](./architecture.md).
