# AGENTS.md — LageKatSe

Kurzorientierung für Menschen **und** Coding-Agents (Codex/Claude). Das ausführliche
Fach- und Architekturkonzept steht in **[architecture.md](./architecture.md)** (offene
Entscheidungen dort in §17). Diese Datei ist die knappe Bau- und Verhaltensregel.

## Was das ist
Browserbasierte Multi-User-Lageverwaltung für den Katastrophenschutz-Führungsstab: eine
SPA mit **autoritativem** Echtzeit-Sync-Backend (Yjs/CRDT über WebSocket). Stern-Topologie,
**kein P2P** — nur so lassen sich die Rollenrechte serverseitig durchsetzen.

## Monorepo (pnpm workspaces)
- `packages/shared` — `@lagekatse/shared`: Rollen/Rechte (`roles.ts`: `canWrite`,
  `effectiveWriteScopes`, `WRITE_SCOPES`, `hasStabRole`; Rollen S1–S6, **LdS, LAGEKARTE, ETB,
  MONITOR, BR_LEITER**), Module (`modules.ts`), Protokoll, Datenmodelle (`lagekarte.ts`,
  `arbeitsblatt.ts`, `etb.ts`, `kraefteubersicht.ts`, `close.ts`). Von Client **und** Server
  genutzt — die gemeinsame Quelle der Wahrheit.
