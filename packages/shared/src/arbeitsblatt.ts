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
 *   doc.getArray(AB_FUEHRUNG)    Feld C — Führungsvorgang rows (Y.Map per AbFuehrungszeile)
 *   doc.getArray(AB_RUECKMELD)   Feld D — Rückmeldungen/Notizen items (Y.Map per AbNotiz)
 *   doc.getMap(AB_EIGENELAGE)    Feld E — eigene Lage scalars + Auftrag flags (AbEigeneLage)
 *   doc.getArray(AB_NACHFORDERUNG) Feld E — freie Nachforderungs-Einträge (Y.Map per AbNachforderung)
 *   doc.getMap(AB_ORGANISATION)  Feld F — Funkkanäle + eigene Funktion scalars (AbOrganisation)
 *   doc.getArray(AB_ORGANIGRAMM) Feld F — Führungs-Organigramm rows (Y.Map per AbOrganigrammzeile)
 *
 * Feld B (Lagebild) carries no data of its own — it embeds the `lagekarte`
 * document read-only (§10.2), so there stays exactly one source of truth for
 * the Lage.
 */

// ---- top-level shared-type keys inside the "arbeitsblatt" document ----
export const AB_KOPF = "kopf" as const;
export const AB_FUEHRUNG = "fuehrungsvorgang" as const;
export const AB_RUECKMELD = "rueckmeldungen" as const;
export const AB_EIGENELAGE = "eigeneLage" as const;
export const AB_NACHFORDERUNG = "nachforderung" as const;
export const AB_ORGANISATION = "organisation" as const;
export const AB_ORGANIGRAMM = "organigramm" as const;

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

// ---- assembled snapshot (read back via toJSON for the JSON export) ----
/**
 * The whole worksheet as a plain object — the shape produced by reading every
 * top-level type back with toJSON(). Used for the JSON export (§10.4) and, later,
 * import. Feld B (Lagebild) is intentionally absent: it is a read-only reference
 * to the `lagekarte` document, not worksheet-owned data.
 */
export interface Arbeitsblatt {
  kopf: AbKopf;
  fuehrungsvorgang: AbFuehrungszeile[];
  rueckmeldungen: AbNotiz[];
  eigeneLage: AbEigeneLage;
  nachforderung: AbNachforderung[];
  organisation: AbOrganisation;
  organigramm: AbOrganigrammzeile[];
}

/** Envelope of the client-side JSON export (architecture.md §10.4 / §12). */
export const AB_EXPORT_FORMAT = "lagekatse.arbeitsblatt" as const;

export interface ArbeitsblattExport {
  format: typeof AB_EXPORT_FORMAT;
  version: 1;
  exportedAt: string; // ISO-8601
  sheet: Arbeitsblatt;
}
