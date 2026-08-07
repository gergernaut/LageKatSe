/**
 * PDF-Export (client-seitig, wie die anderen Exporte — kein Server-Eingriff).
 *
 * Erzeugt das PDF selbst mit pdf-lib (kein Ausfüllen amtlicher Vorlagen, s.
 * Entscheidung zu #M4/PDF): robust, in sich abgeschlossen, keine Vorlagen-/
 * Lizenz-Abhängigkeit. Eingebettet wird DejaVu Sans (subsetted) — die Standard-
 * Fonts könnten an Zeichen außerhalb WinAnsi (Windows-1252) scheitern; mit einer
 * eigenen Unicode-Schrift rendern Umlaute/Symbole korrekt und fehlen ggf. still
 * (statt einen Fehler zu werfen). Start: Einsatztagebuch; Arbeitsblatt folgt.
 */
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { LogEntry } from "@lagekatse/shared";

export interface EtbPdfMeta {
  roomName: string;
  joinCode: string;
  stamp: string; // DUG (Datum-Uhrzeit-Gruppe), vom Aufrufer via dug()
}

const INK = rgb(0.05, 0.08, 0.11);
const MUTED = rgb(0.42, 0.5, 0.58);
const LINE = rgb(0.8, 0.84, 0.88);
const HEAD_BG = rgb(0.93, 0.95, 0.96);

// A4 quer (Punkte), großzügiger Rand.
const PAGE_W = 842;
const PAGE_H = 595;
const MARGIN = 32;
const BODY = 8;
const LEAD = 10.5; // Zeilenhöhe
const PAD = 3;

interface Col {
  key: string;
  label: string;
  width: number;
}

// Spalten wie im CSV-Export (§9.5), Breiten für A4-quer (Summe ≤ nutzbare Breite).
const COLS: Col[] = [
  { key: "lfdNr", label: "Lfd.", width: 28 },
  { key: "zeit", label: "Zeit", width: 84 },
  { key: "richtung", label: "Ri.", width: 24 },
  { key: "von", label: "Von", width: 68 },
  { key: "an", label: "An", width: 68 },
  { key: "weg", label: "Weg", width: 54 },
  { key: "inhalt", label: "Inhalt", width: 190 },
  { key: "veranlassung", label: "Veranlassung", width: 150 },
  { key: "erledigt", label: "Erl.", width: 26 },
  { key: "bearbeiter", label: "Bearbeiter", width: 74 },
];

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

/** Wort-Umbruch auf eine maximale Breite; sehr lange Wörter werden hart getrennt. */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const rawLine of String(text ?? "").split("\n")) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      // Wort allein zu breit → zeichenweise hart umbrechen.
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        let chunk = "";
        for (const ch of word) {
          if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth && chunk) {
            out.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        line = chunk;
      } else {
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out.length > 0 ? out : [""];
}

function cellText(entry: LogEntry, key: string): string {
  switch (key) {
    case "lfdNr":
      return String(entry.lfdNr);
    case "zeit":
      return formatDateTime(entry.zeit);
    case "richtung":
      return entry.richtung;
    case "von":
      return entry.von;
    case "an":
      return entry.an;
    case "weg":
      return entry.weg;
    case "inhalt":
      // v1-Schema hat keine Storno-Spalte → Kennzeichnung im Inhalt (wie CSV).
      return entry.storniert ? `[STORNIERT] ${entry.inhalt}` : entry.inhalt;
    case "veranlassung":
      return entry.veranlassung;
    case "erledigt":
      return entry.erledigt ? "ja" : "nein";
    case "bearbeiter":
      return entry.bearbeiter;
    default:
      return "";
  }
}

function drawHeaderRow(page: PDFPage, font: PDFFont, x0: number, top: number): number {
  const height = LEAD + 2 * PAD;
  page.drawRectangle({
    x: x0,
    y: top - height,
    width: COLS.reduce((s, c) => s + c.width, 0),
    height,
    color: HEAD_BG,
  });
  let x = x0;
  for (const col of COLS) {
    page.drawText(col.label, { x: x + PAD, y: top - PAD - BODY, size: BODY, font, color: INK });
    x += col.width;
  }
  return height;
}

/** Erzeugt das Einsatztagebuch als PDF (Uint8Array). */
export async function etbToPdf(entries: LogEntry[], meta: EtbPdfMeta): Promise<Uint8Array> {
  const res = await fetch("/fonts/DejaVuSans.ttf");
  if (!res.ok) throw new Error(`Schrift konnte nicht geladen werden (HTTP ${res.status})`);
  const fontBytes = await res.arrayBuffer();

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });

  const x0 = MARGIN;
  const tableWidth = COLS.reduce((s, c) => s + c.width, 0);
  const bottom = MARGIN + 18; // Platz für die Fußzeile

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  // Titelkopf
  page.drawText(`Einsatztagebuch — ${meta.roomName}`, { x: x0, y: y - 12, size: 13, font, color: INK });
  page.drawText(`Lobby ${meta.joinCode} · Stand ${meta.stamp} · ${entries.length} Eintrag${entries.length === 1 ? "" : "e"}`, {
    x: x0,
    y: y - 26,
    size: 9,
    font,
    color: MUTED,
  });
  y -= 40;
  y -= drawHeaderRow(page, font, x0, y);

  const drawTableHeaderOnNewPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
    y -= drawHeaderRow(page, font, x0, y);
  };

  if (entries.length === 0) {
    page.drawText("Noch keine Einträge.", { x: x0 + PAD, y: y - PAD - BODY, size: BODY, font, color: MUTED });
    y -= LEAD + 2 * PAD;
  }

  for (const entry of entries) {
    const wrapped = COLS.map((col) =>
      wrapText(cellText(entry, col.key), font, BODY, col.width - 2 * PAD),
    );
    const lines = Math.max(...wrapped.map((w) => w.length));
    const rowHeight = lines * LEAD + 2 * PAD;

    if (y - rowHeight < bottom) drawTableHeaderOnNewPage();

    const color = entry.storniert ? MUTED : INK;
    let x = x0;
    wrapped.forEach((cellLines, i) => {
      cellLines.forEach((ln, li) => {
        page.drawText(ln, { x: x + PAD, y: y - PAD - BODY - li * LEAD, size: BODY, font, color });
      });
      x += COLS[i].width;
    });
    // Zeilentrenner
    page.drawLine({
      start: { x: x0, y: y - rowHeight },
      end: { x: x0 + tableWidth, y: y - rowHeight },
      thickness: 0.5,
      color: LINE,
    });
    y -= rowHeight;
  }

  // Fußzeile (Seitenzahlen) über alle Seiten nachziehen — erst jetzt ist die
  // Gesamtseitenzahl bekannt. (Keine vertikalen Spaltenlinien: Kopf-Schattierung
  // + Zeilentrenner genügen und laufen nicht durch den Titelkopf auf Seite 1.)
  const pages = pdf.getPages();
  pages.forEach((p, idx) => {
    p.drawText(`Seite ${idx + 1} / ${pages.length}`, {
      x: x0,
      y: MARGIN - 2,
      size: 8,
      font,
      color: MUTED,
    });
    p.drawText("LageKatSe · Einsatztagebuch", {
      x: x0 + tableWidth - 130,
      y: MARGIN - 2,
      size: 8,
      font,
      color: MUTED,
    });
  });

  return pdf.save();
}