- `packages/server` — `@lagekatse/server`: Fastify HTTP-API + WebSocket-Sync-Gateway.
  `index.ts` (Bootstrap + Shutdown + Auto-Retention-Sweep), `http.ts` (REST: Räume, Join, autoritatives
  ETB-Anlegen **+ ETB-Bundle-Import + Lage-abschließen `/close` + Kräfte-ETB-Log `/kraft/etb-log`**),
  `sync/gateway.ts` (Auth + WS-Upgrade), `sync/room-hub.ts` (Yjs-Docs, Persistenz, Fan-out;
  `appendEtbEntry`/`replaceEtbEntries`/`closeRoom`), `store/` (`memory` | `postgres`;
  `getStaleRooms`/`deleteRoom`, Room mit `createdBy`, **Backend = Single Source of Truth fuer Schema** #106/#107).
- `packages/web` — `@lagekatse/web`: React/Vite-SPA. `lobby/`, `uebersicht/`, `lagekarte/`
  (Karte + `Palette.tsx` + DWD-Regenradar/KONRAD3D-Overlays + Pegel-Layer), `etb/`,
  `arbeitsblatt/` (`Arbeitsblatt.tsx`, `Wetter.tsx`), `kraefteubersicht/` (`Kraefteubersicht.tsx`
  — Bereitstellungsraum/Im-Einsatz, DV-100-Stärke, #100), `sync/provider.ts` (`connectModule`
  mit `cache`-Opt-out fuer transiente Verbindungen).
  Client-Utilities: `wetter.ts` (BrightSky-Abruf), `pegel.ts` (PEGELONLINE/WSV-Pegelstaende,
  CORS-offen; reine Coercion + Status->Farbe, unit-getestet), `pdf.ts` (`etbToPdf`/`arbeitsblattToPdf`
  via pdf-lib, Schrift `public/fonts/DejaVuSans.ttf`), `exportAll.ts` (Gesamt-Export) +
  `importAll.ts` (Bundle-Import, beide ZIP via fflate), `*/applyImport.ts` (geteilte, React-freie
  Import-Apply-Logik fuer Lagekarte/Arbeitsblatt/Kraefteuebersicht — von Einzeldatei- **und** Bundle-Import genutzt),
  `dug.ts` (Datum-Uhrzeit-Gruppe fuer Dateinamen), `format.ts` (`formatDateTime`, PDF-Export),
  `config.ts` (Laufzeit-Konfig `window.__LAGEKATSE_CONFIG__` -> `VITE_TILE_URL` -> Default, #96 Phase 1).
- **Aktivitäts-Dots (#32):** server-authored, nicht-persistierter **`activity`**-Kanal
  (`shared/src/activity.ts`) signalisiert Modul-Änderungen; `RoomHub.bumpActivity` (gedrosselt)
  zählt hoch, das Gateway führt ihn **read-only**, `useRoomActivity` zeigt Dots am Rail. Der
  „gesehen"-Stand ist client-lokal (localStorage, s. Invariante #4). **Phase 2:** **Tab-Titel-Indikator**
  (`useActivityTitle`, **immer an**) — Zähler ungesehener Aktivität im Browser-Tab, **http-tauglich**;
  **plus** opt-in Desktop-Notifications (`useActivityNotifications`, Glocken-Toggle, nur im **secure
  context** + `document.hidden`) mit vollem Chat-Text bzw. ETB-`summaries`.

## Bauen & Prüfen
- **`pnpm typecheck`** (tsc über alle Pakete) und **`pnpm build`** (Web-Prod-Build) müssen
  grün sein.
- **`pnpm test`** (Vitest, `vitest run`) für **reine Logik** — Rollen/Rechte (`shared/roles.ts`),
  Import-Coercion (`shared/arbeitsblatt.ts`), `format`/`dug`, PDF-Textumbruch. Tests liegen als
  `*.test.ts` **neben** dem Code (Node-Umgebung, kein DOM). Neue reine Helfer bitte mit Test.
- Smoke-Tests sind handgeschriebene `.mjs` unter `packages/web/scripts/` (`e2e.mjs`,
  `lagekarte-e2e.mjs`, `arbeitsblatt-e2e.mjs`, `kraefteubersicht-e2e.mjs`, `bundle-import-e2e.mjs`,
  `close-e2e.mjs`, `ratelimit-e2e.mjs`), mit `node` **gegen einen laufenden Server** ausgefuehrt — sie bleiben **ergänzend** zu den Unit-Tests. Server-Default
  = **Memory-Store** (`pnpm dev:server`); Postgres via `pnpm db:up` + `DATABASE_URL`.
- Konfiguration: `.env` **im Repo-Root** (Backend via dotenv, Vite via envDir), **einmal beim
  Start** gelesen — nach Änderung Dev neu starten.

## Code-Stil
- TypeScript strict; React 19 + Vite + Leaflet + Yjs (Web; PDF via pdf-lib/@pdf-lib/fontkit,
  ZIP via fflate, **Offline-Cache via y-indexeddb** #70), Fastify + `ws` + Yjs (Server).
- **Deutsch** für UI-Text und Domänenbegriffe (Stabsraum, Lagekarte, …), **englische**
  Identifier.
- **Inline-Kommentare erlaubt** und genutzt — knapp, nur wo nicht selbsterklärend; vorhandene
  nicht entfernen. Stil der jeweiligen Umgebung übernehmen.

## Harte Invarianten (nicht brechen)
1. **Feature-Writes laufen über die Modul-`Y.Map`.** Werte setzen (`Y.Map.set` / `delete`),
   dann rendert der `observe`→reconcile-Pfad lokal **wie** remote. **Nie** Leaflet-Layer direkt
   im Handler mutieren — sonst driften lokaler und synchronisierter Zustand auseinander.
2. **Der Server ist die einzige Relay-Instanz.** Der y-websocket-Provider läuft mit
   **`disableBc: true`** — BroadcastChannel würde gleiche-Origin-Clients unter Umgehung der
   serverseitigen Rechtedurchsetzung cross-syncen. Dokumentgrenze = Rechtegrenze; Read-only-Rollen
   werden **serverseitig** erzwungen (Gateway), die UI blendet nur aus.
3. **`uid()` statt `crypto.randomUUID()`** für IDs — die App läuft über http im LAN (kein Secure
   Context, dort fehlt `crypto.randomUUID`).
4. **Client-lokale Anzeige-Optionen** (Symbolgröße, Beschriftung) leben in `localStorage` + einem
   Ref + Re-Render — **nicht** im CRDT. So kann auch der Read-only-Monitor sie nutzen, ohne den
   geteilten Zustand zu ändern (Entscheidung E9, architecture.md §8.3).
5. **Persistenz = Snapshot + Append-Log (WAL).** Jedes Update wird sofort geloggt; Snapshots sind
   nur Kompaktion, keine Durability-Grenze. Sauberer Shutdown trennt WS-Clients und flusht
   (`RoomHub.closeAll`) **vor** `app.close()`.
6. **ETB-Einträge werden server-autoritativ angelegt.** Ein neuer Eintrag läuft über
   `POST /api/rooms/:code/etb/entries` (`RoomHub.appendEtbEntry`): der Server vergibt `lfdNr`
   (monoton, **lückenlos**) und `zeit` (Serveruhr) und pusht ihn ins CRDT — der Client legt
   **keine** Einträge direkt an. Feld-Edits danach sind normale `Y.Map.set` pro Entry-`Y.Map`
   (**Feld-Level-Merge**, nicht Whole-Value-LWW wie die Karte). **Auch der Bundle-Import** ersetzt
   das ETB server-autoritativ über `POST /api/rooms/:code/etb/import` (`RoomHub.replaceEtbEntries`,
   nur S-Rollen) — nie clientseitig; `lfdNr`/`zeit`/`storniert` bleiben dabei originalgetreu erhalten.

## Workflow
- Feature-Code entsteht i. d. R. via Codex/Claude Code, in kleinen Schritten (je Schritt ein Commit).
- **PRs merged Kevin selbst.** Vor dem Öffnen `pnpm typecheck` + `pnpm build` grün.
- Neue Fläche/Feld/Migration? Zuerst prüfen, ob eine der Invarianten oben betroffen ist.

## Deployment (#65, #99/#108)
- **Docker Compose** (`docker-compose.yml`): `proxy` (Caddy, TLS), `web` (statische SPA),
  `backend` (Node/tsx), `db` (PostgreSQL). Caddy terminiert TLS (Let's-Encrypt für öffentliche
  Domains, `tls internal`/HTTP für geschlossene Netze) und routet `/api` + `/sync` ans Backend,
  `/` ans Frontend. Dual-Mode: HTTPS-Internet + HTTP-LAN.
- **GHCR-Images** (#99/#108): CI (`docker.yml`) baut + pusht `ghcr.io/gergernaut/lagekatse-backend`
  und `…-web` bei Push auf main (`latest` + `sha-<kurz>`, semver bei `v*`-Tags). `docker compose pull`
  statt Repo klonen; `LAGEKATSE_IMAGE_TAG` pinbar. Build aus Quellcode: `docker-compose.build.yml`.
- **Laufzeit-Config** (#96 Phase 1): `public/config.js` (`window.__LAGEKATSE_CONFIG__`) pro
  Deployment überschreibbar (z. B. Tile-URL), ohne Neu-Build. Vorlage: `config.js.example`.
- **Schema** (#106/#107): Backend wendet das Schema autoritativ bei jedem Start an
  (`PostgresStore.init`, idempotent) — kein `schema.sql`-Mount mehr.
