/**
 * Data model for the Einsatztagebuch (ETB, module "etb") — a collaborative,
 * tabular incident log (architecture.md §9).
 *
 * The `etb` Yjs document holds one Y.Array named ETB_ENTRIES; each element is a
 * *Y.Map* (not a plain object) carrying the fields of one LogEntry. Storing each
 * entry as a Y.Map — rather than whole-value LWW like the Lagekarte — lets two
 * people edit *different* columns of the same row concurrently without clobbering
 * each other; only edits to the *same* field are last-write-wins.
 *
 * `id`, `lfdNr` and the initial `zeit` are assigned *authoritatively by the
 * server* when an entry is created (POST /api/rooms/:code/etb/entries) — never by
 * the client — so the running number stays monotonic and gapless and the initial
 * timestamp is the server clock, not a client's wall clock. Everything else
 * (including a later correction to `zeit`) is a normal client CRDT write.
 */

/** Y.Array key inside the "etb" document. */
export const ETB_ENTRIES = "entries" as const;

/** Communication direction. "E" = Eingang, "A" = Ausgang, "" = not yet set. */
export type EtbRichtung = "E" | "A" | "";

/** Transmission channel of a message. "" = not yet set. */
export type EtbWeg = "Funk" | "Telefon" | "Fax" | "persönlich" | "E-Mail" | "";

/**
 * One incident-log entry (§9.3). Stored as a Y.Map inside the ETB_ENTRIES array;
 * this interface is the plain-object shape (as read back from the Y.Map, and as
 * used for CSV export).
 */
export interface LogEntry {
  id: string; // uid() — stable id (NOT crypto.randomUUID: app runs over http/LAN)
  lfdNr: number; // server-assigned, monotonic + gapless
  zeit: string; // ISO-8601; server time on create, editable afterwards
  richtung: EtbRichtung;
  von: string; // sender / reporter
  an: string; // recipient
  weg: EtbWeg;
  inhalt: string; // message / event
  veranlassung: string; // measure / order taken
  erledigt: boolean;
  bearbeiter: string; // handling sign; prefilled with the author's display name
  /**
   * #237: ISO-Zeit der letzten Inhalts-Bearbeitung (Client-Uhr). Dient der
   * Soft-Sperre: Inhaltsspalten werden `ETB_LOCK_MS` nach der letzten Änderung
   * read-only (s. isEtbEntryLocked). Synct über das CRDT (nicht client-lokal!),
   * damit auch neu gejointe Clients dieselbe Sperre sehen. Fehlt bei Alt-Einträgen.
   */
  lastEditedAt?: string;
  /**
   * #226: vom System erzeugter Eintrag (Kräftebewegung, EA-Übernahme, Wetter-/
   * Pegel-/Abschluss-Eintrag) statt manuell im ETB getippt. Rein visuell (kursiv);
   * fehlt bei Alt-Einträgen → gilt als manuell.
   */
  auto?: boolean;
  /**
   * §9.4: entries are *cancelled*, not deleted — this keeps the lfdNr chain
   * gapless. A cancelled entry stays visible (struck through) and in exports.
   */
  storniert?: boolean;
  // Deferred (§9.4, mit Zielgruppe abzustimmen): a per-field change trail
  // (wer/wann/was), shown in the export. Not part of v1.
}

/**
 * Fields a client may edit directly via Y.Map.set on the entry. The server owns
 * `id` and `lfdNr`; `zeit` is server-set on create but client-editable after.
 */
export type EtbEditableField = Exclude<keyof LogEntry, "id" | "lfdNr">;

/**
 * Optional initial values a client may pass when creating an entry. The server
 * always sets id, lfdNr, zeit and bearbeiter (from the session); anything here
 * just pre-fills the new row. Kept intentionally small — the row is normally
 * filled in inline after it appears.
 */
export type NewEtbEntryInput = Partial<
  Pick<LogEntry, "richtung" | "von" | "an" | "weg" | "inhalt" | "veranlassung" | "auto">
>;

/**
 * #237: Inhaltsspalten, die der Soft-Sperre unterliegen und deren Bearbeitung die
 * Sperr-Frist neu startet. `erledigt`/`storniert`/`bearbeiter` gehören bewusst NICHT
 * dazu — Storno/Erledigt bleiben auch nach der Sperre nutzbar.
 */
export const ETB_CONTENT_FIELDS = [
  "zeit",
  "richtung",
  "von",
  "an",
  "weg",
  "inhalt",
  "veranlassung",
] as const;

/**
 * #237: Frist, nach der ein ETB-Eintrag ohne weitere Bearbeitung als „fertig
 * geschrieben" gilt und die Inhaltsspalten (client-seitig) read-only werden.
 * Bewusst (noch) nicht konfigurierbar.
 */
export const ETB_LOCK_MS = 2 * 60 * 1000;

/**
 * Ist der Eintrag für Inhalts-Edits gesperrt (#237)? Rein & testbar — `nowMs` reicht
 * der Aufrufer (lokale Uhr). Auto-Einträge (#226) sind sofort gesperrt (System-Text);
 * sonst greift die Sperre `windowMs` nach der letzten Bearbeitung (`lastEditedAt`,
 * Fallback Anlagezeit `zeit`). Unparsebare Zeit → nicht sperren (defensiv).
 */
export function isEtbEntryLocked(
  entry: Pick<LogEntry, "zeit" | "lastEditedAt" | "auto">,
  nowMs: number,
  windowMs: number = ETB_LOCK_MS,
): boolean {
  if (entry.auto) return true;
  const t = Date.parse(entry.lastEditedAt || entry.zeit);
  if (Number.isNaN(t)) return false;
  return nowMs - t > windowMs;
}

/**
 * Envelope of the ETB export (Teil des Stabsraum-Bundles, architecture.md §12).
 * Verlustfrei — anders als der frühere CSV-Export trägt es `id`/`lfdNr`/`zeit`
 * und `storniert` originalgetreu, damit der Bundle-Import den ETB server-autoritativ
 * (Invariante #6) wiederherstellen kann.
 */
export const ETB_EXPORT_FORMAT = "lagekatse.etb" as const;

export interface EtbExport {
  format: typeof ETB_EXPORT_FORMAT;
  version: 1;
  exportedAt: string; // ISO-8601
  entries: LogEntry[];
}
