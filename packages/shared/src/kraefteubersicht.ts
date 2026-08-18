/**
 * Data model for the Kräfteübersicht (module "kraefteubersicht", #100) — a
 * collaborative forces overview: which vehicles/units are staged in the
 * Bereitstellungsraum (BR) and which are currently deployed (Im Einsatz).
 *
 * Like the Arbeitsblatt — and unlike the ETB — it has NO server-authoritative
 * fields (no monotonic number, no server clock), so every row is a plain client
 * CRDT write and the server needs no special seeding. The ONE server touch point
 * is the ETB side-effect: moving/releasing a vehicle writes an ETB entry
 * server-authoritatively (Invariante #6) via POST /api/rooms/:code/kraft/etb-log,
 * so the lfdNr chain stays gapless. That route is gated by *kraefteubersicht*
 * write rights (not etb), so a Lagekartenführer moving forces can still log.
 *
 * The document holds one Y.Array named KRAFT_VEHICLES; each element is a Y.Map
 * (one vehicle row) so two people can edit *different* columns of the same
 * vehicle concurrently (field-level merge, like ETB rows). The two tables
 * (Bereitstellungsraum / Im Einsatz) are a filtered VIEW over the single list
 * via the `status` field — "moving" is a single field write, which is merge-safe
 * (no cross-array transfer that could duplicate or drop a row under concurrency).
 */
import { asString, isRecord } from "./arbeitsblatt";

/** Y.Array key inside the "kraefteubersicht" document. */
export const KRAFT_VEHICLES = "vehicles" as const;

/** Trägerorganisation. Erweiterbar; deckt die im KatS üblichen Träger ab (#100). */
export const KRAFT_ORGS = ["FW", "RD", "HiOrg", "THW", "Polizei", "Sonstige"] as const;
export type KraftOrg = (typeof KRAFT_ORGS)[number];

export const KRAFT_ORG_LABELS: Record<KraftOrg, string> = {
  FW: "Feuerwehr",
  RD: "Rettungsdienst",
  HiOrg: "Hilfsorganisation",
  THW: "THW",
  Polizei: "Polizei",
  Sonstige: "Sonstige",
};

/** In welcher Tabelle das Fahrzeug steht. */
export const KRAFT_STATUS = ["br", "einsatz"] as const;
export type KraftStatus = (typeof KRAFT_STATUS)[number];

export const KRAFT_STATUS_LABELS: Record<KraftStatus, string> = {
  br: "Bereitstellungsraum",
  einsatz: "Im Einsatz",
};

/**
 * One vehicle/unit row. Stored as a Y.Map inside KRAFT_VEHICLES. The DV-100
 * strength is stored as its three components; the total is always *derived*
 * (never stored), so it cannot drift out of sync with the parts.
 */
