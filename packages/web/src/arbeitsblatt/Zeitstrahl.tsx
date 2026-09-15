/**
 * Zeitstrahl-Karte der Taktischen Übersicht (#208) — eigene Karte direkt unter der
 * Kopfzeile. Horizontale Skala mit **gleichmäßig verteilten** Punkten (nicht
 * proportional zur Uhrzeit), Kategorisierung + "Jetzt"-Markierung via reiner
 * `kategorisiereMeilensteine`-Funktion (shared). Klick auf einen Punkt öffnet den
 * Bearbeiten-Dialog (Bearbeiten/Erledigt-Markierung entfällt bewusst — kein
 * Aufgaben-Ersatz — und Löschen), MouseOver zeigt Datum/Uhrzeit/Titel/Details.
 *
 * Reine Anzeige + CRDT-Zeilen (Invariante #1/#4): die Meilensteine sind geteilter
 * Zustand (Y.Array, Feld-Merge), der Klappzustand der Karte liegt zentral im
 * Arbeitsblatt (#206-Muster).
 */
import { useEffect, useState } from "react";
import type { AbMeilenstein, AbMeilensteinKategorie, AbZeitstrahlEintrag } from "@lagekatse/shared";

/** Kategorie → Farbklasse (Legende + Punkte, dark-mode über CSS-Variablen). */
const KATEGORIE_KLASSE: Record<AbMeilensteinKategorie, string> = {
  vergangen: "zeitstrahl__punkt--vergangen",
  aktuell: "zeitstrahl__punkt--aktuell",
  naechstes: "zeitstrahl__punkt--naechstes",
  geplant: "zeitstrahl__punkt--geplant",
};

