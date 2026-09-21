/**
 * Geteilte Formatierhelfer für Exporte/Anzeige. Bewusst klein gehalten.
 */

/**
 * Volles lokales Datum + Uhrzeit (`YYYY-MM-DD HH:MM`). HH:MM allein ist über eine
 * mehrtägige Lage mehrdeutig, und ETB/Arbeitsblatt sind Nachweisdokumente
 * (architecture.md §9.5). Wird vom PDF-Export genutzt.
 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

/**
 * Nur der Datumsteil, deutsch (`DD.MM.YYYY`), in *lokaler* Zeit — für die
 * Datumszeile unter der Uhrzeit im ETB (#223). Ungültige Eingabe → "".
 */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(date.getDate())}.${p(date.getMonth() + 1)}.${date.getFullYear()}`;
}

/**
 * Erstrecken sich die Zeitstempel über mehr als einen (lokalen) Kalendertag?
 * Genutzt vom ETB (#223): das Datum erscheint nur bei mehrtägigen Lagen unter der
 * Uhrzeit — bei Ein-Tages-Lagen bliebe es redundant. Ungültige Werte werden
 * ignoriert; leere/ein-Tages-Mengen ergeben `false`.
 */
export function spansMultipleDays(isos: readonly string[]): boolean {
  const days = new Set<string>();
  for (const iso of isos) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) continue;
    days.add(`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`);
    if (days.size > 1) return true;
  }
  return false;
}
