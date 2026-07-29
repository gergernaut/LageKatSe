# LageKatSe

Modulare, browserbasierte Multi-User-Lageverwaltung für den Katastrophenschutz.
Fach- und Architekturkonzept: **[architecture.md](./architecture.md)**.

> **Status: M0 — Fundament.** Stabsräume anlegen/beitreten, Rollen & Rechte,
> Live-Präsenz und Chat, generische Echtzeit-Sync-Engine mit autoritativer
> Rechte-Durchsetzung und Persistenz. Die Fachmodule (Lagekarte, Einsatztagebuch,
> Arbeitsblatt) folgen in M1–M3.

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
  web/      @lagekatse/web    — React/Vite SPA (Lobby, Übersicht, Chat, Präsenz)
```

## Wie M0 funktioniert

- **Ein Yjs-Dokument pro Raum × Modul.** Die Dokumentgrenze ist die Rechtegrenze.
  In M0 existiert real das `chat`-Dokument; die Sync-Engine ist aber schon
  modul-agnostisch und trägt M1–M3 ohne Änderung.
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

## Nächste Schritte

- **M1** Gemeinsame Lagekarte (Leaflet + OSM, taktische Zeichen DV 102, Flächen)
- **M2** Einsatztagebuch (Tabelle, Auto-Lfd-Nr./Zeit, CSV)
- **M3** Taktisches Arbeitsblatt (Felder A–F, eingebettetes Live-Lagebild)

Offene Punkte mit ⚠️ in [architecture.md §17](./architecture.md).
