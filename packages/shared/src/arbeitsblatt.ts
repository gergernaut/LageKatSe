/**
 * Data model for the Taktisches Arbeitsblatt (module "arbeitsblatt") — the
 * digital IdF-NRW tactical worksheet (architecture.md §10). One structured form
 * per Stabsraum; all fields are synchronised between the participants.
 *
 * Unlike the ETB, the Arbeitsblatt has **no server-authoritative fields** (no
 * monotonic number, no server clock), so every field is a plain client CRDT
 * write — the server needs no special endpoint or seeding for it.
 *
 * The `arbeitsblatt` Yjs document is split into several *top-level* shared
 * types. Each auto-vivifies on first `getMap`/`getArray` (so there is no init
 * step) and concurrent edits merge at field / row level — never whole-value
 * like the Lagekarte (§8.3):
 *
 *   doc.getMap(AB_KOPF)          Feld A — header scalars (AbKopf)
 *   doc.getMap(AB_GEFAHREN)      Feld B — Randfelder für Gefahren (Y.Map key -> AbGefahr)
 *   doc.getArray(AB_FUEHRUNG)    Feld C — Führungsvorgang rows (Y.Map per AbFuehrungszeile)
 *   doc.getArray(AB_RUECKMELD)   Feld D — Rückmeldungen/Notizen items (Y.Map per AbNotiz)
 *   doc.getMap(AB_EIGENELAGE)    Feld E — eigene Lage scalars + Auftrag flags (AbEigeneLage)
 *   doc.getArray(AB_NACHFORDERUNG) Feld E — freie Nachforderungs-Einträge (Y.Map per AbNachforderung)
 *   doc.getMap(AB_ORGANISATION)  Feld F — Funkkanäle + eigene Funktion scalars (AbOrganisation)
 *   doc.getArray(AB_ORGANIGRAMM) Feld F — Führungs-Organigramm rows (Y.Map per AbOrganigrammzeile)
 *   doc.getMap(AB_WETTER)        Rückseite — Wetter-Snapshot (DWD/BrightSky, ein Whole-Value-Posten)
 *
 * Feld B (Lagebild) bettet die `lagekarte` read-only ein (§10.2) — die Karte
 * bleibt eine Referenz (eine Quelle der Wahrheit); die Gefahren-Randfelder
 * (`gefahren`) sind die einzigen eigenen Daten von Feld B.
 */

// ---- top-level shared-type keys inside the "arbeitsblatt" document ----
export const AB_KOPF = "kopf" as const;
export const AB_FUEHRUNG = "fuehrungsvorgang" as const;
export const AB_RUECKMELD = "rueckmeldungen" as const;
export const AB_EIGENELAGE = "eigeneLage" as const;
export const AB_NACHFORDERUNG = "nachforderung" as const;
export const AB_ORGANISATION = "organisation" as const;
export const AB_ORGANIGRAMM = "organigramm" as const;
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

// ---- Feld C: Führungsvorgang ----
/** Priority 1 (highest) … 3, or "" when not yet set. */
export type AbPrioritaet = 1 | 2 | 3 | "";

/**
 * One row of the Führungsvorgang table. Stored as a Y.Map inside AB_FUEHRUNG so
 * concurrent edits to *different* cells of the same row merge (like ETB rows).
 * `id` is client-assigned via uid() — there is no monotonic requirement here.
 */
export interface AbFuehrungszeile {
  id: string;
  bedrohtesObjekt: string; // bedrohtes Objekt / Subjekt
  wirkung: string;
  prioritaet: AbPrioritaet;
  massnahmen: string;
  erledigt: boolean;
}

// ---- Feld D: Rückmeldungen / Notizen ----
/**
 * One free note / checklist item (Feld D). Modelled as a Y.Map list item (not a
 * plain string line) so items get a stable id, an `erledigt` flag (checklist)
 * and clean concurrent merge — consistent with the Führungsvorgang rows.
 */
export interface AbNotiz {
  id: string;
  text: string;
  erledigt: boolean;
}

// ---- Feld E: eigene Lage / Nachforderung ----
/**
 * Scalar part of Feld E, stored as keys on the AB_EIGENELAGE Y.Map. `auftragMr`
 * (Menschenrettung) and `auftragBb` (Brandbekämpfung) are the two standard
 * order flags; `kraefteuebersicht` holds the Zugstärke notation, e.g. "3/1/12/16".
 */
export interface AbEigeneLage {
  auftragMr: boolean;
  auftragBb: boolean;
  auftragText: string;
  kraefteuebersicht: string;
}

export const AB_EIGENELAGE_FLAG_FIELDS = ["auftragMr", "auftragBb"] as const;
export type AbEigeneLageFlagField = (typeof AB_EIGENELAGE_FLAG_FIELDS)[number];
export const AB_EIGENELAGE_TEXT_FIELDS = ["auftragText", "kraefteuebersicht"] as const;
export type AbEigeneLageTextField = (typeof AB_EIGENELAGE_TEXT_FIELDS)[number];

/**
 * One reinforcement (Nachforderung) request as a *free-text* entry, e.g.
 * "2 Löschzüge" or "Rettungsdienst, 3 RTW". Stored as a Y.Map list item inside
 * the AB_NACHFORDERUNG Y.Array so entries can be added/removed freely and merge
 * per row (like the Führungsvorgang/Rückmeldungen rows) — no fixed categories.
 */
