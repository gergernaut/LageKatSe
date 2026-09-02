import { describe, expect, it } from "vitest";
import { asBool, asString, coerceAbMassnahme, isRecord } from "./arbeitsblatt";

// Diese Coercions härten den JSON-Import gegen beliebige Fremddateien ab
// (§10.4, später Bundle-Import #71). Der Vertrag: nie werfen, immer auf einen
// sicheren Default fallen.
describe("Import-Coercion", () => {
  describe("asString", () => {
    it("reicht Strings durch, ersetzt alles andere durch \"\"", () => {
      expect(asString("hallo")).toBe("hallo");
      expect(asString("")).toBe("");
      expect(asString(42)).toBe("");
      expect(asString(null)).toBe("");
      expect(asString(undefined)).toBe("");
      expect(asString({})).toBe("");
      expect(asString(["x"])).toBe("");
    });
  });

  describe("asBool", () => {
    it("ist nur für exakt true wahr (keine truthy-Coercion)", () => {
      expect(asBool(true)).toBe(true);
      expect(asBool(false)).toBe(false);
      expect(asBool("true")).toBe(false);
      expect(asBool(1)).toBe(false);
      expect(asBool(null)).toBe(false);
      expect(asBool(undefined)).toBe(false);
    });
  });

  describe("isRecord", () => {
    it("ist wahr für Objekte, falsch für null/Primitive", () => {
      expect(isRecord({})).toBe(true);
      expect(isRecord({ a: 1 })).toBe(true);
      expect(isRecord(null)).toBe(false);
      expect(isRecord("x")).toBe(false);
      expect(isRecord(5)).toBe(false);
      expect(isRecord(undefined)).toBe(false);
    });

    it("ist auch für Arrays wahr (typeof-Quirk) — Aufrufer prüfen Arrays separat via Array.isArray", () => {
      expect(isRecord([])).toBe(true);
    });
  });

  // Feld D (#163): Maßnahmen je Führungs-Auftrag
  describe("coerceAbMassnahme", () => {
    it("übernimmt massnahmen + laufenderVorgang, defekt → sichere Defaults", () => {
      expect(coerceAbMassnahme({ massnahmen: "Riegel legen", laufenderVorgang: true })).toEqual({
        massnahmen: "Riegel legen",
        laufenderVorgang: true,
      });
      expect(coerceAbMassnahme({ massnahmen: 42, laufenderVorgang: "ja" })).toEqual({
        massnahmen: "",
        laufenderVorgang: false,
      });
      expect(coerceAbMassnahme(null)).toEqual({ massnahmen: "", laufenderVorgang: false });
    });
  });
});
