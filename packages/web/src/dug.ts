/**
 * Datum-Uhrzeit-Gruppe (DUG) im Format DDHHMMmmmyy — z.B. "031748Aug26"
 * fuer 03. Aug 2026, 17:48 Uhr. Verwendet in Export-Dateinamen, damit
 * mehrere Exporte am selben Tag unterscheidbar sind.
 *
 * Die Monat-Abkuerzung ist 3-buchstabig (Jan, Feb, ..., Dez) und
 * orientiert sich an der NATO/IdF-Notation.
 */
const DUG_MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

export function dug(date = new Date()): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const mon = DUG_MONTHS[date.getMonth()];
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd}${hh}${mm}${mon}${yy}`;
}