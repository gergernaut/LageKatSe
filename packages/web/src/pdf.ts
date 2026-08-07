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
import {
  AB_GEFAHREN_KATALOG,
  AB_KANAL_FIELDS,
  AB_KANAL_LABELS,
  AB_KOPF_FIELDS,
  AB_KOPF_LABELS,
  type Arbeitsblatt,
  type LogEntry,
} from "@lagekatse/shared";
import { formatDateTime } from "./format";

export interface PdfMeta {
  roomName: string;
  joinCode: string;
  stamp: string; // DUG (Datum-Uhrzeit-Gruppe), vom Aufrufer via dug()
}
/** @deprecated Alias — beide Exporte teilen dieselbe Meta-Form. */
export type EtbPdfMeta = PdfMeta;

const INK = rgb(0.05, 0.08, 0.11);
const MUTED = rgb(0.42, 0.5, 0.58);
const LINE = rgb(0.8, 0.84, 0.88);
const HEAD_BG = rgb(0.93, 0.95, 0.96);
const SIGNAL = rgb(0.97, 0.66, 0.1); // var(--signal)

/** DejaVu Sans (subsetted) einbetten — trägt Umlaute/Sonderzeichen außerhalb WinAnsi. */
async function embedDejaVu(pdf: PDFDocument): Promise<PDFFont> {
  const res = await fetch("/fonts/DejaVuSans.ttf");
  if (!res.ok) throw new Error(`Schrift konnte nicht geladen werden (HTTP ${res.status})`);
  pdf.registerFontkit(fontkit);
  return pdf.embedFont(await res.arrayBuffer(), { subset: true });
}

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
export async function etbToPdf(entries: LogEntry[], meta: PdfMeta): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await embedDejaVu(pdf);

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

