/**
 * Gesamt-Export: verbindet sich mit jedem Modul-Dokument, extrahiert die
 * Daten im jeweiligen Format (Lagekarte JSON, ETB CSV, Arbeitsblatt JSON)
 * und paketiert alles als ZIP-Datei zum Download.
 *
 * Die Verbindung ist kurzlebig: connect → extract → destroy. Die Daten werden
 * aus den bereits vom y-websocket-Provider synchronisierten Yjs-Dokumenten
 * gelesen; bei aktiver Verbindung ist das augenblicklich, bei einer kalten
 * Verbindung dauert es bis zur ersten Sync (~1 RTT).
 */
import * as Y from "yjs";
import { zipSync } from "fflate";
import {
  AB_EXPORT_FORMAT,
  AB_EIGENELAGE,
  AB_FUEHRUNG,
  AB_GEFAHREN,
  AB_KOPF,
  AB_NACHFORDERUNG,
  AB_ORGANIGRAMM,
  AB_ORGANISATION,
  AB_RUECKMELD,
  ETB_ENTRIES,
  LAGEKARTE_FEATURES,
  type LogEntry,
} from "@lagekatse/shared";
import type { Session } from "./session";
import { connectModule } from "./sync/provider";

/* ---------- ETB CSV helpers (spiegeln Etb.tsx buildCsv) ---------- */

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

function buildEtbCsv(entries: LogEntry[]): string {
  const header = [
    "Lfd.Nr", "Zeit", "Richtung", "Von", "An", "Weg",
    "Inhalt", "Veranlassung", "Erledigt", "Bearbeiter",
  ];
  const rows = entries.map((entry) => {
    const inhalt = entry.storniert ? `[STORNIERT] ${entry.inhalt}` : entry.inhalt;
    return [
      entry.lfdNr, formatDateTime(entry.zeit), entry.richtung,
      entry.von, entry.an, entry.weg, inhalt, entry.veranlassung,
      entry.erledigt ? "ja" : "nein", entry.bearbeiter,
    ].map(csvCell).join(";");
  });
  return `\uFEFF${[header.join(";"), ...rows].join("\r\n")}`;
}

/* ---------- Arbeitsblatt extraction (spiegelt Arbeitsblatt.tsx) ---------- */

function stringValue(map: Y.Map<unknown>, field: string): string {
  const value = map.get(field);
  return typeof value === "string" ? value : "";
}

function booleanValue(map: Y.Map<unknown>, field: string): boolean {
  const value = map.get(field);
  return typeof value === "boolean" ? value : false;
}

function extractArbeitsblatt(doc: Y.Doc) {
  const kopf = doc.getMap<unknown>(AB_KOPF);
  const gefahren = doc.getMap<unknown>(AB_GEFAHREN);
  const fuehrung = doc.getArray<Y.Map<unknown>>(AB_FUEHRUNG);
  const rueckmeld = doc.getArray<Y.Map<unknown>>(AB_RUECKMELD);
  const eigeneLage = doc.getMap<unknown>(AB_EIGENELAGE);
  const nachforderung = doc.getArray<Y.Map<unknown>>(AB_NACHFORDERUNG);
  const organisation = doc.getMap<unknown>(AB_ORGANISATION);
  const organigramm = doc.getArray<Y.Map<unknown>>(AB_ORGANIGRAMM);

  return {
    format: AB_EXPORT_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    sheet: {
      kopf: {
        einsatzstichwort: stringValue(kopf, "einsatzstichwort"),
        einsatzort: stringValue(kopf, "einsatzort"),
        meldender: stringValue(kopf, "meldender"),
        objektnr: stringValue(kopf, "objektnr"),
        datumUhrzeitgruppe: stringValue(kopf, "datumUhrzeitgruppe"),
      },
      gefahren: gefahren.toJSON(),
      fuehrungsvorgang: fuehrung.toJSON(),
      rueckmeldungen: rueckmeld.toJSON(),
      eigeneLage: {
        auftragMr: booleanValue(eigeneLage, "auftragMr"),
        auftragBb: booleanValue(eigeneLage, "auftragBb"),
        auftragText: stringValue(eigeneLage, "auftragText"),
        kraefteuebersicht: stringValue(eigeneLage, "kraefteuebersicht"),
      },
      nachforderung: nachforderung.toJSON(),
      organisation: {
        tmoGruppe: stringValue(organisation, "tmoGruppe"),
        fuehrungsKanal: stringValue(organisation, "fuehrungsKanal"),
        dmoGruppe: stringValue(organisation, "dmoGruppe"),
        gebFunk: stringValue(organisation, "gebFunk"),
        eigeneFunktion: stringValue(organisation, "eigeneFunktion"),
      },
      organigramm: organigramm.toJSON(),
    },
  };
}

/* ---------- Sync helper: wait for a fresh Yjs doc to receive data ---------- */

function waitForSync(conn: ReturnType<typeof connectModule>, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    // If already synced (warm connection), resolve immediately.
    if (conn.provider.synced) {
      resolve();
      return;
    }
    const timer = window.setTimeout(() => resolve(), timeoutMs);
    conn.provider.once("sync", () => {
      window.clearTimeout(timer);
      resolve();
    });
  });
}

/* ---------- Main export function ---------- */

export async function exportAll(session: Session): Promise<void> {
  const dateStr = new Date().toISOString().slice(0, 10);
  const code = session.room.joinCode;
  const files: Record<string, Uint8Array> = {};

  // --- Lagekarte ---
  {
    const conn = connectModule(session.room.id, "lagekarte", session.token);
    try {
      await waitForSync(conn);
      const features = conn.doc.getMap<unknown>(LAGEKARTE_FEATURES);
      const payload = {
        format: "lagekatse.lagekarte",
        version: 1,
        exportedAt: new Date().toISOString(),
        features: [...features.values()],
      };
      files[`lagekarte-${code}-${dateStr}.json`] = new TextEncoder().encode(
        JSON.stringify(payload, null, 2),
      );
    } finally {
      conn.destroy();
    }
  }

  // --- ETB ---
  {
    const conn = connectModule(session.room.id, "etb", session.token);
    try {
      await waitForSync(conn);
      const entries = conn.doc.getArray<Y.Map<unknown>>(ETB_ENTRIES);
      const logEntries = entries.toArray().map((e) => e.toJSON() as LogEntry);
      const csv = buildEtbCsv(logEntries);
      files[`einsatztagebuch-${code}-${dateStr}.csv`] = new TextEncoder().encode(csv);
    } finally {
      conn.destroy();
    }
  }

  // --- Arbeitsblatt ---
  {
    const conn = connectModule(session.room.id, "arbeitsblatt", session.token);
    try {
      await waitForSync(conn);
      const payload = extractArbeitsblatt(conn.doc);
      files[`arbeitsblatt-${code}-${dateStr}.json`] = new TextEncoder().encode(
        JSON.stringify(payload, null, 2),
      );
    } finally {
      conn.destroy();
    }
  }

  // --- ZIP bauen und downloaden ---
  const zipped = zipSync(files);
  const blob = new Blob([zipped], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `lagekatse-export-${code}-${dateStr}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
