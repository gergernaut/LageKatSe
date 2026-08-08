# LageKatSe – Architektur- und Fachkonzept

> Modulare, browserbasierte Multi-User-Lageverwaltung für den Katastrophenschutz.
> Version 0.4 · Stand: 2026-08-07 · Konzept + Umsetzungsstand: **M0–M3 komplett inkl. Phase-2-Ausbau, M4 (Härtung & Ausbau) angelaufen — PDF-Export ausgeliefert**

Dieses Dokument überführt das Brainstorming (`LageKatSe.txt`) in ein tragfähiges technisches Konzept.
Es beschreibt Zielbild, Architektur, Datenmodell, Rechtemodell und einen Umsetzungsfahrplan.
Fachliche Annahmen, die noch mit der Zielgruppe (Feuerwehr/THW/Hilfsorganisation) validiert werden
sollten, sind mit **⚠️ zu klären** markiert.

---

## Inhalt

1. [Zielbild & Leitplanken](#1-zielbild--leitplanken)
2. [Fachglossar](#2-fachglossar)
3. [Architekturüberblick](#3-architekturüberblick)
4. [Technologie-Stack (Entscheidungen)](#4-technologie-stack-entscheidungen)
5. [Echtzeit-Synchronisation & Hot-Join](#5-echtzeit-synchronisation--hot-join)
6. [Rollen- & Rechtemodell](#6-rollen--rechtemodell)
7. [Datenmodell](#7-datenmodell)
8. [Modul 1 – Gemeinsame Lagekarte](#8-modul-1--gemeinsame-lagekarte)
9. [Modul 2 – Gemeinsames Einsatztagebuch](#9-modul-2--gemeinsames-einsatztagebuch)
10. [Modul 3 – Taktisches Arbeitsblatt](#10-modul-3--taktisches-arbeitsblatt)
11. [Präsenz & Chat](#11-präsenz--chat)
12. [Import & Export](#12-import--export)
13. [Persistenz, Recovery & Skalierung](#13-persistenz-recovery--skalierung)
14. [Sicherheit & Datenschutz](#14-sicherheit--datenschutz)
15. [Nicht-funktionale Anforderungen](#15-nicht-funktionale-anforderungen)
16. [Deployment](#16-deployment)
17. [Offene Entscheidungen](#17-offene-entscheidungen)
18. [Umsetzungs-Roadmap](#18-umsetzungs-roadmap)
19. [Vorgeschlagene Projektstruktur](#19-vorgeschlagene-projektstruktur)

---

## 1. Zielbild & Leitplanken

**LageKatSe** ist eine Web-Anwendung, mit der ein Führungsstab (bzw. eine Einsatzleitung) eine
gemeinsame Lage kollaborativ und in Echtzeit führt – ohne Client-Installation, ausschließlich im
Browser. Mehrere Nutzer arbeiten gleichzeitig in demselben virtuellen **Stabsraum** und sehen
Änderungen der anderen sofort.

### Leitplanken (nicht verhandelbare Eigenschaften)

| # | Leitplanke | Konsequenz für die Architektur |
|---|------------|-------------------------------|
| L1 | **Echtzeit** – alle Änderungen sofort bei allen sichtbar | Server-vermittelte Live-Synchronisation, kein Reload |
| L2 | **Hot-Join jederzeit** – Beitretende sehen sofort den vollständigen Stand | Der komplette Zustand ist jederzeit rekonstruierbar (CRDT + Snapshot) |
| L3 | **Persistenz** – Stabsräume überleben Neustarts, inkl. aller Modul-Zustände | Serverseitige, dauerhafte Speicherung des Zustands |
| L4 | **Rollenbasierte Rechte**, bei Mehrfachrollen additiv zusammengeführt | Autoritative Rechtedurchsetzung serverseitig, feingranular pro Modul |
| L5 | **Modularität** – Unter-Anwendungen sind unabhängig erweiterbar | Modul = eigener Zustands-Namespace + eigene Rechte-Scope |
| L6 | **Einsatztauglichkeit** – funktioniert auch bei schlechter Konnektivität | Offline-Cache im Client, robuster Reconnect/Resync |

> **Kontext:** LageKatSe ist ein Führungs- und Übungswerkzeug. Es ersetzt kein
> zertifiziertes Leitstellen-/ELS-System und trifft keine automatisierten Einsatzentscheidungen.
> Das entlastet uns von harten Echtzeit-/Ausfallsicherheits-Zertifizierungen, verpflichtet uns aber
> zu sauberer Dokumentation (Einsatztagebuch ist ein nachvollziehbares Führungsdokument).

---

## 2. Fachglossar

Damit Code und Konzept dieselbe Sprache sprechen (Domänenbegriffe bleiben deutsch, Code-Identifier
englisch, wo sinnvoll):

| Begriff | Bedeutung | Interner Name (Code) |
|---------|-----------|----------------------|
| **Stabsraum** | Persistenter Mehrbenutzer-Raum, entspricht einer Lage/einem Einsatz | `Stabsraum` / `room` |
| **Lobby-Code** | Beitrittscode zu einem Stabsraum | `joinCode` |
| **S1 … S6** | Sachgebiete des Führungsstabs (siehe unten) | `role: "S1"…"S6"` |
| **Lagekartenführer** | Pflegt die gemeinsame Lagekarte | `role: "LAGEKARTE"` |
| **Einsatztagebuchführer** | Pflegt das Einsatztagebuch | `role: "ETB"` |
| **Monitor** | Reine Lese-/Anzeigerolle (z. B. Beamer/Wandmonitor) | `role: "MONITOR"` |
| **Modul** | Unter-Anwendung im Stabsraum | `module` |
| **Taktisches Zeichen** | Symbol nach DV 102 | `Symbol` / `mapFeature` |
| **Lagebild** | Kartendarstellung der Lage | `lagekarte` |

**Sachgebiete (S1–S6) nach FwDV/DV 100 – Stabsarbeit:**

- **S1** Personal / Innerer Dienst
- **S2** Lage (Lagefeststellung, Lagedarstellung)
- **S3** Einsatz (Einsatzdurchführung)
- **S4** Versorgung / Logistik
- **S5** Presse- und Medienarbeit
- **S6** Information und Kommunikation (IuK)

> Alle S-Rollen sind fachliche Führungsrollen und haben in LageKatSe **volle Schreibrechte** in
> allen Modulen (siehe [Rechtemodell](#6-rollen--rechtemodell)).

---

## 3. Architekturüberblick

LageKatSe ist eine klassische **Single-Page-App (SPA)** mit einem **autoritativen Sync-Backend**.
Der Server ist bewusst der einzige Vermittler (Stern-Topologie, **kein P2P**) – nur so lassen sich
die Rollenrechte (L4) verlässlich durchsetzen.

```mermaid
flowchart TB
  subgraph Clients["Clients (Browser)"]
    direction LR
    C1["Stab S3<br/>(RW überall)"]
    C2["Lagekartenführer<br/>(RW nur Karte)"]
    C3["Monitor<br/>(read-only)"]
  end

  subgraph Server["LageKatSe Backend (Node.js)"]
    direction TB
    HTTP["HTTP-API<br/>(Raum anlegen/beitreten,<br/>Import/Export, Auth)"]
    WS["WebSocket-Gateway<br/>+ Rechte-Durchsetzung"]
    SYNC["Sync-Engine<br/>(Yjs-Dokumente je Raum×Modul,<br/>im Speicher)"]
    PRES["Presence/Awareness<br/>+ Chat"]
    WS --> SYNC
    WS --> PRES
    HTTP --> SYNC
  end

  DB[("PostgreSQL<br/>Räume, Sessions,<br/>Dok.-Snapshots, Chat")]
  TILES["OSM Tile-Server<br/>(extern / self-hosted)"]

  C1 <-->|"WSS (CRDT-Updates,<br/>Awareness)"| WS
  C2 <-->|WSS| WS
  C3 <-->|WSS| WS
  C1 -.->|HTTPS| HTTP
  Clients -.->|"Kartenkacheln"| TILES
  SYNC <-->|"Snapshots + Update-Log"| DB
  HTTP <--> DB
```

### Kernkomponenten

- **SPA (Frontend):** rendert Lobby, Übersicht und die drei Module. Hält je Modul ein lokales
  **Yjs-Dokument**, das über den WebSocket mit dem Server synchronisiert wird. Kartenkacheln kommen
  direkt vom OSM-Tile-Server (nicht über unser Backend).
- **HTTP-API:** zustandsarme REST-Endpunkte für Raum-Lebenszyklus (anlegen, beitreten, Rollen),
  Auth (Session-Token) sowie Import/Export.
- **WebSocket-Gateway:** authentifiziert jede Verbindung anhand des Session-Tokens, kennt damit die
  Rollen der Session und **entscheidet pro eingehendem Update, ob es angewendet und verteilt wird**.
- **Sync-Engine:** hält je aktivem Raum die Modul-Dokumente im Speicher, wendet erlaubte Updates an,
  verteilt sie an alle Verbindungen des Raums und persistiert debounced in die DB.
- **Presence/Chat:** flüchtige Awareness (wer ist online, in welchem Modul) + persistenter Raum-Chat.
- **PostgreSQL:** dauerhafte Speicherung (Räume, Rollen-Sessions, Dokument-Snapshots, Chatverlauf).

### Warum autoritativer Server statt reinem P2P-CRDT?

CRDTs (z. B. Yjs) sind für *gegenseitig vertrauende* Peers gebaut – jeder darf alles ändern.
Unsere Anforderung L4 (read-only-Rollen, modulscharfe Rechte) lässt sich damit **nicht** clientseitig
durchsetzen. Deshalb ist der Server die einzige „Wahrheitsinstanz": Er ist das Nadelöhr, durch das
jedes Update muss, und verwirft unerlaubte Schreibzugriffe, bevor sie andere erreichen.

---

## 4. Technologie-Stack (Entscheidungen)

| Ebene | Wahl | Begründung / Alternative |
|-------|------|--------------------------|
| **Frontend-Framework** | React + TypeScript + Vite | Große Ökosystem-Unterstützung, gute Yjs-Bindings. *Alt.: Vue/Svelte* |
| **Karte** | **Leaflet** + OpenStreetMap | Reif, einfache Custom-SVG-Marker & Polygone, geringe Einstiegshürde. *Alt.: MapLibre GL (GPU, vektorbasiert) – mehr Leistung, höhere Komplexität* |
| **Zeichnen auf Karte** | Leaflet-Geoman (oder Leaflet.draw) | Polygone/Flächen für Bereichs-Maskierung, Bearbeiten/Verschieben |
| **Echtzeit-Sync** | **Yjs** (CRDT) über WebSocket | Automatische Konfliktauflösung, Hot-Join, Offline/Resync „eingebaut" (L1, L2, L6) |
| **Offline-Cache** | `y-indexeddb` | Lokaler Zwischenstand, überlebt Reload/Verbindungsabbruch |
| **Backend-Runtime** | Node.js + TypeScript | Gleiche Sprache/Modelle wie Client (Yjs läuft server- wie clientseitig) |
| **HTTP** | Fastify | Schlank, schnell, gutes TS-Typing. *Alt.: Express* |
| **WebSocket** | `ws` + `y-protocols` | Yjs-Sync-/Awareness-Protokoll, eigene Rechte-Schicht darüber |
| **Datenbank** | **PostgreSQL** | Bewährt, transaktional; Snapshots als `bytea`. Passt zum vorhandenen Stack-Know-how |
| **Taktische Zeichen** | SVG-Bibliothek (DV 102) | Als Assets eingebunden, Index als JSON (siehe Modul 1) |
| **Containerisierung** | Docker / Docker Compose | Reproduzierbares Deployment |

**Sprachpolitik:** Domänenbegriffe (Stabsraum, Lagekarte, Einsatztagebuch) bleiben deutsch in UI und
API. Interne Bezeichner/Feldnamen englisch, wo es die Lesbarkeit erhöht.

---

## 5. Echtzeit-Synchronisation & Hot-Join

### 5.1 Zustands-Aufteilung: ein CRDT-Dokument pro Raum × Modul

Statt eines großen Dokuments pro Stabsraum verwenden wir **je Modul ein eigenes Yjs-Dokument**:

```
Stabsraum "ABC-123"
 ├── ydoc:lagekarte      (Y.Map "features")        → Rechte-Scope "lagekarte"
 ├── ydoc:einsatztagebuch(Y.Array "entries")       → Rechte-Scope "etb"
 ├── ydoc:arbeitsblatt   (mehrere top-level Y.Map/Y.Array, Felder A/C/D/E/F) → Rechte-Scope "arbeitsblatt"
 └── ydoc:chat           (Y.Array "messages")      → Rechte-Scope "chat"
```

Diese Aufteilung ist die zentrale Design-Entscheidung: **Die Dokumentgrenze ist gleichzeitig die
Rechtegrenze.** Der Server kann eine WebSocket-Verbindung pro Dokument als *read-write* oder
*read-only* binden. Das macht die Rechtedurchsetzung einfach und robust (siehe [§6](#6-rollen--rechtemodell)).

> Das Taktische Arbeitsblatt **referenziert** die Lagekarte nur lesend (eingebettetes Lagebild) –
> es dupliziert die Kartendaten nicht. Es abonniert `ydoc:lagekarte` read-only.

### 5.2 Warum CRDT (Yjs) den Hot-Join löst

Ein Yjs-Dokument kann seinen Gesamtzustand jederzeit als kompaktes Binärformat ausgeben
(`Y.encodeStateAsUpdate`). Ein neu beitretender Client schickt seinen (leeren) *State Vector*, der
Server antwortet mit genau dem fehlenden Diff. Ergebnis: **Hot-Join ist ein Einzeiler im Protokoll**,
kein Sonderfall (erfüllt L2). Konkurrierende Änderungen an *verschiedenen* Objekten werden
deterministisch zusammengeführt; ändern zwei Personen dasselbe Objekt gleichzeitig, gewinnt der
letzte Schreibvorgang (Last-Write-Wins – in der Lagekarte pro Feature als Ganzes, siehe §8.3),
ohne den übrigen Zustand zu berühren.

### 5.3 Ablauf: Beitritt & Hot-Join

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser (Beitretender)
    participant H as HTTP-API
    participant W as WebSocket-Gateway
    participant S as Sync-Engine
    participant DB as PostgreSQL

    B->>H: POST /rooms/{code}/join {name, roles[]}
    H->>DB: Raum prüfen, Session anlegen
    H-->>B: Session-Token (room, roles, sessionId)

    B->>W: WS-Connect (Token) + subscribe(module)
    W->>W: Token prüfen → Rollen → Schreib-Scopes
    W->>S: Dokument sicherstellen (lazy load)
    alt Dokument noch nicht im Speicher
        S->>DB: Snapshot + Update-Log laden
        DB-->>S: Zustand
    end
    B->>W: sync-step-1 (leerer State Vector)
    W->>S: Diff berechnen
    S-->>B: sync-step-2 (kompletter Modulzustand)  %% Hot-Join
    W-->>B: Awareness-Snapshot (wer ist online)

    Note over B,W: Ab jetzt: Live-Updates in beide Richtungen
```

### 5.4 Live-Update mit Rechteprüfung

```mermaid
sequenceDiagram
    autonumber
    participant A as Client A (Autor)
    participant W as WS-Gateway (Rechte)
    participant S as Sync-Engine
    participant B as Client B
    participant M as Monitor (read-only)

    A->>W: CRDT-Update (Modul "lagekarte")
    W->>W: Darf Session in "lagekarte" schreiben?
    alt erlaubt
        W->>S: Update anwenden
        S-->>B: Update weiterleiten
        S-->>M: Update weiterleiten (nur Anzeige)
        S->>S: debounced → Snapshot persistieren
    else verboten (z. B. Monitor)
        W--xA: Update verworfen + Resync erzwingen
        Note over A,W: Optimistische lokale Änderung<br/>wird zurückgerollt
    end
```

---

## 6. Rollen- & Rechtemodell

### 6.1 Rollen und Modul-Scopes

Rechte werden **pro Modul** als Schreib-Scope vergeben. Lesen ist für alle Rollen in allen Modulen
erlaubt (das gesamte Lagebild ist für den ganzen Stab einsehbar). Es zählt also nur, **wer wo
schreiben darf**:

| Rolle | Lagekarte | Einsatztagebuch | Arbeitsblatt | Chat | Anmerkung |
|-------|:---------:|:---------------:|:------------:|:----:|-----------|
| **S1–S6** | ✅ RW | ✅ RW | ✅ RW | ✅ | Keine Beschränkungen |
| **Lagekartenführer** | ✅ RW | 👁 RO | 👁 RO | ✅ | Schreibt nur in der Lagekarte |
| **Einsatztagebuchführer** | 👁 RO | ✅ RW | 👁 RO | ✅ | Schreibt nur im ETB |
| **Monitor** | 👁 RO | 👁 RO | 👁 RO | ⚠️ | Reine Anzeige |

Legende: ✅ RW = Lesen+Schreiben · 👁 RO = nur Lesen · ⚠️ = zu klären

> **⚠️ zu klären – Chat für Monitor:** Der Monitor „darf alles sehen, aber nichts ändern". Chat ist
> Koordination, keine Lageänderung. Empfehlung: Chat für **alle** Rollen erlaubt (auch Monitor),
> da ein Wandmonitor selten tippt und die Trennung sonst künstlich wirkt. Alternativ Monitor
> chat-stumm. Als konfigurierbare Raum-Einstellung umsetzbar.

### 6.2 Additive Zusammenführung bei Mehrfachrollen

Rollen werden per Checkbox gewählt; ein Nutzer kann mehrere haben. Die effektiven Rechte sind die
**Vereinigung** der Einzelrechte (Prinzip: *das großzügigste Recht gewinnt*):

```ts
type Module = "lagekarte" | "etb" | "arbeitsblatt" | "chat";

const WRITE_SCOPES: Record<Role, Module[]> = {
  S1: ["lagekarte", "etb", "arbeitsblatt", "chat"],
  S2: ["lagekarte", "etb", "arbeitsblatt", "chat"],
  S3: ["lagekarte", "etb", "arbeitsblatt", "chat"],
  S4: ["lagekarte", "etb", "arbeitsblatt", "chat"],
  S5: ["lagekarte", "etb", "arbeitsblatt", "chat"],
  S6: ["lagekarte", "etb", "arbeitsblatt", "chat"],
  LAGEKARTE: ["lagekarte", "chat"],
  ETB:       ["etb", "chat"],
  MONITOR:   [], // ggf. ["chat"], siehe oben
};

// Effektive Schreibrechte = Vereinigung über alle gewählten Rollen
function effectiveWriteScopes(roles: Role[]): Set<Module> {
  return new Set(roles.flatMap((r) => WRITE_SCOPES[r]));
}
```

**Beispiel:** Wählt jemand *Lagekartenführer* **und** *Einsatztagebuchführer*, darf er in Karte **und**
ETB schreiben (Vereinigung), im Arbeitsblatt bleibt er read-only. Wählt jemand irgendeine S-Rolle,
sind alle weiteren Häkchen faktisch wirkungslos (S deckt bereits alles ab).

### 6.3 Durchsetzung (autoritativ, serverseitig)

```mermaid
flowchart TD
    U["Eingehendes Update<br/>(Session X, Modul M)"] --> C{"M ∈ effectiveWriteScopes(rollenVon(X))?"}
    C -->|ja| APPLY["Update anwenden<br/>+ an alle im Raum verteilen<br/>+ debounced persistieren"]
    C -->|nein| DROP["Update verwerfen<br/>+ Client-Resync erzwingen"]
```

Wichtig: Die UI blendet für read-only-Module Bearbeiten-Funktionen aus (gute UX), aber die
**Sicherheit hängt nicht daran** – der Server ist die durchsetzende Instanz. Ein manipulierter Client
kann keine unerlaubten Änderungen erzwingen.

---

## 7. Datenmodell

### 7.1 Relationales Schema (PostgreSQL)

Persistiert werden dauerhafte, langlebige Dinge. Präsenz (wer ist gerade online) ist flüchtig und
lebt nur im Speicher.

```mermaid
erDiagram
    STABSRAUM ||--o{ SESSION : "hat"
    STABSRAUM ||--|{ MODULE_DOC : "besitzt"
    STABSRAUM ||--o{ CHAT_MESSAGE : "enthält"

    STABSRAUM {
        uuid id PK
        text join_code UK "Lobby-Code"
        text name
        text room_secret_hash "optionales Raum-Passwort (bcrypt)"
        timestamptz created_at
        timestamptz last_active_at
        jsonb settings
    }
    SESSION {
        uuid id PK
        uuid room_id FK
        text display_name
        text[] roles
        timestamptz joined_at
        timestamptz last_seen "für Präsenz-Timeout"
    }
    MODULE_DOC {
        uuid room_id FK
        text module "lagekarte|etb|arbeitsblatt|chat"
        bytea ydoc_state "Y.encodeStateAsUpdate (Snapshot)"
        int seq "monoton, für Update-Log"
        timestamptz updated_at
    }
    CHAT_MESSAGE {
        uuid id PK
        uuid room_id FK
        text author_name
        text[] author_roles
        text body
        timestamptz created_at
    }
```

> **Chat** wird sowohl als Yjs-Dokument (Live) als auch relational (Suche/Export/Retention) geführt –
> pragmatisch, weil Chat append-only ist. Alternativ nur als Yjs-Doc; dann entfällt `CHAT_MESSAGE`.

### 7.2 Persistenzstrategie für CRDT-Dokumente

- **Snapshot + Update-Log:** Zwischen Snapshots werden eingehende Updates append-only mitgeschrieben
  (Durability). Periodisch/debounced wird der Gesamtzustand als neuer Snapshot komprimiert
  (`ydoc_state`) und das Log gekürzt. So bleibt Recovery schnell und der Speicher klein.
- **Lazy Load / Unload:** Ein Raum wird beim ersten Beitritt in den Speicher geladen und nach
  Inaktivität (kein Teilnehmer mehr, Timeout) wieder entladen – der Snapshot bleibt in der DB (L3).

---

## 8. Modul 1 – Gemeinsame Lagekarte

Das Herzstück: eine OpenStreetMap-Karte, auf der der Stab die Lage grafisch führt.

### 8.1 Funktionsumfang

- **OSM-Grundkarte** (Leaflet), frei verschieb-/zoombar. **Kartenansicht-Persistenz:**
  Mitte + Zoom werden **pro Raum** betrachter-lokal (localStorage) gemerkt und überleben
  Modul-Wechsel und Reload (client-lokal, nicht im CRDT — wie E9/§8.3).
- **DWD-Regenradar (optional):** schaltbares WMS-Overlay des Deutschen Wetterdienstes
  (`dwd:Niederschlagsradar`, `maps.dwd.de`), **client-lokaler Toggle** (localStorage, nicht im CRDT
  — wie die Symbolgröße, §8.3/E9; wirkt daher auch für den Nur-Lese-Monitor). Bild-Kacheln kommen
  direkt vom DWD (kein Server/CORS). Quelle: Deutscher Wetterdienst. Erster Teil von #44 (Wetterdaten).
- **DWD-KONRAD3D (optional):** schaltbares WMS-Overlay des Deutschen Wetterdienstes
  (`dwd:K3D_EVAL_current_cells` + `cur_track_lines`, `maps.dwd.de`), das automatisch
  erkannte konvektive Zellen (Gewitterzellen) als gefuellllte Polygone (rot/gelb/gruen
  nach Schweregrad) mit schwarzen Zugbahn-Linien darstellt. Zusaetzliche Zell-Infos
  (Hagel, Windboeen, Starkregen, VIL, Echo-Top, Zellgeschwindigkeit) werden per
  WMS GetFeatureInfo bei **Klick auf eine Zelle** als Popup angezeigt — nicht als
  Bildlayer, um die Zellfarben nicht zu uebermalen. Wie das Regenradar
  **client-lokal** (localStorage, nicht im CRDT; wirkt auch fuer den Nur-Lese-Monitor).
  Bild-Kacheln direkt vom DWD (kein Server/CORS). Quelle: Deutscher Wetterdienst.
- **Taktische Zeichen (DV 102) platzieren:** aus einer durchsuchbaren, **nach Typ
  gruppierten** Symbol-Palette (Untermenüs je Organisation — `Org_Typ`-Kategorien werden
  unter dem Typ einsortiert, 34 → 12 Top-Level) per Klick auf die Karte setzen;
  verschieben (Drag), beschriften, löschen. *(Drehen ist im
  Datenmodell vorgesehen/gerendert, aber noch ohne Bearbeitungs-UI.)*
- **Symbolgröße = globaler Darstellungs-Slider pro Betrachter, nicht pro Symbol.** Die
  DV-102-Zeichen sind alle gleich groß, und Größe ist nicht bedeutungstragend; der Bedarf ist
  Lesbarkeit je nach Bildschirm/Abstand (Beamer, Tablet). Der Slider ist client-lokal (nicht im
  CRDT) und wirkt daher auch für Nur-Lese-Betrachter (Monitor). Siehe §8.3 und E9.
- **Bereiche maskieren:** Polygon/Rechteck/Kreis zeichnen, halbtransparent, **Farbe wählbar**
  (z. B. Schadensgebiet rot, Bereitstellungsraum blau, Absperrbereich gelb).
- **Beschreibungen:** Jedes Zeichen und jede Fläche kann eine Beschreibung tragen, die bei
  **MouseOver als Tooltip** erscheint.
- **Live-Sync** aller Änderungen (Platzieren, Verschieben, Löschen, Beschreibung ändern) über das
  Backend; **Hot-Join** jederzeit.
- **Import/Export** als JSON (lokale Sicherung).

### 8.2 Taktische Zeichen – Asset-Pipeline

Quelle (in M1 umgesetzt): [jonas-koeritz/Taktische-Zeichen](https://github.com/jonas-koeritz/Taktische-Zeichen)
**v2.0.0** (`release.zip`) – 894 SVG-Vektorgrafiken, nach Organisation/Typ in Ordnern
(z. B. `Feuerwehr_Fahrzeuge/`, `Feuerwehr_Einheiten/`, `Fahrzeuge/`). Vendored unter
`packages/web/public/taktische-zeichen/svg/`; Herkunft und Lizenz stehen in
`packages/web/public/taktische-zeichen/ATTRIBUTION.md`.

- **Build-Schritt:** Aus `svg/` wird ein **Symbol-Index** (`index.json`) generiert
  (`node packages/web/scripts/build-symbol-index.mjs`) – er speist die durchsuchbare Palette.
- **Im CRDT wird nur die Referenz gespeichert** (`symbolId`, z. B. `Feuerwehr_Fahrzeuge/Kraftfahrzeug`),
  nicht die SVG-Daten – das Dokument bleibt klein und schnell synchronisierbar.
- **Lizenz (geklärt, E4):** Die fertigen Zeichen aus `release.zip` sind **gemeinfrei (CC0 1.0)** –
  keine Attribution nötig. (Der Quell-*Code* des Repos steht unter CC BY 4.0; übernommen werden aber
  ausschließlich die gemeinfreien Zeichen.)

### 8.3 Datenstruktur (Yjs-Dokument `lagekarte`)

Ein `Y.Map` `features`, Schlüssel = Feature-`id`, Wert = **das Feature-Objekt als Ganzes**
(`SymbolFeature | AreaFeature`, per `Y.Map.set` gesetzt – kein verschachteltes `Y.Map` je Feld).
Positionen als WGS84 (`[lat, lng]`), damit OSM-kompatibel.

```ts
// Taktisches Zeichen
interface SymbolFeature {
  id: string;                 // uuid
  kind: "symbol";
  symbolId: string;           // Referenz in den DV-102-Symbol-Index
  position: [number, number]; // [lat, lng]
  rotation: number;           // Grad, 0 = Norden (gerendert, aber noch keine Bearbeitungs-UI)
  label?: string;             // Kurzbeschriftung an der Karte
  description?: string;       // Tooltip bei MouseOver
  createdBy: string;          // Anzeigename
  createdAt: string;          // ISO-8601
  updatedAt: string;
}

// Maskierter Bereich
interface AreaFeature {
  id: string;
  kind: "area";
  shape: "polygon" | "rectangle" | "circle";
  geometry: [number, number][]; // polygon/rectangle: Ring aus [lat,lng]; circle: einzelner Mittelpunkt
  radiusM?: number;             // nur circle, Radius in Metern
  color: string;                // z. B. "#d5372b"
  opacity: number;              // Füll-Deckkraft 0..1
  label?: string;
  description?: string;         // Tooltip
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
```

> **Darstellungsgröße (nicht im Modell):** Die Icon-Größe ist eine **betrachter-lokale**
> Einstellung (globaler Slider, in `localStorage` je Client), kein Feld am Feature – sie wird
> nicht synchronisiert. So wählt jeder (auch der read-only Monitor/Beamer) die für seinen
> Bildschirm passende Größe, ohne den geteilten Zustand zu ändern. Rotation dagegen ist eine
> echte geteilte Eigenschaft und bleibt am Feature.

**Konfliktverhalten (wie in M1 umgesetzt):** Jedes Feature ist **ein** Wert im `Y.Map`, als Ganzes
per `Y.Map.set(id, feature)` gesetzt. Änderungen an *verschiedenen* Features stören sich nicht;
ändern zwei Personen **dasselbe** Feature gleichzeitig, gewinnt der letzte Schreibvorgang für das
**gesamte** Feature (Whole-Value-Last-Write-Wins) – eine parallele Änderung an einem anderen Feld
desselben Features kann dabei verloren gehen. Für die Lageführung ist das vertretbar (⚠️ ggf. mit
Zielgruppe validieren; feldweises Merge wäre eine spätere Ausbaustufe).

### 8.4 Import/Export-Format

```jsonc
{
  "format": "lagekatse.lagekarte",
  "version": 1,
  "exportedAt": "2026-07-28T10:15:00Z",
  "view": { "center": [51.96, 7.63], "zoom": 13 },
  "features": [ /* SymbolFeature | AreaFeature, siehe oben */ ]
}
```

> Export ≈ GeoJSON-nah gehalten, damit später Interop mit GIS-Tools möglich ist. Import ist eine
> schreibende Aktion → nur für Rollen mit Schreib-Scope `lagekarte` (Lagekartenführer/S-Rollen).

---

## 9. Modul 2 – Gemeinsames Einsatztagebuch

Ein kollaboratives, tabellarisches Einsatztagebuch (ETB) in Anlehnung an die Vorlage
**FM-A-31 (KFV Bayreuth)** und übliche FwDV-Praxis.

> **In M2 umgesetzt** (PR #31): Anlegen (server-autoritativ), Feld-Edits, Storno und
> CSV-Export. Änderungshistorie, CSV-Import und PDF sind zurückgestellt (§9.4).

### 9.1 Funktionsumfang

- **Fortlaufende Tabelle** von Einträgen; neue Zeile per Klick.
- **Lfd. Nr.** wird automatisch vergeben (server-monoton, lückenlos).
- **Uhrzeit** wird beim Anlegen automatisch gesetzt (**Server-Zeit**, nicht Client-Uhr) – **editierbar**.
- **Live-Sync** & **Hot-Join** wie bei der Karte; Sichtbarkeit für alle, Schreiben je Rechte-Scope.
- **Export** als **JSON** (verlustfrei, re-importierbar via Bundle §12) und **PDF** (Ablage/Nachweis).

### 9.2 Spalten (Vorschlag, ⚠️ final gegen FM-A-31 abgleichen)

| Feld | Auto | Editierbar | Bemerkung |
|------|:----:|:----------:|-----------|
| `lfdNr` | ✅ | 🔒 | monoton, serverseitig vergeben |
| `zeit` | ✅ (Serverzeit) | ✅ | ISO-8601, editierbar |
| `richtung` | – | ✅ | Eingang (E) / Ausgang (A) |
| `von` | – | ✅ | Absender/Meldender |
| `an` | – | ✅ | Empfänger |
| `weg` | – | ✅ | Funk / Telefon / Fax / persönlich / E-Mail |
| `inhalt` | – | ✅ | Meldung / Ereignis |
| `veranlassung` | – | ✅ | Maßnahme / Verfügung |
| `erledigt` | – | ✅ | Checkbox |
| `bearbeiter` | (Vorbelegung: Name) | ✅ | Handzeichen |

### 9.3 Datenstruktur (Yjs-Dokument `einsatztagebuch`)

`Y.Array` `entries`, jeder Eintrag ein `Y.Map` (so mergen konkurrierende Edits an
**verschiedenen** Feldern derselben Zeile feldweise — kein Whole-Value-LWW wie bei der Karte):

```ts
interface LogEntry {
  id: string;              // uid, serverseitig vergeben
  lfdNr: number;           // serverseitig monoton, lückenlos
  zeit: string;            // ISO-8601, Vorbelegung = Serverzeit, editierbar
  richtung: "E" | "A" | "";
  von: string;
  an: string;
  weg: "Funk" | "Telefon" | "Fax" | "persönlich" | "E-Mail" | "";
  inhalt: string;
  veranlassung: string;
  erledigt: boolean;
  bearbeiter: string;      // Vorbelegung = Anzeigename
  storniert?: boolean;     // §9.4: Storno statt Löschen (hält die Lfd-Nr.-Kette)
  // Zurückgestellt (§9.4): history?: { at; by; field; from; to }[] — Änderungsspur.
}
```

**Autoritatives Anlegen (umgesetzt):** `lfdNr` und die initiale `zeit` dürfen nicht vom
Client stammen (sonst racen zwei Clients auf dieselbe Nummer / nehmen ihre lokale Uhr).
Ein neuer Eintrag läuft daher über `POST /api/rooms/:code/etb/entries`
(`RoomHub.appendEtbEntry`): der Server prüft Token + Scope `etb`, vergibt `lfdNr = max+1`
(atomar) und `zeit` aus der Serveruhr und pusht den Eintrag ins CRDT. Alle **weiteren**
Feld-Änderungen sind normale CRDT-Writes pro Entry-`Y.Map`.

### 9.4 Fachliche Besonderheit: Nachvollziehbarkeit

Ein Einsatztagebuch ist ein **Führungs- und ggf. Nachweisdokument**. Die Anforderung „Uhrzeit
editierbar" ist praxisgerecht (Nachträge), birgt aber Manipulationsrisiko. **Empfehlung:** Einträge
bleiben editierbar, aber pro Eintrag wird eine **Änderungshistorie** (wer/wann/was) mitgeführt und
im Export ausgewiesen. Löschen ersetzen wir durch „stornieren" (Eintrag bleibt, wird als ungültig
markiert). So bleibt die lückenlose Lfd.-Nr.-Kette erhalten. **⚠️ mit Zielgruppe abstimmen**, ob das
gewünscht/nötig ist.

> **Stand M2:** **Storno umgesetzt** (Eintrag bleibt, wird durchgestrichen). Die volle
> **Änderungshistorie** ist zurückgestellt, bis der Bedarf mit der Zielgruppe geklärt ist.

### 9.5 Export (JSON + PDF)

> **JSON-Export** (verlustfrei: `id`/`lfdNr`/`zeit`/`storniert`, Envelope `lagekatse.etb`) — er ist
> die re-importierbare Form (Bundle, §12). Zusätzlich **PDF-Export** (A4 quer, client-seitig via
> pdf-lib; §10.4) als Nachweis-Ausdruck. Der frühere **CSV-Export entfiel mit #71** (Vereinheitlichung
> mit dem Arbeitsblatt: JSON + PDF). Re-Import nur server-autoritativ über den Bundle-Import (§12).

---

## 10. Modul 3 – Taktisches Arbeitsblatt

Digitale Abbildung des **Taktischen Arbeitsblatts (IdF NRW, DIN A4)** – ein strukturiertes Formular
rund um ein eingebettetes Lagebild. Alle Felder werden zwischen den Teilnehmern synchronisiert.

> **Umgesetzt** (Vorderseite): Felder A, C, D, E, F live-synchron (Feld-/Zeilen-Level-Merge),
> Feld B als eingebettete read-only Lagekarte **plus Gefahren-Randfelder (4 A – 1 C – 4 E)**,
> **JSON-Export *und* -Import** (Import validiert gegen das Schema und spielt als **eine**
> CRDT-Transaktion ein, nur Schreibberechtigte, mit Bestätigungsdialog) sowie **PDF-Export**
> (client-seitig via pdf-lib). Aus der Rückseite (#42) ist die **Wetter-Sektion** umgesetzt
> (DWD/BrightSky, s. §10.5); ABC/MANV/Dekon wurden verworfen (#42 geschlossen).
> **Verworfen:** Karte aus dem Arbeitsblatt heraus bearbeiten (#41 — das eingebettete
> Kartenfeld ist zu klein, die Werkzeugleiste zu groß → Feld B bleibt read-only).

### 10.1 Feldaufteilung (Vorderseite, gemäß IdF-Vorlage)

Das Arbeitsblatt ist in feste Felder gegliedert (die Grundstruktur der Vorlage bleibt erhalten):

| Feld | Bereich | Inhalt |
|------|---------|--------|
| **A** | Kopfzeile | Einsatzstichwort, Einsatzort, Meldender, Objektnr., Datum-Uhrzeitgruppe |
| **B** | **Lagebild** | **Eingebettete, live-synchrone Lagekarte** (Modul 1) + Randfelder für Gefahren |
| **C** | Führungsvorgang | Tabelle: bedrohtes Objekt/Subjekt · Wirkung · Priorität · Maßnahmen · erledigt |
| **D** | Rückmeldungen/Notizen | Freie Notiz-/Checkliste |
| **E** | Eigene Lage / Nachforderung | Auftrag (MR/BB), Kräfteübersicht, Nachforderung (freie Einträge) |
| **F** | Organisation/Kommunikation | Funkkanäle (TMO-/DMO-Gruppe, Führung, Gebäude), Führungs-Organigramm, eigene Funktion |

> Die **Rückseite** (Checklisten für ABC-/Gefahrgut-Einsatz, Wetterdaten, Dekon, MANV/Rettungsdienst)
> ist umfangreich und spezialisiert → **Phase 2** (siehe Roadmap). MVP fokussiert die Vorderseite.

### 10.2 Das Lagebild ist die Lagekarte (kein Duplikat)

Feld **B** zeigt **dasselbe** synchronisierte Kartenbild wie Modul 1 – technisch abonniert das
Arbeitsblatt das `lagekarte`-Dokument **read-only** und rendert eine kompakte Kartenansicht. Änderungen
an der Karte erscheinen sofort auch im Arbeitsblatt. So gibt es **eine** Quelle der Wahrheit für die
Lage. (Wer in Modul 1 Schreibrechte hat, kann die Karte auch direkt aus dem Arbeitsblatt heraus
bearbeiten – optionaler Komfort, Phase 2.)

> **Umgesetzt (M3):** Feld B bindet die `Lagekarte`-Komponente read-only ein
> (`<Lagekarte … embedded readOnly>`) — dieselbe Render-Pipeline wie Modul 1, kein Duplikat.

### 10.3 Datenstruktur (Yjs-Dokument `arbeitsblatt`)

Statt eines einzelnen verschachtelten `sheet`-Objekts hält das Dokument **mehrere top-level
Yjs-Typen** (jeder vivifiziert bei erstem Zugriff, kein Seeding). So mergen konkurrierende Edits
an *verschiedenen* Feldern/Zeilen feldweise (nie Whole-Value wie die Karte, §8.3). Es gibt **keine**
server-autoritativen Felder → reine Client-CRDT-Writes, kein eigener HTTP-Endpoint (anders als das
ETB, §9.3). Definiert in `packages/shared/src/arbeitsblatt.ts`.

| Top-level Typ (Key) | Feld | Inhalt |
|---|:--:|---|
| `kopf` (`Y.Map`) | A | Kopf-Skalare (einsatzstichwort, einsatzort, meldender, objektnr, datumUhrzeitgruppe) |
| `gefahren` (`Y.Map`) | B | Gefahren-Randfelder, key → `{ betroffen, notiz? }` (4 A · 1 C · 4 E) |
| `fuehrungsvorgang` (`Y.Array<Y.Map>`) | C | Zeilen des Führungsvorgangs |
| `rueckmeldungen` (`Y.Array<Y.Map>`) | D | Notiz-/Checklisten-Einträge |
| `eigeneLage` (`Y.Map`) | E | auftragMr/auftragBb (bool), auftragText, kraefteuebersicht |
| `nachforderung` (`Y.Array<Y.Map>`) | E | freie Nachforderungs-Einträge |
| `organisation` (`Y.Map`) | F | Funkkanäle-Skalare + eigeneFunktion |
| `organigramm` (`Y.Array<Y.Map>`) | F | Zeilen des Führungs-Organigramms |

Feld **B** referenziert die `lagekarte` read-only (§10.2); die **Gefahren-Randfelder** (`gefahren`,
9 feste Gefahren nach dem Merkschema 4 A – 1 C – 4 E) sind seine einzigen eigenen Daten.

```ts
// Zusammengesetzter Snapshot (so via toJSON gelesen, u. a. für den JSON-Export):
interface Arbeitsblatt {
  kopf: { einsatzstichwort: string; einsatzort: string; meldender: string;   // A
          objektnr: string; datumUhrzeitgruppe: string };
  gefahren: Record<string, { betroffen: boolean; notiz?: string }>;          // B (4 A · 1 C · 4 E)
  fuehrungsvorgang: {                                                        // C (Y.Array<Y.Map>)
    id: string; bedrohtesObjekt: string; wirkung: string;
    prioritaet: 1 | 2 | 3 | ""; massnahmen: string; erledigt: boolean;
  }[];
  rueckmeldungen: { id: string; text: string; erledigt: boolean }[];        // D (Checkliste)
  eigeneLage: { auftragMr: boolean; auftragBb: boolean;                     // E
                auftragText: string; kraefteuebersicht: string };
  nachforderung: { id: string; text: string }[];                           // E (freie Einträge)
  organisation: {                                                           // F
    tmoGruppe: string; fuehrungsKanal: string; dmoGruppe: string; gebFunk: string;
    eigeneFunktion: "GF" | "ZF" | "VF" | "";
  };
  organigramm: { id: string; rolle: string; auftrag: string;               // F (Y.Array<Y.Map>)
                 fuehrer: string; rufname: string }[];
  // Feld B: gefahren = Gefahren-Randfelder; das Lagebild selbst ist read-only-Referenz auf `lagekarte`
}
```

### 10.4 Export / Import

- **JSON-Export** (vollständiger Formularzustand) für Sicherung/Weitergabe. **(umgesetzt)** –
  Envelope `{ format: "lagekatse.arbeitsblatt", version: 1, exportedAt, sheet }`.
- **JSON-Import** **(umgesetzt)** – Gegenstück zum Export: validiert die Datei gegen das Envelope-
  Schema und spielt sie als **eine** `doc.transact()` ein (ersetzt den gesamten, geteilten Stand;
  nur Schreibberechtigte; vorher Bestätigungsdialog, da der Replace für alle im Stabsraum wirkt).
- **PDF-Export** **(umgesetzt, M4)** – client-seitige Erzeugung mit **pdf-lib** (A4 hoch, Abschnitte
  A–F + Wetter, eingebettete DejaVu-Sans-Schrift für Umlaute/Sonderzeichen, Tabellen mit Wort-Umbruch
  und Paginierung). Bewusst **kein** Ausfüllen amtlicher AcroForm-Vorlagen (robust, keine Vorlagen-/
  Lizenz-Abhängigkeit); ETB und Arbeitsblatt teilen `packages/web/src/pdf.ts` (pdf-lib wird erst beim
  Klick per dynamischem `import()` geladen).

### 10.5 Rückseite: Wetter (DWD/BrightSky) — umgesetzt

Aus der zurückgestellten Rückseite (#42) ist nur der **Wetter-Teil** umgesetzt (ABC/MANV/Dekon
verworfen). Für die **Kartenmitte des Lagebilds** (kein Geocoding) werden über **BrightSky**
(DWD OpenData, CORS-offen, ohne Schlüssel) abgerufen: aktuelle Werte, 4-Stunden-Vorhersage und
aktive **DWD-Warnungen**. Der Snapshot liegt als **atomarer Whole-Value-Posten** im
`arbeitsblatt`-Doc (top-level `wetter`-`Y.Map`, ein Key) — **geteilt**: ein Schreibberechtigter
ruft ab, alle (auch der Nur-Lese-Monitor) sehen denselben Stand; leiser Auto-Refresh bei
Veralterung. Ein Button **„aktuelle Wetterdaten ins ETB eintragen"** legt einen ETB-Eintrag an
(server-autoritativ, §9). Neue Warnungen lösen einen aktiven Hinweis aus (Banner + der ohnehin
entstehende Aktivitäts-Dot; OS-Notification nur im secure context). Reine Client-Funktion
(`packages/web/src/wetter.ts`), keine Server-Änderung.

---

## 11. Präsenz & Chat

### 11.1 Präsenz (Awareness)

Über das Yjs-**Awareness**-Protokoll (flüchtig, nicht persistiert) teilt jeder Client seinen Status:

```ts
interface AwarenessState {
  sessionId: string;
  name: string;
  roles: Role[];
  color: string;          // Nutzerfarbe (Cursor/Marker)
  currentModule: Module | "uebersicht";
  lastActive: number;
}
```

Daraus speist sich die **Online-Liste** auf der Übersichtsseite („welche Rollen + Namen sind online")
und – als Ausbaustufe – Live-Cursor/Kartenausschnitt der anderen in der Lagekarte.

### 11.2 Chat

Raum-weiter Chat (`Y.Array` `messages`, zusätzlich relational für Export/Retention):

```ts
interface ChatMessage {
  id: string;
  authorName: string;
  authorRoles: Role[];
  body: string;
  createdAt: string; // Serverzeit
}
```

Anzeige auf der Übersichtsseite unter den Modul-Buttons (siehe Mockup).

### 11.3 Aktivitäts-Indikatoren (Rail-Dots)

Damit man sieht, wenn sich in einem Modul etwas tut, das man **nicht** offen hat (neue
Chat-Nachricht, ETB-Eintrag, Kartenänderung), zeigt der Rail einen kleinen **Aktivitäts-Dot**
am Modul-Symbol (umgesetzt, #32 Phase 1).

Die Shell ist dauerhaft nur mit dem `chat`-Dokument verbunden — die u. U. großen Modul-Docs
(v. a. Lagekarte) sollen ruhende Clients nicht mitsynchronisieren müssen. Deshalb ein
schlankes, **server-authored, nicht-persistiertes** Signal:

- **`activity`-Kanal** (ein Yjs-Dokument pro Raum, **kein** Rechte-Scope): eine `Y.Map`
  `counters` (`modul → monotoner Zähler`) und eine `Y.Map` `summaries` (`modul → kurzer
  Änderungstext`, für die Desktop-Benachrichtigungen, s. u.). Der Server erhöht den Zähler im
  `doc.on("update")`-Handler jeder echten Modul-Änderung (`RoomHub.bumpActivity`, gedrosselt,
  `SERVER_ORIGIN`); das Gateway bindet den Kanal für Clients **read-only**.
- **„gesehen"-Stand pro Betrachter** (`localStorage` pro Raum, **nicht** im CRDT — wie die
  Anzeige-Optionen E9): ein Dot erscheint, wenn `activity[modul] > seen[modul]` und das Modul
  nicht die aktive Ansicht ist; das Öffnen führt es als gesehen (eigene Edits, die man beim
  Draufschauen macht, dotten nie). Beim Beitritt wird auf den aktuellen Serverstand
  ge-baselined, damit vorbestehende Aktivität nicht dottet.

**Phase 2 (umgesetzt, #32):** zwei Stufen auf demselben Signal:

- **Tab-Titel-Indikator — immer an** (wie die Dots): der Browser-Tab trägt einen Zähler ungesehener
  Änderungen (`(3) LageKatSe`), der sich leert, sobald die Module angesehen werden (nutzt dieselben
  `counters`/`seen` wie die Dots; das aktive Modul zählt nie mit). Läuft über **reines http**, ohne
  „secure context" und ohne Berechtigung (`useActivityTitle`) — der verlässliche Basis-Hinweis.
- **Desktop-Benachrichtigungen — opt-in per Glocke, wo möglich** (`useActivityNotifications`): wo
  ein **secure context** vorhanden ist (HTTPS/`localhost`), feuert die Shell echte OS-Notifications —
  **Chat** mit vollem Text, **ETB-Anlegen** mit dem Server-`summaries`-Text „Neuer Eintrag · Lfd. N",
  sonst generisch; nur bei `document.hidden` und nach dem Baseline, Klick öffnet das Modul. Über http
  im LAN ist die Notification-API **nicht** verfügbar (gleicher Grund wie `uid()` statt
  `crypto.randomUUID`, Invariante #3) → die Glocke ist dort deaktiviert; der Tab-Titel greift trotzdem.

---

## 12. Import & Export

| Modul | Export | Import | Rechte |
|-------|--------|--------|--------|
| Lagekarte | JSON (GeoJSON-nah) | JSON | Schreib-Scope `lagekarte` |
| Einsatztagebuch | **JSON, PDF** | via Bundle | Schreib-Scope `etb` (Bundle: S-Rolle) |
| Arbeitsblatt | **JSON, PDF** | **JSON** | Schreib-Scope `arbeitsblatt` |
| **Ganzer Stabsraum** | **ZIP** (je Modul JSON) | **ZIP (Bundle-Import)** | S-Rolle |

- **Client-seitiger Download/Upload**; JSON-Import validiert gegen ein Schema und wird als **eine**
  CRDT-Transaktion eingespielt (damit sauber synchronisiert). **Umgesetzt:** Lagekarte-Im-/Export,
  ETB-JSON/-PDF, Arbeitsblatt-JSON-Im-/Export + -PDF, Gesamt-Export **und Bundle-Import** als **ZIP**
  auf der Übersicht (`exportAll.ts` / `importAll.ts`, via `fflate`). Dateinamen tragen eine
  **Datum-Uhrzeit-Gruppe** (DUG, z.B. `…-071930Aug26.…`; `dug.ts`).
- **ETB-Export ist JSON** (verlustfrei: `id`/`lfdNr`/`zeit`/`storniert`) — der frühere **CSV-Export
  entfiel** (#71): Nachweis-Ausdruck ist der PDF-Export, konsistent mit dem Arbeitsblatt (JSON + PDF).
- **Bundle-Import (#71):** ersetzt den geteilten Stand (faithful restore), **nur S-Rollen**,
  Bestätigungsdialog. Die apply-Logik teilen sich Einzeldatei- und Bundle-Import (`*/applyImport.ts`).
  Lagekarte/Arbeitsblatt laufen als **eine** Client-CRDT-Transaktion; der **ETB wird
  server-autoritativ** über `POST /api/rooms/:code/etb/import` (`RoomHub.replaceEtbEntries`)
  ersetzt — der Client legt keine ETB-Einträge direkt an (Invariante #6). `lfdNr`/`zeit`/`storniert`
  bleiben originalgetreu erhalten (nach `lfdNr` sortiert).

---

## 13. Persistenz, Recovery & Skalierung

### 13.1 Recovery

Server-Neustart: Räume werden **lazy** beim ersten Beitritt aus Snapshot + Update-Log rekonstruiert.
Da der komplette Zustand in der DB liegt, gehen keine Daten verloren (L3). Client-seitig überbrückt
`y-indexeddb` kurze Ausfälle; beim Reconnect gleicht Yjs automatisch ab (L6).

### 13.2 Skalierung

Ein Yjs-Dokument hat im Betrieb genau **einen** autoritativen Besitzer-Prozess. Für horizontale
Skalierung:

- **Einfach (MVP):** Ein Backend-Prozess; ein Raum lebt komplett dort. Reicht für viele parallele
  Stäbe mit je moderater Teilnehmerzahl.
- **Skaliert (später):** Raum-basiertes Sharding – ein Router leitet alle Verbindungen eines Raums
  an denselben Prozess (Consistent Hashing / Sticky). Prozessübergreifende Awareness/Updates über
  **Redis Pub/Sub**. Persistenz bleibt in PostgreSQL.

> Für die Zielgröße (einzelne Stäbe, z. B. < 30 Teilnehmer/Raum) ist die einfache Variante völlig
> ausreichend. Sharding erst bei echtem Bedarf.

---

## 14. Sicherheit & Datenschutz

- **Beitritt & Auth (MVP):** Lobby-Code als geteiltes Geheimnis + optionales Raum-Passwort
  (bcrypt-gehasht). Beim Beitritt wird ein **Session-Token** (JWT oder opak) ausgestellt, das
  `roomId`, `sessionId` und Rollen trägt und WebSocket wie HTTP-Aufrufe autorisiert. **Name ist
  selbst deklariert** (kein Identitätsnachweis).
- **Auth-Stärke — entschieden (Zielgruppe, #73):** **Lobby-Code + optionales Raum-Passwort in
  Kombination mit dem Rate-Limiting (§14/#64) genügen.** LageKatSe soll **ad-hoc** und mit **niedriger
  Nutzungshürde** bereitstehen (Usability vor Härtung) und ist **kein primäres Einsatzmittel** (s.
  Disclaimer unten) — daher ist keine hochgradige Sicherheit nötig. Ein **Auth-Proxy/SSO ist optional**
  (Deployment-Wahl des Betreibers, z.B. VPN/geschlossenes Netz), aber **nicht erforderlich**.
- **Transport:** ausschließlich TLS (HTTPS/WSS).
- **Autoritative Rechte:** siehe [§6.3](#6-rollen--rechtemodell) – Sicherheit unabhängig vom Client.
- **DSGVO & Retention (E10) — Frist entschieden (Zielgruppe, #73):** Meldungen/ETB können
  personenbezogene Daten enthalten. Backbone ist eine **automatische Inaktivitäts-Retention**: ein
  geplanter Server-Sweep löscht Räume (Cascade auf Sessions/Dokumente/Chat), deren `last_active_at`
  älter als die **Frist (Default 4 Wochen, konfigurierbar)** ist — kein Admin-Portal nötig. Da das ETB
  ein Nachweisdokument ist, **vor** dem Hard-Delete das Stabsraum-Bundle exportieren/archivieren (§12).
  Ergänzend ein **Self-Service „Lage abschließen"** durch die S-Rollen (Doppel-Bestätigung → Abschluss-
  ETB-Eintrag + Gesamt/PDF-Export → Landing-Page → serverseitiges Löschen; passt zu E8, kein
  Admin-Account). Zweckbindung, Auftragsverarbeitung, Server-Standort EU. Nur für den Postgres-Deploy
  relevant (Memory-Store vergisst beim Neustart). Umsetzung: #66 (Auto-Retention), #75 (Self-Service).
- **Rate-Limiting — umgesetzt (#64):** globales Limit pro IP + strengeres auf Beitritts-/Raum-Anlegen-
  Endpunkten (Brute-Force/Enumeration auf Lobby-Codes bremsen → zusätzlich ausreichend lange, zufällige
  Codes). Konfigurierbar; `TRUST_PROXY` für die echte Client-IP hinter einem Reverse-Proxy.
- **Kein primäres Einsatzmittel (Zielgruppe, #73):** LageKatSe ist ein **unterstützendes Werkzeug bzw.
  Übungsmittel** und erzeugt **keine rechtskräftigen Dokumente/Nachweise**. Dieser Hinweis wird auf der
  Startseite angezeigt (#76). Genau deshalb ist eine volle ETB-Änderungshistorie nicht nötig (E2:
  Storno reicht) und das Auth-Modell bewusst schlank gehalten.

---

## 15. Nicht-funktionale Anforderungen

| Aspekt | Ziel |
|--------|------|
| **Latenz** | Änderungen bei anderen Teilnehmern < ~300 ms (LAN/gute Verbindung) |
| **Offline** | Weiterarbeiten bei kurzem Verbindungsverlust, automatischer Resync |
| **Robustheit** | Kein Datenverlust bei Server-Neustart (Snapshot + Log) |
| **Barrierefreiheit** | Kontrastreiches, gut lesbares UI (Einsatzumgebung, Beamer/Monitor); betrachter-lokale Symbolgröße (Slider) |
| **Responsivität** | Nutzbar auf Laptop & Tablet (Stabsarbeit häufig am Tablet) |
| **Auditierbarkeit** | ETB mit Änderungshistorie, Serverzeit als Zeitquelle |
| **i18n** | Deutsch (KatS-Domäne); Struktur erlaubt spätere Erweiterung |

---

## 16. Deployment

- **Container:** Frontend (statisch, via Reverse-Proxy) + Backend (Node) + PostgreSQL, orchestriert
  per **Docker Compose**.
- **Reverse-Proxy** (Traefik/Nginx/Caddy) terminiert TLS und leitet `/api` + `/ws` ans Backend.
- **OSM-Tiles:** MVP nutzt öffentliche OSM-Tiles (Tile-Usage-Policy beachten!). Für Produktion/Einsatz
  **eigener Tile-Server** oder ein OSM-Tile-Anbieter → Offline-/Datenschutz-Vorteil.
- **Konfiguration** über Umgebungsvariablen (DB-URL, JWT-Secret, Tile-URL, Retention-Fristen).

```mermaid
flowchart LR
    Browser --> Proxy["Reverse-Proxy<br/>(TLS, Routing)"]
    Proxy -->|"/"| FE["Frontend<br/>(statische SPA)"]
    Proxy -->|"/api, /ws"| BE["Backend<br/>(Node.js)"]
    BE --> PG[("PostgreSQL")]
    Browser -.->|Kacheln| Tiles["OSM-Tile-Server"]
```

---

## 17. Offene Entscheidungen

Stand der Entscheidungen (2026-07-29 mit K. Kelker geklärt) — ✅ = entschieden, ▫ = Default (später revidierbar):

| # | Frage | Entscheidung |
|---|-------|--------------|
| E1 | Darf der Monitor chatten? | ✅ Konfigurierbar je Raum, **Standard: an** (Koordination ≠ Lageänderung) |
| E2 | ETB frei editierbar oder Historie/Storno? | ✅ **Entschieden (Zielgruppe, #73): Storno reicht** — frei editierbar + Storno (Eintrag bleibt, durchgestrichen; hält die Lfd-Nr.-Kette). Volle Änderungshistorie **verworfen** (LageKatSe ist kein primäres/rechtssicheres Einsatzmittel, s. §14 + Startseiten-Disclaimer #76) |
| E3 | Auth-Modell / -Stärke | ✅ **Entschieden (Zielgruppe, #73): schlank genügt** — Lobby-Code + optionales Raum-Passwort + Rate-Limiting (#64); Session-Token (JWT), selbst deklarierter Name. Usability/Ad-hoc vor Härtung, kein primäres Einsatzmittel. Auth-Proxy/SSO **optional** (Betreiber-Wahl), nicht erforderlich → #67 geschlossen |
| E4 | Lizenz DV-102-SVG-Bibliothek | ✅ Geklärt (M1): [jonas-koeritz/Taktische-Zeichen](https://github.com/jonas-koeritz/Taktische-Zeichen) v2.0.0, **CC0/gemeinfrei** (s. §8.2) |
| E5 | Konflikt beim Verschieben | ✅ Umgesetzt (M1): **Whole-Value-LWW pro Feature** (§8.3); feldweises Merge ggf. später, Nutzer-Test offen |
| E6 | Leaflet vs. MapLibre | ✅ Leaflet (in M1 ausgeliefert) |
| E7 | Rückseite Arbeitsblatt (ABC/MANV/Wetter) | ✅ Wetter umgesetzt (§10.5, DWD/BrightSky); ABC/MANV/Dekon verworfen (#42 geschlossen) |
| E8 | Nutzerkonten statt Raumcode? | ✅ Vorerst **Raumcode**, keine Accounts in M0; Accounts erst bei raumübergreifender Historie |
| E9 | Symbolgröße pro Symbol oder global? | ✅ **Global pro Betrachter** (lokaler Slider, `localStorage`); `SymbolFeature.scale` entfernt – Größe ist bei DV-102 nicht bedeutungstragend, Bedarf = Lesbarkeit (Beamer/Tablet) und muss auch für den RO-Monitor gehen. Rotation bleibt pro Symbol (§8.1/§8.3) |
| E10 | Alte Räume bei Postgres-Persistenz | ✅ **Entschieden (Zielgruppe, #73): Frist 4 Wochen** Inaktivität (Default, konfigurierbar) → geplanter Cascade-DELETE auf `last_active_at`; **vor** dem Löschen Stabsraum-Bundle-Export (§12). Ergänzend **Self-Service „Lage abschließen"** durch S-Rollen (kein Admin-Account, passt zu E8). Kein Admin-Portal nötig → #68 geschlossen. Nur Postgres-Deploy. Umsetzung: **#66** (Auto-Retention), **#75** (Self-Service). Vorarbeit: `last_active_at` auch bei Aktivität bumpen |

**Tooling (M0):** Monorepo mit **pnpm-Workspaces**, gemeinsames `shared`-Paket. Frontend React+Vite, Backend Fastify + `ws` + Yjs, PostgreSQL.

---

## 18. Umsetzungs-Roadmap

Iterativ, jede Stufe für sich lauffähig und demonstrierbar.

### M0 – Fundament (Skelett) — ✅ umgesetzt
- Projektsetup (Monorepo FE/BE), CI, Docker Compose
- Stabsraum anlegen/beitreten, Rollenwahl (Checkboxen), Session-Token
- WebSocket-Sync-Engine + Rechte-Gateway (generisch, modul-agnostisch)
- Übersichtsseite, Präsenz (Online-Liste) + Chat
- Persistenz (Snapshot + Update-Log), Recovery
- **Ergebnis:** Mehrere Nutzer sind in einem persistenten Raum, sehen sich, chatten.

### M1 – Gemeinsame Lagekarte — ✅ umgesetzt (PR #2)
- Leaflet + OSM, Symbol-Palette (DV 102), Platzieren/Verschieben/Löschen
- Bereichs-Maskierung (Farbe/Transparenz), Beschreibungen + Tooltips
- Live-Sync, Hot-Join, JSON-Import/-Export
- **Ergebnis:** Das zentrale Lagebild funktioniert kollaborativ.

### M2 – Gemeinsames Einsatztagebuch — ✅ umgesetzt (PR #31)
- Tabelle, Auto-Lfd.-Nr. (server-autoritativ, lückenlos), Auto-Zeit (Serverzeit, editierbar)
- Live-Sync (Feld-Level-Merge), Hot-Join, **Export** (ursprünglich CSV; seit #71 JSON + PDF), **Storno**
- Zurückgestellt: volle Änderungshistorie
- **Ergebnis:** Lückenloses, kollaboratives ETB.

### M3 – Taktisches Arbeitsblatt (Vorderseite) — ✅ umgesetzt
- Felder A, C, D, E, F synchronisiert (Feld-/Zeilen-Level-Merge); Feld B = eingebettete Live-Lagekarte (read-only)
- JSON-Export; **keine** server-autoritativen Felder → reine Client-CRDT-Writes (kein eigener Endpoint)
- **Ergebnis:** Alle drei Kern-Module vollständig.

### Phase-2-Ausbau — ✅ umgesetzt
Nach den drei Kern-Modulen ausgeliefert: Gefahren-Randfelder (Feld B), DWD-Regenradar + KONRAD3D
(inkl. Zell-Info per GetFeatureInfo), Kartenansicht-Persistenz pro Raum, Palette-Untermenüs (34 → 12),
Gesamt-Export (ZIP), DUG-Dateinamen, Chat-Auto-Scroll, **Arbeitsblatt-JSON-Import**, **Wetter-Rückseite**
(DWD/BrightSky, §10.5). Damit ist #42 (nur Wetter) abgeschlossen und #41 erledigt.

### M4 – Härtung & Ausbau — angelaufen
- ✅ **PDF-Export** (ETB + Arbeitsblatt, client-seitig via pdf-lib; §9.5/§10.4)
- ✅ **Gesamt-Export + Bundle-Import** als ZIP (§12, #71): Restore aller Module; ETB server-autoritativ
  (`/etb/import`), nur S-Rollen. ETB-Export dabei auf verlustfreies JSON umgestellt (CSV entfiel).
- ✅ **Rate-Limiting** (#64, §14): globales + strengeres Limit auf Join/Raum-Anlegen
- ✅ **Startseiten-Disclaimer** (#76): „kein primäres Einsatzmittel" in der Lobby
- ✅ **Fachliche Klärung** mit der Zielgruppe (#73): Auth schlank genügt (E3), ETB-Storno reicht (E2),
  Retention **4 Wochen** (E10) — Details in §14/§17
- ⏳ Offen: Retention/Löschkonzept umsetzen (#66) + Self-Service „Lage abschließen" (#75),
  Reverse-Proxy/TLS-Betrieb (#65), Offline-Robustheit (#70)
- ✅ **Test-Framework** (#72): Vitest (`pnpm test`) für reine Logik (Rollen/Rechte, Import-Coercion,
  `format`/`dug`, PDF-Umbruch), in CI eingehängt; `.mjs`-Smoke-Tests bleiben ergänzend.
  Ein UI-Happy-Path via Playwright ist als optionales Follow-up ausgegliedert.
- ⏳ Ausbaustufen: DV-102-Rotations-UI (#69), Live-Cursor, eigener Tile-Server
- ❌ Verworfen (per #73): Auth-Proxy/SSO als Pflicht (#67, optional bleibt möglich), Admin-Auth/-Portal (#68)

---

## 19. Vorgeschlagene Projektstruktur

Monorepo, gemeinsame Typen zwischen Client und Server (u. a. Rollen/Scopes, Modul-Datenmodelle):

```
lagekatse/
├── architecture.md                 ← dieses Dokument
├── docker-compose.yml
├── packages/
│   ├── shared/                      # gemeinsame TS-Typen (Roles, Scopes, Modul-Modelle)
│   │   └── src/{roles.ts, permissions.ts, models/*.ts}
│   ├── server/                      # Node.js Backend
│   │   └── src/
│   │       ├── http/                # Fastify-Routen (rooms, join, import/export)
│   │       ├── ws/                  # WS-Gateway + Rechte-Durchsetzung
│   │       ├── sync/                # Yjs-Dokumentverwaltung, Persistenz
│   │       └── db/                  # PostgreSQL-Zugriff, Migrationen
│   └── web/                         # React-SPA (Vite)
│       ├── public/taktische-zeichen/# vendorte DV-102-SVGs (CC0) + generierter index.json
│       ├── scripts/                 # build-symbol-index.mjs, e2e-Smoke-Tests
│       └── src/
│           ├── lobby/               # Frontpage, Raum anlegen/beitreten
│           ├── uebersicht/          # Modulauswahl + Chat + Online-Liste
│           ├── lagekarte/           # M1: Leaflet, Symbol-Palette, Flächen
│           ├── etb/                 # M2: Einsatztagebuch (Tabelle, autoritatives Anlegen)
│           │                        #   (später ergänzt um arbeitsblatt/)
│           └── sync/                # Yjs-Provider, Awareness-Bindung
└── README.md
```

---

*Ende des Konzepts v0.1 – Rückfragen und die mit ⚠️ markierten Punkte bitte vor Umsetzungsbeginn klären.*