export interface AbNachforderung {
  id: string;
  text: string;
}

// ---- Feld F: Organisation / Kommunikation ----
/** Eigene Führungsfunktion: Gruppen-, Zug- oder Verbandsführer (or "" unset). */
export type AbFunktion = "GF" | "ZF" | "VF" | "";

/** Scalar part of Feld F, stored as keys on the AB_ORGANISATION Y.Map. */
export interface AbOrganisation {
  tmoGruppe: string; // Digitalfunk TMO (Netzbetrieb / Trunked Mode)
  fuehrungsKanal: string;
  dmoGruppe: string; // Digitalfunk DMO (Direktbetrieb / Direct Mode)
  gebFunk: string; // Gebäudefunk / Objektfunk
  eigeneFunktion: AbFunktion;
}

export const AB_KANAL_FIELDS = ["tmoGruppe", "fuehrungsKanal", "dmoGruppe", "gebFunk"] as const;
export type AbKanalField = (typeof AB_KANAL_FIELDS)[number];
export const AB_KANAL_LABELS: Record<AbKanalField, string> = {
  tmoGruppe: "TMO-Gruppe",
  fuehrungsKanal: "Führungskanal",
  dmoGruppe: "DMO-Gruppe",
  gebFunk: "Gebäudefunk",
};

/**
 * One row of the Führungs-Organigramm (Feld F). Y.Map list item inside
 * AB_ORGANIGRAMM, same merge semantics as the Führungsvorgang rows.
 */
export interface AbOrganigrammzeile {
  id: string;
  rolle: string;
  auftrag: string;
  fuehrer: string;
  rufname: string;
}

// ---- Feld B: Randfelder für Gefahren (Gefahrenmatrix) ----
/**
 * Die „neun Gefahren der Einsatzstelle" (Feuerwehr-Merkschema 4 A – 1 C – 4 E),
 * neben der eingebetteten Lagekarte in Feld B beurteilt (§10.1/§10.2). Feste,
 * geordnete Liste — jede Gefahr ein Key auf der AB_GEFAHREN Y.Map mit einem kleinen
 * Whole-Value-Posten {betroffen, notiz?}. **Geteilter** Arbeitsblatt-Zustand (im
 * CRDT), KEINE client-lokale Anzeige-Option (anders als Symbolgröße, Invariante #4).
 */
export const AB_GEFAHREN = "gefahren" as const;

/** Gruppe im 4-A-1-C-4-E-Schema (nur zur optischen Gruppierung). */
export type AbGefahrGruppe = "A" | "C" | "E";

/** Fester Katalog der neun Gefahren, in Anzeigereihenfolge (4 A · 1 C · 4 E). */
export const AB_GEFAHREN_KATALOG = [
  { key: "atemgifte", gruppe: "A", label: "Atemgifte" },
  { key: "angstreaktion", gruppe: "A", label: "Angstreaktion" },
  { key: "ausbreitung", gruppe: "A", label: "Ausbreitung" },
  { key: "atomar", gruppe: "A", label: "Atomare Gefahren" },
  { key: "chemisch", gruppe: "C", label: "Chemische Stoffe" },
  { key: "erkrankung", gruppe: "E", label: "Erkrankung / Verletzung" },
  { key: "explosion", gruppe: "E", label: "Explosion" },
  { key: "einsturz", gruppe: "E", label: "Einsturz" },
  { key: "elektrizitaet", gruppe: "E", label: "Elektrizität" },
] as const;

export type AbGefahrKey = (typeof AB_GEFAHREN_KATALOG)[number]["key"];

/** Ein Gefahren-Randfeld: an der Einsatzstelle betroffen? plus optionale Kurznotiz. */
export interface AbGefahr {
  betroffen: boolean;
  notiz?: string;
}

// ---- Rückseite: Wetter (DWD OpenData via BrightSky) ----
/**
 * Wetter-Snapshot für die Kartenmitte des Lagebilds (#44 Teil 2 / Wetter-Teil #42).
 * **Geteilter** Arbeitsblatt-Zustand: ein schreibberechtigter Nutzer ruft ab, der
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
 * The whole worksheet as a plain object — the shape produced by reading every
 * top-level type back with toJSON(). Used for the JSON export (§10.4) and, later,
 * import. Von Feld B fließen nur die Gefahren-Randfelder (`gefahren`) ein; das
 * Lagebild selbst ist eine read-only Referenz auf `lagekarte`, keine eigenen Daten.
 */
export interface Arbeitsblatt {
  kopf: AbKopf;
  gefahren: Partial<Record<AbGefahrKey, AbGefahr>>;
  fuehrungsvorgang: AbFuehrungszeile[];
  rueckmeldungen: AbNotiz[];
  eigeneLage: AbEigeneLage;
  nachforderung: AbNachforderung[];
  organisation: AbOrganisation;
  organigramm: AbOrganigrammzeile[];
  wetter: AbWetterSnapshot | null; // Rückseite — null solange nie abgerufen
}

/** Envelope of the client-side JSON export (architecture.md §10.4 / §12). */
export const AB_EXPORT_FORMAT = "lagekatse.arbeitsblatt" as const;

export interface ArbeitsblattExport {
  format: typeof AB_EXPORT_FORMAT;
  version: 1;
  exportedAt: string; // ISO-8601
  sheet: Arbeitsblatt;
}
