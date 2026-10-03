import { describe, expect, it } from "vitest";
import { ETB_LOCK_MS, isEtbEntryLocked, type LogEntry } from "./etb";

// Soft-Sperre der ETB-Inhaltsspalten (#237) — reiner Helfer, nowMs reicht der Aufrufer.
describe("isEtbEntryLocked (#237)", () => {
  const base = "2026-10-03T12:00:00.000Z";
  const baseMs = Date.parse(base);
  const entry = (p: Partial<LogEntry>): Pick<LogEntry, "zeit" | "lastEditedAt" | "auto"> => ({
    zeit: base,
    ...p,
  });

  it("frisch angelegt → innerhalb der Frist editierbar (nicht gesperrt)", () => {
    expect(isEtbEntryLocked(entry({}), baseMs + 60_000)).toBe(false); // 1 Min < 2 Min
  });

  it("nach Ablauf der Frist gesperrt", () => {
    expect(isEtbEntryLocked(entry({}), baseMs + ETB_LOCK_MS + 1)).toBe(true);
  });

  it("die letzte Bearbeitung setzt die Frist neu (lastEditedAt vor zeit)", () => {
    // zeit ist alt, aber gerade erst bearbeitet → noch offen.
    const later = baseMs + 10 * 60_000;
    const e = entry({ lastEditedAt: new Date(later).toISOString() });
    expect(isEtbEntryLocked(e, later + 30_000)).toBe(false);
    expect(isEtbEntryLocked(e, later + ETB_LOCK_MS + 1)).toBe(true);
  });

  it("Auto-Einträge (#226) sind sofort gesperrt — unabhängig von der Zeit", () => {
    expect(isEtbEntryLocked(entry({ auto: true }), baseMs)).toBe(true);
    expect(isEtbEntryLocked(entry({ auto: true }), baseMs + 1)).toBe(true);
  });

  it("unparsebare Zeit → defensiv nicht sperren (kein versehentliches Bricken)", () => {
    expect(isEtbEntryLocked({ zeit: "kein-datum" }, baseMs + 999_999)).toBe(false);
  });

  it("eigenes Fenster nutzbar (windowMs-Parameter)", () => {
    expect(isEtbEntryLocked(entry({}), baseMs + 90_000, 60_000)).toBe(true); // 90s > 60s
    expect(isEtbEntryLocked(entry({}), baseMs + 30_000, 60_000)).toBe(false);
  });
});
