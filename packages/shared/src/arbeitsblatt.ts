/**
 * Data model for the Taktische Übersicht (module "arbeitsblatt") — die schlanke
 * Lage-Übersicht des Führungsstabs (architecture.md §10). Eine strukturierte Form
 * pro Stabsraum; alle Felder werden zwischen den Teilnehmenden synchronisiert.
 *
 * Der interne Modul-Identifier/Kanal bleibt bewusst `arbeitsblatt` (Persistenz,
 * Routen, WRITE_SCOPES) — nur die **UI-Beschriftung** ist „Taktische Übersicht".
 *
 * Unlike the ETB, the Übersicht has **no server-authoritative fields** (no
 * monotonic number, no server clock), so every field is a plain client CRDT
 * write — the server needs no special endpoint or seeding for it.
 *
 * Das `arbeitsblatt` Yjs-Dokument ist in mehrere *Top-Level*-Shared-Types geteilt.
 * Jeder auto-vivifiziert beim ersten `getMap`/`getArray` (kein Init-Schritt) und
 * konkurrierende Edits mergen auf Feld-/Zeilen-Ebene — nie Whole-Value wie die
 * Lagekarte (§8.3):
 *
 *   doc.getMap(AB_KOPF)           Feld A — Kopf-Skalare (AbKopf)
 *   doc.getArray(AB_AUFTRAEGE)    Feld D — Aufträge & Maßnahmen (Y.Map je AbAuftrag)
 *   doc.getArray(AB_RUECKMELD)    Feld E — Notizen (Y.Map je AbNotiz)
 *   doc.getMap(AB_ORGANISATION)   Feld F — Funkkanäle (AbOrganisation)
 *   doc.getMap(AB_WETTER)         Rückseite — Wetter-Snapshot (DWD/BrightSky, ein Whole-Value-Posten)
 *
 * Feld B (Lagebild) bettet die `lagekarte` read-only ein (§10.2) — die Karte bleibt
 * eine Referenz (eine Quelle der Wahrheit), sie hat keine eigenen Daten im Übersichts-Doc.
 * Feld C (Einheiten/Kräfteübersicht) ist rein **abgeleitet** aus dem `kraefteubersicht`-Modul
 * (read-only cross-module) — ebenfalls kein eigener Zustand hier.
 */

// ---- top-level shared-type keys inside the "arbeitsblatt" document ----
export const AB_KOPF = "kopf" as const;
export const AB_AUFTRAEGE = "auftraege" as const;
export const AB_RUECKMELD = "rueckmeldungen" as const;
export const AB_ORGANISATION = "organisation" as const;
export const AB_WETTER = "wetter" as const;

// ---- Feld A: Kopfzeile ----
export interface AbKopf {
  einsatzstichwort: string;
  einsatzort: string;
  meldender: string;
  objektnr: string;
  datumUhrzeitgruppe: string;
}

/** Header fields in display order; each is a scalar key on the AB_KOPF Y.Map. */
export const AB_KOPF_FIELDS = [
  "einsatzstichwort",
  "einsatzort",
  "meldender",
  "objektnr",
  "datumUhrzeitgruppe",
] as const;
export type AbKopfField = (typeof AB_KOPF_FIELDS)[number];

export const AB_KOPF_LABELS: Record<AbKopfField, string> = {
  einsatzstichwort: "Einsatzstichwort",
  einsatzort: "Einsatzort",
  meldender: "Meldender",
  objektnr: "Objekt-Nr.",
  datumUhrzeitgruppe: "Datum-Uhrzeit-Gruppe",
};

// ---- Feld D: Aufträge & Maßnahmen ----
/**
 * Eine Zeile der Aufträge-Tabelle (Feld D, ersetzt den früheren „Führungsvorgang").
 * Als Y.Map innerhalb AB_AUFTRAEGE gespeichert, damit konkurrierende Edits an
 * *verschiedenen* Zellen derselben Zeile mergen (wie ETB-Zeilen). `id` ist
 * client-vergeben via uid() — keine monotone Anforderung. `laufenderVorgang`
 * markiert einen offenen Vorgang, `erledigt` streicht die Zeile durch (Eintrag bleibt).
 */
export interface AbAuftrag {
  id: string;
  auftrag: string;
  massnahmen: string;
  laufenderVorgang: boolean;
  erledigt: boolean;
}

// ---- Feld E: Notizen ----
/**
 * Eine freie Notiz / Checklisten-Zeile (Feld E). Als Y.Map-Listeneintrag (nicht als
 * reiner String) modelliert, damit Einträge eine stabile id, ein `erledigt`-Flag
 * (Checkliste) und sauberen konkurrierenden Merge bekommen — konsistent mit den
 * Aufträge-Zeilen.
 */
export interface AbNotiz {
  id: string;
  text: string;
  erledigt: boolean;
}

// ---- Feld F: Organisation / Kommunikation (nur Funkkanäle) ----
/** Scalar part of Feld F, stored as keys on the AB_ORGANISATION Y.Map. */
export interface AbOrganisation {
  tmoGruppe: string; // Digitalfunk TMO (Netzbetrieb / Trunked Mode)
  fuehrungsKanal: string;
  dmoGruppe: string; // Digitalfunk DMO (Direktbetrieb / Direct Mode)
  gebFunk: string; // Gebäudefunk / Objektfunk
}

