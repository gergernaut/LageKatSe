import { describe, expect, it } from "vitest";
import { formatDateTime } from "./format";

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
