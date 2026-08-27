/**
 * Bundle-Import (#71): Gegenstück zum Gesamt-Export (exportAll.ts). Nimmt ein
 * exportiertes ZIP und spielt jedes enthaltene Modul wieder ein — Lagekarte und
 * Arbeitsblatt client-seitig als **eine** CRDT-Transaktion (geteilte apply-Helfer),
 * das Einsatztagebuch server-autoritativ über POST /etb/import (Invariante #6).
 *
 * Ersetzt den geteilten Stand (faithful restore) und ist nur S-Rollen erlaubt; der
 * Bestätigungsdialog liegt im Aufrufer (Uebersicht.tsx).
 */
import { unzipSync } from "fflate";
import {
  AB_EXPORT_FORMAT,
  AB_EXPORT_VERSION,
  EA_ABSCHNITTE,
  ETB_EXPORT_FORMAT,
  KRAFT_VEHICLES,
  LAGEKARTE_FEATURES,
  hasStabRole,
  isRecord,
  parseEinsatzabschnitteExport,
  parseFuehrungExport,
  parseKraftExport,
  type LogEntry,
  type MapFeature,
} from "@lagekatse/shared";
import * as Y from "yjs";
import { api } from "./api";
import type { Session } from "./session";
import { connectModule } from "./sync/provider";
import { waitForSync } from "./sync/waitForSync";
import { uid } from "./uid";
import { applyArbeitsblattImport } from "./arbeitsblatt/applyImport";
import { applyLagekarteImport, parseLagekarteFeatures } from "./lagekarte/applyImport";
import { applyKraftImport } from "./kraefteubersicht/applyImport";
import { applyEinsatzabschnitteImport } from "./einsatzabschnitte/applyImport";

export interface BundleImportResult {
  /** Menschlich lesbare Labels dessen, was eingespielt wurde. */
  imported: string[];
  /** Module, die fehlten oder ungültig waren (übersprungen). */
  skipped: string[];
}

/** Präfixe der Bundle-Dateien (siehe exportAll.ts). */
const PREFIXES = {
  lagekarte: "lagekarte-",
  arbeitsblatt: "arbeitsblatt-",
  etb: "einsatztagebuch-",
  kraefteubersicht: "kraefteuebersicht-",
  einsatzabschnitte: "einsatzabschnitte-",
} as const;

interface BundleFiles {
  lagekarte?: string;
  arbeitsblatt?: string;
  etb?: string;
  kraefteubersicht?: string;
  einsatzabschnitte?: string;
}

/**
 * Ordnet die ZIP-Einträge den Modulen zu. Reine Funktion (unit-getestet): matcht
 * per Präfix + `.json`-Endung, nimmt je Modul den ersten Treffer, ignoriert
 * Unbekanntes (der Zeitstempel/Code im Dateinamen variiert). Die Präfixe
 * "einsatzabschnitte-" und "einsatztagebuch-" sind eindeutig verschieden.
 */
export function classifyBundleFiles(names: string[]): BundleFiles {
  const out: BundleFiles = {};
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    if (out.lagekarte === undefined && name.startsWith(PREFIXES.lagekarte)) out.lagekarte = name;
    else if (out.arbeitsblatt === undefined && name.startsWith(PREFIXES.arbeitsblatt)) out.arbeitsblatt = name;
    else if (out.kraefteubersicht === undefined && name.startsWith(PREFIXES.kraefteubersicht)) out.kraefteubersicht = name;
    else if (out.einsatzabschnitte === undefined && name.startsWith(PREFIXES.einsatzabschnitte)) out.einsatzabschnitte = name;
    else if (out.etb === undefined && name.startsWith(PREFIXES.etb)) out.etb = name;
  }
  return out;
}

function parseJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function importBundle(session: Session, file: File): Promise<BundleImportResult> {
  if (!hasStabRole(session.roles)) {
    throw new Error("Bundle-Import erfordert eine Stabsrolle (S1–S6).");
  }

  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const cls = classifyBundleFiles(Object.keys(files));
  const imported: string[] = [];
  const skipped: string[] = [];

  // --- Lagekarte (client-CRDT, ersetzen) ---
  if (cls.lagekarte) {
    const result = parseLagekarteFeatures(parseJson(files[cls.lagekarte]));
    if (!result) {
      skipped.push("Lagekarte (ungültiges Format)");
    } else {
      const conn = connectModule(session.room.id, "lagekarte", session.token, { cache: false });
      try {
        await waitForSync(conn);
        const featuresMap = conn.doc.getMap<MapFeature>(LAGEKARTE_FEATURES);
        applyLagekarteImport(featuresMap, result.valid, { replace: true });
      } finally {
        conn.destroy();
      }
      imported.push(`Lagekarte (${result.valid.length} Feature${result.valid.length === 1 ? "" : "s"})`);
    }
  } else {
    skipped.push("Lagekarte (nicht im Bundle)");
  }

  // --- Taktische Übersicht (client-CRDT, ersetzen) ---
  if (cls.arbeitsblatt) {
    const parsed = parseJson(files[cls.arbeitsblatt]);
    if (!isRecord(parsed) || parsed.format !== AB_EXPORT_FORMAT || !isRecord(parsed.sheet)) {
      skipped.push("Taktische Übersicht (ungültiges Format)");
    } else if (parsed.version !== AB_EXPORT_VERSION) {
      skipped.push("Taktische Übersicht (inkompatible Version)");
    } else {
      const conn = connectModule(session.room.id, "arbeitsblatt", session.token, { cache: false });
      try {
        await waitForSync(conn);
        applyArbeitsblattImport(conn.doc, parsed.sheet, uid);
      } finally {
        conn.destroy();
      }
      imported.push("Taktische Übersicht");
    }
  } else {
    skipped.push("Taktische Übersicht (nicht im Bundle)");
  }

  // --- Kräfteübersicht (client-CRDT, ersetzen) ---
  if (cls.kraefteubersicht) {
    const rows = parseKraftExport(parseJson(files[cls.kraefteubersicht]), uid);
    if (!rows) {
      skipped.push("Kräfteübersicht (ungültiges Format)");
    } else {
      const conn = connectModule(session.room.id, "kraefteubersicht", session.token, { cache: false });
      try {
        await waitForSync(conn);
        const vehicles = conn.doc.getArray<Y.Map<unknown>>(KRAFT_VEHICLES);
        applyKraftImport(vehicles, rows, { replace: true });
      } finally {
        conn.destroy();
      }
      imported.push(`Kräfteübersicht (${rows.length} Fahrzeug${rows.length === 1 ? "" : "e"})`);
    }
  } else {
    skipped.push("Kräfteübersicht (nicht im Bundle)");
  }

  // --- Einsatzabschnitte (client-CRDT, ersetzen) ---
  if (cls.einsatzabschnitte) {
    const payload = parseJson(files[cls.einsatzabschnitte]);
    const rows = parseEinsatzabschnitteExport(payload, uid);
    if (!rows) {
      skipped.push("Einsatzabschnitte (ungültiges Format)");
    } else {
      const fuehrung = parseFuehrungExport(payload);
      const conn = connectModule(session.room.id, "einsatzabschnitte", session.token, { cache: false });
      try {
        await waitForSync(conn);
        const abschnitte = conn.doc.getArray<Y.Map<unknown>>(EA_ABSCHNITTE);
        applyEinsatzabschnitteImport(abschnitte, rows, { replace: true, fuehrung });
      } finally {
        conn.destroy();
      }
      imported.push(`Einsatzabschnitte (${rows.length})`);
    }
  } else {
    skipped.push("Einsatzabschnitte (nicht im Bundle)");
  }

  // --- Einsatztagebuch (server-autoritativ, ersetzen) ---
  if (cls.etb) {
    const parsed = parseJson(files[cls.etb]);
    if (!isRecord(parsed) || parsed.format !== ETB_EXPORT_FORMAT || !Array.isArray(parsed.entries)) {
      skipped.push("Einsatztagebuch (ungültiges Format)");
    } else {
      const { count } = await api.importEtb(session.room.joinCode, session.token, parsed.entries as LogEntry[]);
      imported.push(`Einsatztagebuch (${count} Eintr${count === 1 ? "ag" : "äge"})`);
    }
  } else {
    skipped.push("Einsatztagebuch (nicht im Bundle)");
  }

  return { imported, skipped };
}
