import { describe, expect, it } from "vitest";
import { dug } from "./dug";

// dug baut aus einem Date die Datum-Uhrzeit-Gruppe DDHHMMmmmyy (lokale Zeit).
// Explizite Date-Objekte (lokale Komponenten) halten die Tests TZ-unabhängig.
describe("dug", () => {
  it("baut DDHHMMmmmyy aus den lokalen Datumsteilen", () => {
    // 03. Aug 2026, 17:48
    expect(dug(new Date(2026, 7, 3, 17, 48))).toBe("031748Aug26");
  });

  it("füllt Tag/Stunde/Minute auf zwei Stellen auf", () => {
    // 05. Jan 2026, 04:09
    expect(dug(new Date(2026, 0, 5, 4, 9))).toBe("050409Jan26");
  });

  it("nutzt das englische 3-Buchstaben-Monatskürzel und die letzten 2 Jahresziffern", () => {
    // 31. Dez 2025, 23:59
    expect(dug(new Date(2025, 11, 31, 23, 59))).toBe("312359Dec25");
  });
});
