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
  ETB_EXPORT_FORMAT,
  LAGEKARTE_FEATURES,
  hasStabRole,
  isRecord,
  type LogEntry,
  type MapFeature,
} from "@lagekatse/shared";
import { api } from "./api";
import type { Session } from "./session";
import { connectModule } from "./sync/provider";
import { waitForSync } from "./sync/waitForSync";
import { uid } from "./uid";
import { applyArbeitsblattImport } from "./arbeitsblatt/applyImport";
import { applyLagekarteImport, parseLagekarteFeatures } from "./lagekarte/applyImport";

export interface BundleImportResult {
  /** Menschlich lesbare Labels dessen, was eingespielt wurde. */
  imported: string[];
  /** Module, die fehlten oder ungültig waren (übersprungen). */
  skipped: string[];
}

/** Präfixe der drei Bundle-Dateien (siehe exportAll.ts). */
const PREFIXES = {
  lagekarte: "lagekarte-",
  arbeitsblatt: "arbeitsblatt-",
  etb: "einsatztagebuch-",
} as const;

/**
 * Ordnet die ZIP-Einträge den Modulen zu. Reine Funktion (unit-getestet): matcht
 * per Präfix + `.json`-Endung, nimmt je Modul den ersten Treffer, ignoriert
 * Unbekanntes (der Zeitstempel/Code im Dateinamen variiert).
 */
export function classifyBundleFiles(names: string[]): {
  lagekarte?: string;
  arbeitsblatt?: string;
  etb?: string;
} {
  const out: { lagekarte?: string; arbeitsblatt?: string; etb?: string } = {};
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    if (out.lagekarte === undefined && name.startsWith(PREFIXES.lagekarte)) out.lagekarte = name;
    else if (out.arbeitsblatt === undefined && name.startsWith(PREFIXES.arbeitsblatt)) out.arbeitsblatt = name;
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

  // --- Arbeitsblatt (client-CRDT, ersetzen) ---
  if (cls.arbeitsblatt) {
    const parsed = parseJson(files[cls.arbeitsblatt]);
    if (!isRecord(parsed) || parsed.format !== AB_EXPORT_FORMAT || !isRecord(parsed.sheet)) {
      skipped.push("Arbeitsblatt (ungültiges Format)");
    } else {
      const conn = connectModule(session.room.id, "arbeitsblatt", session.token, { cache: false });
      try {
        await waitForSync(conn);
        applyArbeitsblattImport(conn.doc, parsed.sheet, uid);
      } finally {
        conn.destroy();
      }
      imported.push("Arbeitsblatt");
    }
  } else {
    skipped.push("Arbeitsblatt (nicht im Bundle)");
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
