/**
 * Data model for the Einsatzabschnitte module (#133) — Einsatzabschnitte (EA) und
 * Unterabschnitte (UA) im Stil der taktischen Arbeitstafel des IdF NRW. Wie die
 * Kräfteübersicht und die Taktische Übersicht (und anders als das ETB) hat das Modul
 * **keine server-autoritativen Felder** — jede Zeile ist ein reiner Client-CRDT-Write,
 * der Server braucht kein Seeding und keinen eigenen Endpoint.
 *
 * Das Dokument hält eine Y.Array `EA_ABSCHNITTE`; jedes Element ist eine Y.Map (ein
 * Abschnitt), sodass zwei Personen *verschiedene* Felder desselben Abschnitts
 * konkurrierend editieren können (Feld-Level-Merge, wie ETB-/Kräfte-Zeilen).
 *
 * Die **Zuordnung von Fahrzeugen** zu einem Abschnitt wird NICHT hier gespeichert,
 * sondern als `einsatzabschnittId` am Fahrzeug im `kraefteubersicht`-Dokument
 * (ein Fahrzeug ↔ höchstens ein Abschnitt, ein merge-sicherer Feld-Write). Dieses
 * Modul und die Taktische Übersicht leiten die Stärke je Abschnitt **read-only** aus
 * dem kraefteubersicht-Dokument ab (gleiches Muster wie die Kräfte-Kennzahlen in Feld C).
 */
import { asString, isRecord } from "./arbeitsblatt";
import { sumStaerke, type KraftVehicle, type Staerke } from "./kraefteubersicht";

/** Y.Array-Key innerhalb des "einsatzabschnitte"-Dokuments. */
export const EA_ABSCHNITTE = "abschnitte" as const;

/**
 * Singleton „Führung" (#154): die eigene Führungsstelle über den Abschnitten.
 * Liegt als **eine** Y.Map unter diesem Key im selben Dokument (kein Array — es
 * gibt genau eine). Derselbe Wert dient als reservierte `einsatzabschnittId` am
 * Fahrzeug, um ein Führungsmittel der Führung zuzuordnen (uid() erzeugt diesen
 * Wert nie, also keine Kollision mit einem echten Abschnitt).
 */
export const EA_FUEHRUNG = "fuehrung" as const;

/** Die eigene Führungsstelle (Führer + Befehlsstelle + Kommunikation + Standort). */
export interface Fuehrung {
  fuehrer: string;
  befehlsstelle: string;
  kommunikation: string;
  standort: string;
}

export const FUEHRUNG_FIELDS = ["fuehrer", "befehlsstelle", "kommunikation", "standort"] as const;
export type FuehrungField = (typeof FUEHRUNG_FIELDS)[number];

export const FUEHRUNG_LABELS: Record<FuehrungField, string> = {
  fuehrer: "Führer",
  befehlsstelle: "Befehlsstelle",
  kommunikation: "Kommunikation",
  standort: "Standort",
};

export const EMPTY_FUEHRUNG: Fuehrung = {
  fuehrer: "",
  befehlsstelle: "",
  kommunikation: "",
  standort: "",
};

/** Defensive Coercion des Führungs-Singletons (fehlende/defekte Felder → ""). */
export function coerceFuehrung(value: unknown): Fuehrung {
  const r: Record<string, unknown> = isRecord(value) ? value : {};
  return {
    fuehrer: asString(r.fuehrer),
    befehlsstelle: asString(r.befehlsstelle),
    kommunikation: asString(r.kommunikation),
    standort: asString(r.standort),
  };
}

/** Einsatzabschnitt (EA) oder Unterabschnitt (UA). */
export const EA_TYPEN = ["EA", "UA"] as const;
export type EaTyp = (typeof EA_TYPEN)[number];

/**
 * Ein Einsatzabschnitt/Unterabschnitt. Als Y.Map in EA_ABSCHNITTE; `id` via uid()
 * (kein crypto.randomUUID, Invariante #3). `einsatzbeginn` ist eine DUG-Zeichenkette
 * (bei Anlage vorbelegt, frei editierbar). Die Kräfte-/Fahrzeug-Summen sind NICHT
 * gespeichert, sondern werden aus den zugeordneten Fahrzeugen abgeleitet.
 */
export interface Einsatzabschnitt {
  id: string;
  typ: EaTyp;
  titel: string;
  befehlsstelle: string;
  leiter: string;
  kommunikation: string;
  auftrag: string;
  einsatzbeginn: string; // DUG (dug()), bei Anlage vorbelegt
  createdAt: string; // ISO-8601
}

/** Felder, die ein Client direkt via Y.Map.set editiert (alles außer der id). */
export type EaEditableField = Exclude<keyof Einsatzabschnitt, "id">;

