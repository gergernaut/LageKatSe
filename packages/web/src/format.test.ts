import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, spansMultipleDays } from "./format";

// Hinweis: formatDateTime rendert in *lokaler* Zeit. Um TZ-Flakiness zu vermeiden,
// werden ISO-Strings OHNE Zonen-Suffix genutzt — die parst Date als lokale Zeit,
// die Feldwerte bleiben also unabhängig von der CI-Zeitzone stabil.
describe("formatDateTime", () => {
  it("formatiert als YYYY-MM-DD HH:MM", () => {
    expect(formatDateTime("2026-08-03T17:48:00")).toBe("2026-08-03 17:48");
  });

  it("füllt Monat/Tag/Stunde/Minute auf zwei Stellen auf", () => {
    expect(formatDateTime("2026-01-05T04:09:00")).toBe("2026-01-05 04:09");
  });

  it("gibt bei ungültiger Eingabe \"\" zurück (statt NaN-Text)", () => {
    expect(formatDateTime("kein-datum")).toBe("");
    expect(formatDateTime("")).toBe("");
  });
});

describe("formatDate", () => {
  it("formatiert als DD.MM.YYYY (deutsch), zweistellig aufgefüllt", () => {
    expect(formatDate("2026-09-21T14:30:00")).toBe("21.09.2026");
    expect(formatDate("2026-01-05T04:09:00")).toBe("05.01.2026");
  });

  it("gibt bei ungültiger Eingabe \"\" zurück", () => {
    expect(formatDate("kein-datum")).toBe("");
    expect(formatDate("")).toBe("");
  });
});

describe("spansMultipleDays", () => {
  it("false bei leerer Menge oder einem einzigen Tag", () => {
    expect(spansMultipleDays([])).toBe(false);
    expect(spansMultipleDays(["2026-09-21T08:00:00", "2026-09-21T23:59:00"])).toBe(false);
  });

  it("true, sobald zwei verschiedene Kalendertage vorkommen", () => {
    expect(spansMultipleDays(["2026-09-21T23:59:00", "2026-09-22T00:01:00"])).toBe(true);
  });

  it("ignoriert ungültige Zeitstempel", () => {
    expect(spansMultipleDays(["kein-datum", "2026-09-21T10:00:00", ""])).toBe(false);
  });
});
