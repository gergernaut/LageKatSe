/**
 * Abschluss-ETB-Eintrag (#75): der deutsche Satz, den „Lage abschließen" als
 * letzten, server-autoritativen ETB-Eintrag schreibt. Reine Funktion (unit-getestet);
 * die DUG-Strings (Datum-Uhrzeit-Gruppe) werden vom Client via `dug()` erzeugt und
 * hier nur eingesetzt — `dug()` lebt client-seitig (`web/dug.ts`).
 */
export interface CloseEtbTextInput {
  /** DUG der Raum-Erstellung (Lagebeginn). */
  startDug: string;
  /** Anzeige-String des Erstellers „Name (Rollen)"; leer ⇒ Klausel entfällt. */
  createdBy?: string;
  /** DUG des Abschlusses (Lageende). */
  endDug: string;
  /** Anzeige-String des Abschließenden „Name (Rollen)". */
  closedBy: string;
}

export function buildCloseEtbText(input: CloseEtbTextInput): string {
  const opened = input.createdBy ? `, eröffnet durch ${input.createdBy}` : "";
  return `Lageraum abgeschlossen. Lagebeginn ${input.startDug}${opened}, Lageende ${input.endDug}, geschlossen von ${input.closedBy}.`;
}