/** Abschnittstyp; alles außer "UA" fällt auf "EA" (der Regelfall). */
export function asEaTyp(value: unknown): EaTyp {
  return value === "UA" ? "UA" : "EA";
}

/** Anzeigetitel „EA A" / „UA B1" (Typ + Titel), z. B. für die Taktische Übersicht. */
export function formatAbschnittTitel(a: Pick<Einsatzabschnitt, "typ" | "titel">): string {
  return `${a.typ} ${a.titel}`.trim();
}

/* ---- Kräfte-Ableitung je Abschnitt (read-only aus dem kraefteubersicht-Doc) ----
 * Die Zuordnung lebt als `einsatzabschnittId` am Fahrzeug; nur Fahrzeuge „im
 * Einsatz" zählen. Rein & testbar — genutzt vom Einsatzabschnitte-Modul UND von
 * Feld C der Taktischen Übersicht, damit beide dieselben Zahlen zeigen (#138/#140). */

/** Fahrzeuge im Einsatz, die diesem Abschnitt zugeordnet sind. */
export function vehiclesInAbschnitt(
  vehicles: readonly KraftVehicle[],
  abschnittId: string,
): KraftVehicle[] {
  return vehicles.filter((v) => v.status === "einsatz" && v.einsatzabschnittId === abschnittId);
}

/** Fahrzeuge im Einsatz ohne Abschnitts-Zuordnung (Kandidaten für „Fzg. zuordnen"). */
export function unassignedEinsatzVehicles(vehicles: readonly KraftVehicle[]): KraftVehicle[] {
  return vehicles.filter((v) => v.status === "einsatz" && !v.einsatzabschnittId);
}

/** Abgeleitete Stärke + Fahrzeug-Anzahl eines Abschnitts. */
export interface AbschnittKraft {
  staerke: Staerke;
  count: number;
}

/** Stärke (Summe) und Fahrzeug-Anzahl der einem Abschnitt zugeordneten Einsatzkräfte. */
export function abschnittKraft(
  vehicles: readonly KraftVehicle[],
  abschnittId: string,
): AbschnittKraft {
  const assigned = vehiclesInAbschnitt(vehicles, abschnittId);
  return { staerke: sumStaerke(assigned), count: assigned.length };
}

/** Defensive Coercion einer Fremd-Zeile in einen gültigen Einsatzabschnitt. */
export function coerceEinsatzabschnitt(value: unknown, fallbackId: () => string): Einsatzabschnitt {
  const r: Record<string, unknown> = isRecord(value) ? value : {};
  return {
    id: asString(r.id) || fallbackId(),
    typ: asEaTyp(r.typ),
    titel: asString(r.titel),
    befehlsstelle: asString(r.befehlsstelle),
    leiter: asString(r.leiter),
    kommunikation: asString(r.kommunikation),
    auftrag: asString(r.auftrag),
    einsatzbeginn: asString(r.einsatzbeginn),
    createdAt: asString(r.createdAt),
  };
}

/* ---- Export/Import-Envelope (Teil des Stabsraum-Bundles, #139) ---- */
export const EA_EXPORT_FORMAT = "lagekatse.einsatzabschnitte" as const;

export interface EinsatzabschnitteExport {
  format: typeof EA_EXPORT_FORMAT;
  version: 1;
  exportedAt: string; // ISO-8601
  abschnitte: Einsatzabschnitt[];
  fuehrung?: Fuehrung; // #154 — optional (ältere Exporte ohne bleiben gültig)
}

/**
 * Liest den Führungs-Singleton aus einem Export-Envelope (defensiv). Fehlt er
 * (ältere Datei), kommt eine leere Führung zurück — nie ein Fehler.
 */
export function parseFuehrungExport(payload: unknown): Fuehrung {
  return coerceFuehrung(isRecord(payload) ? payload.fuehrung : undefined);
}

/**
 * Prüft den Export-Envelope und coerct die Zeilen. `null` = ungültiges Dateiformat;
 * sonst die (defensiv bereinigten) Abschnitte. `fallbackId` vergibt eine id für
 * Zeilen ohne eigene. IDs werden bewusst erhalten, damit die Fahrzeug-Zuordnung
 * (`einsatzabschnittId` im kraefteubersicht-Export) nach dem Import weiter passt.
 */
export function parseEinsatzabschnitteExport(
  payload: unknown,
  fallbackId: () => string,
): Einsatzabschnitt[] | null {
  if (!isRecord(payload) || payload.format !== EA_EXPORT_FORMAT || !Array.isArray(payload.abschnitte)) {
    return null;
  }
  return payload.abschnitte.map((a) => coerceEinsatzabschnitt(a, fallbackId));
}