/** Datum/Uhrzeit für Label + Tooltip: "12.02.2027" / "14:00" (de-DE). */
function fmtDatum(iso: string): string {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}.${m}.${y}` : iso;
}

/** Dialog-Zustand: null = zu, {} = neu anlegen, sonst bearbeiten. */
export interface ZeitstrahlDialogState {
  meilenstein: Partial<AbMeilenstein> | null;
}

export function Zeitstrahl({
  eintraege,
  jetzt,
  writable,
  collapsed,
  onTogglePanel,
  onUpsert,
  onDelete,
}: {
  eintraege: AbZeitstrahlEintrag<AbMeilenstein>[];
  jetzt: Date;
  writable: boolean;
  collapsed: boolean;
  onTogglePanel: (id: "z") => void;
  onUpsert: (value: Omit<AbMeilenstein, "id"> & { id?: string }) => void;
  onDelete: (id: string) => void;
}) {
  const [dialog, setDialog] = useState<ZeitstrahlDialogState>({ meilenstein: null });
  const [hovered, setHovered] = useState<string | null>(null);

  // Dialog per Escape schließen.
  useEffect(() => {
    if (dialog.meilenstein === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDialog({ meilenstein: null });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog.meilenstein === null]);

  // "Jetzt"-Position: gleichmäßige Skala pro Punkt, die Markierung läuft innerhalb
  // der Punkt-Abstände linear mit der Uhrzeit mit. Vor dem ersten Punkt = 0 %,
  // nach dem letzten = 100 %.
  const jetztPosition = (() => {
    if (eintraege.length === 0) return null;
    const msOf = (m: AbMeilenstein) => new Date(`${m.datum}T${m.uhrzeit}:00`).getTime();
    const now = jetzt.getTime();
    const first = msOf(eintraege[0]);
    const last = msOf(eintraege[eintraege.length - 1]);
    if (now <= first) return 0;
    if (now >= last) return 100;
    for (let i = 0; i < eintraege.length - 1; i++) {
      const a = msOf(eintraege[i]);
      const b = msOf(eintraege[i + 1]);
      if (now >= a && now <= b) {
        const t = b > a ? (now - a) / (b - a) : 0;
        const n = eintraege.length - 1;
        return ((i + t) / n) * 100;
      }
    }
    return 100;
  })();

  return (
    <section className="arbeitsblatt-panel" aria-labelledby="arbeitsblatt-zeitstrahl-title">
      <button
        type="button"
        className="arbeitsblatt-panel__head arbeitsblatt-panel__toggle"
        aria-expanded={!collapsed}
        aria-controls="arbeitsblatt-zeitstrahl-title-body"
        onClick={() => onTogglePanel("z")}
      >
        <span className={`arbeitsblatt-panel__chevron ${collapsed ? "is-collapsed" : ""}`} aria-hidden="true">
          ▾
        </span>
        <h3 id="arbeitsblatt-zeitstrahl-title">
          <span className="arbeitsblatt-panel__letter">Z</span>
          <span aria-hidden="true">·</span> Zeitstrahl
        </h3>
        <p className="arbeitsblatt-panel__hint">Die wichtigsten Meilensteine des Einsatzes auf einen Blick.</p>
      </button>

      {!collapsed && (
        <div className="zeitstrahl" id="arbeitsblatt-zeitstrahl-title-body">
          {eintraege.length === 0 ? (
            <p className="arbeitsblatt-empty">
              Noch keine Meilensteine — {writable ? "unten anlegen." : "von Schreibberechtigten anlegen lassen."}
            </p>
          ) : (
            <div className="zeitstrahl__track" role="list">
              {/* Linie + Jetzt-Markierung */}
              <div className="zeitstrahl__line" aria-hidden="true" />
              {jetztPosition !== null && (
                <div
                  className="zeitstrahl__now"
                  style={{ left: `${jetztPosition}%` }}
                  title={`Jetzt: ${jetzt.toLocaleDateString("de-DE")} ${jetzt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`}
                >
                  <span className="zeitstrahl__jetzt-badge">Jetzt</span>
                </div>
              )}
              {eintraege.map((eintrag, i) => {
                const pct = eintraege.length === 1 ? 50 : (i / (eintraege.length - 1)) * 100;
                return (
                  <div
                    className={`zeitstrahl__item zeitstrahl__item--${eintrag.kategorie}`}
                    key={eintrag.id}
                    style={{ left: `${pct}%` }}
                    onMouseEnter={() => setHovered(eintrag.id)}
                    onMouseLeave={() => setHovered((h) => (h === eintrag.id ? null : h))}
                  >
                    <span className="zeitstrahl__datum mono">
                      {fmtDatum(eintrag.datum)}
                      <br />
                      {eintrag.uhrzeit}
                    </span>
                    <button
                      className={`zeitstrahl__punkt ${hovered === eintrag.id ? "is-hovered" : ""}`}
                      type="button"
                      title={`${fmtDatum(eintrag.datum)} · ${eintrag.uhrzeit} — ${eintrag.titel}${eintrag.details ? `: ${eintrag.details}` : ""}${
                        writable ? " (Klicken zum Bearbeiten)" : ""
                      }`}
                      aria-label={`Meilenstein ${eintrag.titel}, ${fmtDatum(eintrag.datum)} ${eintrag.uhrzeit} (${eintrag.kategorie})${writable ? ", zum Bearbeiten Enter drücken" : ""}`}
                      onClick={() => writable && setDialog({ meilenstein: eintrag })}
                    />
                    <span className="zeitstrahl__titel">{eintrag.titel}</span>
                  </div>
                );
              })}
            </div>
          )}
          {writable && (
            <button
              className="zeitstrahl__add"
              type="button"
              onClick={() => setDialog({ meilenstein: {} })}
            >
              + Neuen Meilenstein hinzufügen
            </button>
          )}
        </div>
      )}

      {dialog.meilenstein !== null && (
        <MeilensteinDialog
          initial={dialog.meilenstein}
          writable={writable}
          onCancel={() => setDialog({ meilenstein: null })}
          onSave={(value) => {
            onUpsert(value);
            setDialog({ meilenstein: null });
          }}
          onDelete={
            dialog.meilenstein.id
              ? () => {
                  onDelete(dialog.meilenstein!.id!);
                  setDialog({ meilenstein: null });
                }
              : undefined
          }
        />
      )}
    </section>
  );
}

/** Der Anlegen-/Bearbeiten-Dialog (Datum*, Uhrzeit*, Titel*, Details optional). */
function MeilensteinDialog({
  initial,
  writable,
  onCancel,
  onSave,
  onDelete,
}: {
  initial: Partial<AbMeilenstein>;
  writable: boolean;
  onCancel: () => void;
  onSave: (value: Omit<AbMeilenstein, "id"> & { id?: string }) => void;
  onDelete?: () => void;
}) {
  const [datum, setDatum] = useState(initial.datum ?? "");
  const [uhrzeit, setUhrzeit] = useState(initial.uhrzeit ?? "");
  const [titel, setTitel] = useState(initial.titel ?? "");
  const [details, setDetails] = useState(initial.details ?? "");
  const gueltig = /^\d{4}-\d{2}-\d{2}$/.test(datum) && /^\d{2}:\d{2}$/.test(uhrzeit) && titel.trim().length > 0;
  return (
    <div className="zeitstrahl-dialog-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="zeitstrahl-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="zeitstrahl-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h4 id="zeitstrahl-dialog-title" className="zeitstrahl-dialog__title">
          {initial.id ? "Meilenstein bearbeiten" : "Neuen Meilenstein hinzufügen"}
        </h4>
        <div className="zeitstrahl-dialog__row">
          <label>
            <span>Datum *</span>
            <input type="date" value={datum} onChange={(e) => setDatum(e.currentTarget.value)} />
          </label>
          <label>
            <span>Uhrzeit *</span>
            <input type="time" value={uhrzeit} onChange={(e) => setUhrzeit(e.currentTarget.value)} />
          </label>
        </div>
        <label>
          <span>Meilenstein / Titel *</span>
          <input
            type="text"
            value={titel}
            placeholder="z. B. Einsatzbeginn"
            onChange={(e) => setTitel(e.currentTarget.value)}
          />
        </label>
        <label>
          <span>Details (optional)</span>
          <textarea value={details} rows={3} onChange={(e) => setDetails(e.currentTarget.value)} />
        </label>
        <div className="zeitstrahl-dialog__actions">
          {onDelete && writable && (
            <button className="btn btn--danger" type="button" onClick={onDelete}>
              Löschen
            </button>
          )}
          <span className="spacer" />
          <button className="btn btn--ghost" type="button" onClick={onCancel}>
            Abbrechen
          </button>
          <button
            className="btn btn--primary"
            type="button"
            disabled={!gueltig}
            onClick={() =>
              onSave({
                ...(initial.id ? { id: initial.id } : {}),
                datum,
                uhrzeit,
                titel: titel.trim(),
                details: details.trim() || undefined,
              })
            }
          >
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}