// ---- Arbeitsblatt-PDF (A4 hoch) ----
const COND_LABELS: Record<string, string> = {
  dry: "trocken",
  fog: "Nebel",
  rain: "Regen",
  sleet: "Schneeregen",
  snow: "Schnee",
  hail: "Hagel",
  thunderstorm: "Gewitter",
  wind: "windig",
};
function unit(value: number | null, u: string): string {
  return value === null ? "—" : `${Math.round(value)} ${u}`;
}
function compass(deg: number): string {
  return ["N", "NO", "O", "SO", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
}

/** Erzeugt das taktische Arbeitsblatt als PDF (Uint8Array). */
export async function arbeitsblattToPdf(sheet: Arbeitsblatt, meta: PdfMeta): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await embedDejaVu(pdf);

  const W = 595;
  const H = 842;
  const M = 36;
  const CW = W - 2 * M;
  const ABOT = M + 16;
  const S = 8.5; // Fließtext
  const LBL = 7.5; // Label
  const LH = 12; // Zeilenhöhe

  let page = pdf.addPage([W, H]);
  let y = H - M;
  const newPage = () => {
    page = pdf.addPage([W, H]);
    y = H - M;
  };
  const need = (h: number) => {
    if (y - h < ABOT) newPage();
  };
  const gap = (h = 6) => {
    y -= h;
  };

  const heading = (letter: string, title: string) => {
    need(28);
    page.drawRectangle({ x: M, y: y - 14, width: 14, height: 14, color: INK });
    page.drawText(letter, { x: M + 3.8, y: y - 10.8, size: 8.5, font, color: SIGNAL });
    page.drawText(title, { x: M + 21, y: y - 10.8, size: 11, font, color: INK });
    y -= 16;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: LINE });
    y -= 8;
  };

  const para = (text: string, color = INK, indent = 0) => {
    for (const ln of wrapText(text, font, S, CW - indent)) {
      need(LH);
      page.drawText(ln, { x: M + indent, y: y - S, size: S, font, color });
      y -= LH;
    }
  };

  const labelValue = (label: string, value: string) => {
    const vlines = wrapText(value || "—", font, S, CW - 140);
    need(vlines.length * LH);
    page.drawText(label, { x: M, y: y - S, size: LBL, font, color: MUTED });
    vlines.forEach((ln, i) => page.drawText(ln, { x: M + 140, y: y - S - i * LH, size: S, font, color: INK }));
    y -= vlines.length * LH;
  };

  const checkRow = (checked: boolean, label: string, tag = "", note = "") => {
    const box = 9;
    need(LH);
    page.drawRectangle({
      x: M,
      y: y - box - 1,
      width: box,
      height: box,
      borderWidth: 0.8,
      borderColor: INK,
      color: checked ? INK : undefined,
    });
    let tx = M + box + 6;
    if (tag) {
      page.drawText(tag, { x: tx, y: y - S, size: LBL, font, color: MUTED });
      tx += 16;
    }
    page.drawText(label, { x: tx, y: y - S, size: S, font, color: checked ? INK : MUTED });
    y -= LH;
    if (note) {
      for (const ln of wrapText(note, font, S, CW - (box + 22))) {
        need(LH);
        page.drawText(ln, { x: M + box + 22, y: y - S, size: S, font, color: MUTED });
        y -= LH;
      }
    }
  };

  const table = (cols: { label: string; width: number }[], rows: string[][], emptyLabel: string) => {
    const tW = cols.reduce((s, c) => s + c.width, 0);
    const head = () => {
      need(LH + 2);
      page.drawRectangle({ x: M, y: y - LH, width: tW, height: LH, color: HEAD_BG });
      let x = M;
      for (const c of cols) {
        page.drawText(c.label, { x: x + 3, y: y - S - 1, size: LBL, font, color: INK });
        x += c.width;
      }
      y -= LH;
    };
    head();
    if (rows.length === 0) {
      need(LH);
      page.drawText(emptyLabel, { x: M + 3, y: y - S - 1, size: S, font, color: MUTED });
      y -= LH;
      gap(4);
      return;
    }
    for (const row of rows) {
      const wr = cols.map((c, i) => wrapText(row[i] ?? "", font, S, c.width - 6));
      const n = Math.max(...wr.map((w) => w.length));
      const rh = n * LH + 2;
      if (y - rh < ABOT) {
        newPage();
        head();
      }
      let x = M;
      wr.forEach((cl, i) => {
        cl.forEach((ln, li) => page.drawText(ln, { x: x + 3, y: y - S - 1 - li * LH, size: S, font, color: INK }));
        x += cols[i].width;
      });
      page.drawLine({ start: { x: M, y: y - rh }, end: { x: M + tW, y: y - rh }, thickness: 0.4, color: LINE });
      y -= rh;
    }
    gap(4);
  };

  // Titelkopf
  page.drawText(`Taktisches Arbeitsblatt — ${meta.roomName}`, { x: M, y: y - 13, size: 13, font, color: INK });
  page.drawText(`Lobby ${meta.joinCode} · Stand ${meta.stamp}`, { x: M, y: y - 26, size: 9, font, color: MUTED });
  y -= 40;

  // A · Kopfzeile
  heading("A", "Kopfzeile");
  for (const f of AB_KOPF_FIELDS) labelValue(AB_KOPF_LABELS[f], sheet.kopf[f]);
  gap();

  // B · Gefahren der Einsatzstelle
  heading("B", "Gefahren der Einsatzstelle (4 A · 1 C · 4 E)");
  para("Lagebild: siehe Modul Lagekarte.", MUTED);
  for (const g of AB_GEFAHREN_KATALOG) {
    const posten = sheet.gefahren[g.key];
    checkRow(!!posten?.betroffen, g.label, g.gruppe, posten?.betroffen ? posten.notiz ?? "" : "");
  }
  gap();

  // C · Führungsvorgang
  heading("C", "Führungsvorgang");
  table(
    [
      { label: "Bedrohtes Objekt/Subjekt", width: 130 },
      { label: "Wirkung", width: 92 },
      { label: "Prio", width: 32 },
      { label: "Maßnahmen", width: 237 },
      { label: "Erl.", width: 32 },
    ],
    sheet.fuehrungsvorgang.map((r) => [
      r.bedrohtesObjekt,
      r.wirkung,
      r.prioritaet ? `P${r.prioritaet}` : "—",
      r.massnahmen,
      r.erledigt ? "ja" : "nein",
    ]),
    "Keine Einträge.",
  );
  gap();

  // D · Rückmeldungen / Notizen
  heading("D", "Rückmeldungen / Notizen");
  if (sheet.rueckmeldungen.length === 0) para("Keine Notizen.", MUTED);
  for (const note of sheet.rueckmeldungen) checkRow(note.erledigt, note.text || "—");
  gap();

  // E · Eigene Lage / Nachforderung
  heading("E", "Eigene Lage / Nachforderung");
  checkRow(sheet.eigeneLage.auftragMr, "Menschenrettung (MR)");
  checkRow(sheet.eigeneLage.auftragBb, "Brandbekämpfung (BB)");
  labelValue("Weiterer Auftrag", sheet.eigeneLage.auftragText);
  labelValue("Kräfteübersicht", sheet.eigeneLage.kraefteuebersicht);
  if (sheet.nachforderung.length === 0) para("Nachforderung: keine", MUTED);
  else for (const nf of sheet.nachforderung) para(`• ${nf.text}`);
  gap();

  // F · Organisation / Kommunikation
  heading("F", "Organisation / Kommunikation");
  for (const f of AB_KANAL_FIELDS) labelValue(AB_KANAL_LABELS[f], sheet.organisation[f]);
  labelValue("Eigene Funktion", sheet.organisation.eigeneFunktion || "—");
  gap(2);
  need(LH);
  page.drawText("Führungs-Organigramm", { x: M, y: y - S, size: S, font, color: INK });
  y -= LH;
  table(
    [
      { label: "Rolle", width: 120 },
      { label: "Auftrag", width: 200 },
      { label: "Führer", width: 110 },
      { label: "Rufname", width: 93 },
    ],
    sheet.organigramm.map((r) => [r.rolle, r.auftrag, r.fuehrer, r.rufname]),
    "Keine Einträge.",
  );
  gap();

  // Wetter (Rückseite)
  heading("W", "Wetter");
  const w = sheet.wetter;
  if (!w) {
    para("Noch nicht abgerufen.", MUTED);
  } else {
    const c = w.current;
    labelValue("Stand / Station", `${formatDateTime(w.fetchedAt)}${w.stationName ? ` · ${w.stationName}` : ""}`);
    para(
      `${unit(c.temperature, "°C")} · Wind ${unit(c.windSpeed, "km/h")}${
        c.windDirection !== null ? ` ${compass(c.windDirection)}` : ""
      } (Böen ${unit(c.windGust, "km/h")}) · Bewölkung ${unit(c.cloudCover, "%")} · Niederschlag ${unit(
        c.precipitation,
        "mm",
      )} · ${unit(c.pressure, "hPa")} · Feuchte ${unit(c.humidity, "%")} · ${
        c.condition ? COND_LABELS[c.condition] ?? c.condition : "—"
      }`,
    );
    if (w.forecast.length > 0) {
      para(
        "Vorhersage: " +
          w.forecast
            .map(
              (h) =>
                `${String(new Date(h.time).getHours()).padStart(2, "0")} Uhr ${unit(h.temperature, "°C")}/${
                  h.precipitationProbability !== null ? `${Math.round(h.precipitationProbability)} %` : "—"
                }`,
            )
            .join("   ·   "),
        MUTED,
      );
    }
    if (w.alerts.length === 0) para("Warnungen: keine", MUTED);
    else
      for (const a of w.alerts) {
        para(
          `⚠ ${a.event ?? "Warnung"}${a.severity ? ` (${a.severity})` : ""}${a.headline ? ` — ${a.headline}` : ""}`,
          rgb(0.6, 0.15, 0.1),
        );
      }
  }

  // Fußzeilen (Seitenzahlen) — erst jetzt ist die Gesamtseitenzahl bekannt.
  const pages = pdf.getPages();
  pages.forEach((p, idx) => {
    p.drawText(`Seite ${idx + 1} / ${pages.length}`, { x: M, y: M - 4, size: 8, font, color: MUTED });
    p.drawText("LageKatSe · Taktisches Arbeitsblatt", { x: W - M - 150, y: M - 4, size: 8, font, color: MUTED });
  });

  return pdf.save();
}
