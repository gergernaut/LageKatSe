import { describe, expect, it } from "vitest";
import { asEaTyp, coerceEinsatzabschnitt, formatAbschnittTitel } from "./einsatzabschnitte";

// Reine Logik des Einsatzabschnitte-Modells (#133/#135): Typ-Coercion, Anzeigetitel
// und die defensive Fremd-Zeilen-Coercion für den (späteren) Import.
describe("Einsatzabschnitte-Modell", () => {
  describe("asEaTyp", () => {
    it("akzeptiert EA/UA, alles andere fällt auf EA", () => {
      expect(asEaTyp("EA")).toBe("EA");
      expect(asEaTyp("UA")).toBe("UA");
      expect(asEaTyp("ea")).toBe("EA"); // case-sensitiv, sonst Default
      expect(asEaTyp("")).toBe("EA");
      expect(asEaTyp(null)).toBe("EA");
      expect(asEaTyp(42)).toBe("EA");
    });
  });

  describe("formatAbschnittTitel", () => {
    it("kombiniert Typ + Titel", () => {
      expect(formatAbschnittTitel({ typ: "EA", titel: "A" })).toBe("EA A");
      expect(formatAbschnittTitel({ typ: "UA", titel: "B1" })).toBe("UA B1");
    });
    it("ohne Titel bleibt nur der Typ (getrimmt)", () => {
      expect(formatAbschnittTitel({ typ: "EA", titel: "" })).toBe("EA");
    });
  });

  describe("coerceEinsatzabschnitt", () => {
    it("übernimmt gültige Felder und behält die id", () => {
      const a = coerceEinsatzabschnitt(
        {
          id: "ea1",
          typ: "UA",
          titel: "Nord",
          befehlsstelle: "FW 1",
          leiter: "ZF",
          kommunikation: "Florian 1",
          auftrag: "Riegelstellung",
          einsatzbeginn: "260918Aug26",
          createdAt: "2026-08-26T09:18:00.000Z",
        },
        () => "fallback",
      );
      expect(a).toEqual({
        id: "ea1",
        typ: "UA",
        titel: "Nord",
        befehlsstelle: "FW 1",
        leiter: "ZF",
        kommunikation: "Florian 1",
        auftrag: "Riegelstellung",
        einsatzbeginn: "260918Aug26",
        createdAt: "2026-08-26T09:18:00.000Z",
      });
    });

    it("fällt bei fehlenden/defekten Feldern auf sichere Defaults (nie werfen)", () => {
      const a = coerceEinsatzabschnitt({ titel: 42, typ: "quatsch" }, () => "gen-id");
      expect(a.id).toBe("gen-id"); // keine id → fallback
      expect(a.typ).toBe("EA"); // ungültiger Typ → Default
      expect(a.titel).toBe(""); // Nicht-String → ""
      expect(a.befehlsstelle).toBe("");
      expect(a.einsatzbeginn).toBe("");
    });

    it("nicht-Objekt liefert einen leeren Abschnitt mit fallback-id", () => {
      const a = coerceEinsatzabschnitt(null, () => "x");
      expect(a.id).toBe("x");
      expect(a.typ).toBe("EA");
    });
  });
});
