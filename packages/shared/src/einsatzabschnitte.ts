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

/** Y.Array-Key innerhalb des "einsatzabschnitte"-Dokuments. */
export const EA_ABSCHNITTE = "abschnitte" as const;

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
