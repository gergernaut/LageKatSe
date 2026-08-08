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