export interface KraftVehicle {
  id: string; // uid() — kein crypto.randomUUID (http/LAN, Invariante #3)
  org: KraftOrg;
  typ: string; // Fahrzeugtyp, Freitext
  funkrufname: string;
  fuehrer: number; // DV 100: Führer
  unterfuehrer: number; // DV 100: Unterführer
  helfer: number; // DV 100: Helfer
  status: KraftStatus;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

/** Fields a client edits directly via Y.Map.set (everything but the id). */
export type KraftEditableField = Exclude<keyof KraftVehicle, "id">;

/** DV-100 strength triple plus derived total. */
export interface Staerke {
  fuehrer: number;
  unterfuehrer: number;
  helfer: number;
  gesamt: number;
}

type StaerkeParts = Pick<KraftVehicle, "fuehrer" | "unterfuehrer" | "helfer">;

/** Non-negative integer coercion (defensiv: NaN/negativ/Kommazahl → 0/abgerundet). */
export function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function asKraftOrg(value: unknown): KraftOrg {
  return (KRAFT_ORGS as readonly string[]).includes(value as string) ? (value as KraftOrg) : "Sonstige";
}

export function asKraftStatus(value: unknown): KraftStatus {
  return value === "einsatz" ? "einsatz" : "br";
}

/** Stärke eines einzelnen Fahrzeugs (Gesamt = Summe der drei Anteile). */
export function vehicleStaerke(v: StaerkeParts): Staerke {
  const fuehrer = asCount(v.fuehrer);
  const unterfuehrer = asCount(v.unterfuehrer);
  const helfer = asCount(v.helfer);
  return { fuehrer, unterfuehrer, helfer, gesamt: fuehrer + unterfuehrer + helfer };
}

/** Anteilsweise Summe über mehrere Fahrzeuge (die Übersichtskarte). */
export function sumStaerke(vehicles: readonly StaerkeParts[]): Staerke {
  return vehicles.reduce<Staerke>(
    (acc, v) => {
      const s = vehicleStaerke(v);
      return {
        fuehrer: acc.fuehrer + s.fuehrer,
        unterfuehrer: acc.unterfuehrer + s.unterfuehrer,
        helfer: acc.helfer + s.helfer,
        gesamt: acc.gesamt + s.gesamt,
      };
    },
    { fuehrer: 0, unterfuehrer: 0, helfer: 0, gesamt: 0 },
  );
}

/** DV-100-Schreibweise "Führer/Unterführer/Helfer//Gesamt", z. B. "1/2/9//12". */
export function formatStaerke(s: Staerke): string {
  return `${s.fuehrer}/${s.unterfuehrer}/${s.helfer}//${s.gesamt}`;
}

/** Anzahl Fahrzeuge je Fahrzeugtyp (Tooltip-Aufschlüsselung der Übersichtskarte). */
export function countByTyp(vehicles: readonly Pick<KraftVehicle, "typ">[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of vehicles) {
    const typ = (typeof v.typ === "string" ? v.typ.trim() : "") || "ohne Typ";
    out[typ] = (out[typ] ?? 0) + 1;
  }
  return out;
}

/* ---- ETB-Protokolltext für Kräftebewegungen (server-autoritativ geloggt) ---- */

export type KraftEtbAction = "toEinsatz" | "toBr" | "entlassen";

/**
 * Baut den ETB-Eintragstext für eine Kräftebewegung. Rein & testbar; der Aufruf
 * baut den Text VOR der Mutation (beim Entlassen ist `vehicle.status` daher noch
 * die Ursprungstabelle).
 */
export function buildKraftEtbText(vehicle: KraftVehicle, action: KraftEtbAction): string {
  const org = KRAFT_ORG_LABELS[vehicle.org] ?? vehicle.org;
  const name = vehicle.funkrufname.trim() || "(ohne Funkrufname)";
  const typ = vehicle.typ.trim();
  const staerke = formatStaerke(vehicleStaerke(vehicle));
  const bezeichnung = `${name} (${org}${typ ? `, ${typ}` : ""}) — Stärke ${staerke}`;
  switch (action) {
    case "toEinsatz":
      return `Kräfte in den Einsatz: ${bezeichnung}`;
    case "toBr":
      return `Kräfte zurück in den Bereitstellungsraum: ${bezeichnung}`;
    case "entlassen":
      return `Kräfte entlassen (aus ${KRAFT_STATUS_LABELS[vehicle.status]}): ${bezeichnung}`;
  }
}

/* ---- Export/Import-Envelope (Teil des Stabsraum-Bundles, #71) ---- */

export const KRAFT_EXPORT_FORMAT = "lagekatse.kraefteubersicht" as const;

export interface KraftExport {
  format: typeof KRAFT_EXPORT_FORMAT;
  version: 1;
  exportedAt: string; // ISO-8601
  vehicles: KraftVehicle[];
}

/** Defensive Coercion einer Fremd-Zeile in eine gültige KraftVehicle. */
export function coerceVehicle(value: unknown, fallbackId: () => string): KraftVehicle {
  const r: Record<string, unknown> = isRecord(value) ? value : {};
  const created = asString(r.createdAt) || asString(r.updatedAt);
  return {
    id: asString(r.id) || fallbackId(),
    org: asKraftOrg(r.org),
    typ: asString(r.typ),
    funkrufname: asString(r.funkrufname),
    fuehrer: asCount(r.fuehrer),
    unterfuehrer: asCount(r.unterfuehrer),
    helfer: asCount(r.helfer),
    status: asKraftStatus(r.status),
    createdAt: created,
    updatedAt: asString(r.updatedAt) || created,
  };
}

/**
 * Prüft den Export-Envelope und coerct die Zeilen. `null` = ungültiges
 * Dateiformat; sonst die (defensiv bereinigten) Fahrzeuge. `fallbackId` vergibt
 * eine id für Zeilen ohne eigene (der Aufrufer reicht `uid` bzw. einen Zähler).
 */
export function parseKraftExport(payload: unknown, fallbackId: () => string): KraftVehicle[] | null {
  if (!isRecord(payload) || payload.format !== KRAFT_EXPORT_FORMAT || !Array.isArray(payload.vehicles)) {
    return null;
  }
  return payload.vehicles.map((v) => coerceVehicle(v, fallbackId));
}