export const AB_KANAL_FIELDS = ["tmoGruppe", "fuehrungsKanal", "dmoGruppe", "gebFunk"] as const;
export type AbKanalField = (typeof AB_KANAL_FIELDS)[number];
export const AB_KANAL_LABELS: Record<AbKanalField, string> = {
  tmoGruppe: "TMO-Gruppe",
  fuehrungsKanal: "Führungskanal",
  dmoGruppe: "DMO-Gruppe",
  gebFunk: "Gebäudefunk",
};

// ---- Rückseite: Wetter (DWD OpenData via BrightSky) ----
/**
 * Wetter-Snapshot für die Kartenmitte des Lagebilds (#44 Teil 2 / Wetter-Teil #42).
 * **Geteilter** Übersichts-Zustand: ein schreibberechtigter Nutzer ruft ab, der
 * Snapshot landet im CRDT, alle (auch RO-Monitore) sehen dasselbe. Anders als die
 * feldweise gemergten Tabellen ist Wetter ein **atomarer Whole-Value-Posten** unter
 * genau einem Key (AB_WETTER_SNAPSHOT) — es wird nicht kollaborativ feldweise editiert,
 * sondern bei jedem Abruf komplett ersetzt. Quelle: BrightSky (DWD OpenData), CORS-offen.
 */
export const AB_WETTER_SNAPSHOT = "snapshot" as const;

/** Momentanwerte (BrightSky /current_weather; Wind/Niederschlag aus den _10-Feldern). */
export interface AbWetterCurrent {
  temperature: number | null; // °C
  windSpeed: number | null; // km/h (10-min-Mittel)
  windDirection: number | null; // Grad, aus der es weht
  windGust: number | null; // km/h (Spitzenböe, 10 min)
  precipitation: number | null; // mm (letzte 10 min)
  cloudCover: number | null; // %
  pressure: number | null; // hPa (auf Meereshöhe reduziert)
  humidity: number | null; // % relative Feuchte
  condition: string | null; // BrightSky-condition, z.B. "dry" | "rain" | "thunderstorm"
  icon: string | null; // BrightSky-icon-slug
}

/** Ein Vorhersage-Stundenwert (BrightSky /weather). */
export interface AbWetterForecastHour {
  time: string; // ISO-8601, Stundenbeginn
  temperature: number | null; // °C
  windSpeed: number | null; // km/h
  precipitation: number | null; // mm in der Stunde
  precipitationProbability: number | null; // %
  condition: string | null;
  icon: string | null;
}

/** CAP-Dringlichkeit einer DWD-Warnung (BrightSky /alerts), grob minor→extreme. */
export type AbWetterSeverity = "minor" | "moderate" | "severe" | "extreme" | null;

/** Eine aktive DWD-Warnung für den Standort. `id` ist der Dedup-Schlüssel. */
export interface AbWetterAlert {
  id: string;
  event: string | null; // event_de, z.B. "GEWITTER"
  severity: AbWetterSeverity;
  headline: string | null; // headline_de
  description: string | null; // description_de (ggf. gekürzt)
  onset: string | null; // ISO-8601 Beginn
  expires: string | null; // ISO-8601 Ende
}

export interface AbWetterSnapshot {
  fetchedAt: string; // ISO-8601 — wann abgerufen (Staleness/Anzeige)
  lat: number;
  lon: number;
  stationName: string | null; // nächstgelegene DWD-Station
  current: AbWetterCurrent;
  forecast: AbWetterForecastHour[]; // nächste ~4 Stunden ab fetchedAt
  alerts: AbWetterAlert[];
}

// ---- assembled snapshot (read back via toJSON for the JSON export) ----
/**
 * Die ganze Übersicht als einfaches Objekt — die Form, die beim Zurücklesen jedes
 * Top-Level-Types via toJSON() entsteht. Genutzt für JSON-Export/-Import (§10.4/§12).
 * Feld B (Lagebild) und Feld C (Kräfteübersicht) fließen NICHT ein: das Lagebild ist
 * eine read-only Referenz auf `lagekarte`, die Kräfte-Kennzahlen sind abgeleitet aus
 * `kraefteubersicht` — beide haben keine eigenen Daten in diesem Doc.
 */
export interface Arbeitsblatt {
  kopf: AbKopf;
  auftraege: AbAuftrag[];
  rueckmeldungen: AbNotiz[];
  organisation: AbOrganisation;
  wetter: AbWetterSnapshot | null; // Rückseite — null solange nie abgerufen
}

/** Envelope of the client-side JSON export (architecture.md §10.4 / §12). */
export const AB_EXPORT_FORMAT = "lagekatse.arbeitsblatt" as const;

/**
 * Export-Version. **2** seit dem Übersicht-Redesign (A–F). v1-Dateien (altes
 * Arbeitsblatt mit Gefahren/Führungsvorgang/eigene Lage/Organigramm) sind
 * strukturell inkompatibel und werden vom Import bewusst abgelehnt.
 */
export const AB_EXPORT_VERSION = 2 as const;

export interface ArbeitsblattExport {
  format: typeof AB_EXPORT_FORMAT;
  version: typeof AB_EXPORT_VERSION;
  exportedAt: string; // ISO-8601
  sheet: Arbeitsblatt;
}

// ---- Coercion-Helfer für den JSON-Import (rohe Werte aus Fremddateien absichern) ----
/**
 * Defensive Konvertierungen für unvertraute Eingaben (JSON-Import §10.4, Bundle-Import
 * #71). Bewusst hier in `shared` neben den Domänentypen, die sie erzeugen — so nutzbar
 * von Client **und** Server. Jede fällt auf einen sicheren Default zurück, statt zu
 * werfen: ein defektes Feld darf den Import nicht kippen.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
export function asBool(value: unknown): boolean {
  return value === true;
}
