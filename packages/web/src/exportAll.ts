/**
 * Gesamt-Export: verbindet sich mit jedem Modul-Dokument, extrahiert die
 * Daten im jeweiligen Format (jeweils verlustfreies JSON) und paketiert alles
 * als ZIP-Datei zum Download. Gegenstück ist der Bundle-Import (importAll.ts, #71),
 * daher JSON statt CSV — verlustfrei re-importierbar.
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
  AB_WETTER,
  AB_WETTER_SNAPSHOT,
  ETB_ENTRIES,
  ETB_EXPORT_FORMAT,
  LAGEKARTE_FEATURES,
  type EtbExport,
  type LogEntry,
} from "@lagekatse/shared";
import type { Session } from "./session";
import { connectModule } from "./sync/provider";
import { dug } from "./dug";
import { waitForSync } from "./sync/waitForSync";

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
  const wetter = doc.getMap<unknown>(AB_WETTER);

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
      wetter: wetter.get(AB_WETTER_SNAPSHOT) ?? null,
    },
  };
}

/* ---------- Main export function ---------- */

export async function exportAll(session: Session): Promise<void> {
  const stamp = dug();
  const code = session.room.joinCode;
  const files: Record<string, Uint8Array> = {};

  // --- Lagekarte ---
  {
    const conn = connectModule(session.room.id, "lagekarte", session.token, { cache: false });
    try {
      await waitForSync(conn);
      const features = conn.doc.getMap<unknown>(LAGEKARTE_FEATURES);
      const payload = {
        format: "lagekatse.lagekarte",
        version: 1,
        exportedAt: new Date().toISOString(),
        features: [...features.values()],
      };
      files[`lagekarte-${code}-${stamp}.json`] = new TextEncoder().encode(
        JSON.stringify(payload, null, 2),
      );
    } finally {
      conn.destroy();
    }
  }

  // --- ETB ---
  {
    const conn = connectModule(session.room.id, "etb", session.token, { cache: false });
    try {
      await waitForSync(conn);
      const entries = conn.doc.getArray<Y.Map<unknown>>(ETB_ENTRIES);
      const logEntries = entries.toArray().map((e) => e.toJSON() as LogEntry);
      const payload: EtbExport = {
        format: ETB_EXPORT_FORMAT,
        version: 1,
        exportedAt: new Date().toISOString(),
        entries: logEntries,
      };
      files[`einsatztagebuch-${code}-${stamp}.json`] = new TextEncoder().encode(
        JSON.stringify(payload, null, 2),
      );
    } finally {
      conn.destroy();
    }
  }

  // --- Arbeitsblatt ---
  {
    const conn = connectModule(session.room.id, "arbeitsblatt", session.token, { cache: false });
    try {
      await waitForSync(conn);
      const payload = extractArbeitsblatt(conn.doc);
      files[`arbeitsblatt-${code}-${stamp}.json`] = new TextEncoder().encode(
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
  link.download = `lagekatse-export-${code}-${stamp}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
