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
  `effectiveWriteScopes`, `WRITE_SCOPES`), Module (`modules.ts`), Protokoll, Datenmodelle
  (`lagekarte.ts`). Von Client **und** Server genutzt — die gemeinsame Quelle der Wahrheit.
- `packages/server` — `@lagekatse/server`: Fastify HTTP-API + WebSocket-Sync-Gateway.
  `index.ts` (Bootstrap + Shutdown), `http.ts` (REST: Räume, Join, autoritatives ETB-Anlegen),
  `sync/gateway.ts` (Auth + WS-Upgrade), `sync/room-hub.ts` (Yjs-Docs, Persistenz, Fan-out),
  `store/` (`memory` | `postgres`).
- `packages/web` — `@lagekatse/web`: React/Vite-SPA. `lobby/`, `uebersicht/`, `lagekarte/`,
  `etb/`, `sync/provider.ts` (`connectModule`).
- **Aktivitäts-Dots (#32):** server-authored, nicht-persistierter **`activity`**-Kanal
  (`shared/src/activity.ts`) signalisiert Modul-Änderungen; `RoomHub.bumpActivity` (gedrosselt)
  zählt hoch, das Gateway führt ihn **read-only**, `useRoomActivity` zeigt Dots am Rail. Der
  „gesehen"-Stand ist client-lokal (localStorage, s. Invariante #4). **Phase 2:** **Tab-Titel-Indikator**
  (`useActivityTitle`, **immer an**) — Zähler ungesehener Aktivität im Browser-Tab, **http-tauglich**;
  **plus** opt-in Desktop-Notifications (`useActivityNotifications`, Glocken-Toggle, nur im **secure
  context** + `document.hidden`) mit vollem Chat-Text bzw. ETB-`summaries`.

## Bauen & Prüfen
- **`pnpm typecheck`** (tsc über alle Pakete) und **`pnpm build`** (Web-Prod-Build) müssen
  grün sein. Es gibt **kein Test-Framework**.
- Smoke-Tests sind handgeschriebene `.mjs` unter `packages/web/scripts/` (`e2e.mjs`,
  `lagekarte-e2e.mjs`), mit `node` **gegen einen laufenden Server** ausgeführt. Server-Default
  = **Memory-Store** (`pnpm dev:server`); Postgres via `pnpm db:up` + `DATABASE_URL`.
- Konfiguration: `.env` **im Repo-Root** (Backend via dotenv, Vite via envDir), **einmal beim
  Start** gelesen — nach Änderung Dev neu starten.

## Code-Stil
- TypeScript strict; React 18 + Leaflet + Yjs (Web), Fastify + `ws` + Yjs (Server).
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
   (**Feld-Level-Merge**, nicht Whole-Value-LWW wie die Karte).

## Workflow
- Feature-Code entsteht i. d. R. via Codex, in kleinen Schritten (je Schritt ein Commit).
- **PRs merged Kevin selbst.** Vor dem Öffnen `pnpm typecheck` + `pnpm build` grün.
- Neue Fläche/Feld/Migration? Zuerst prüfen, ob eine der Invarianten oben betroffen ist.
