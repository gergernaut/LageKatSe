import { describe, expect, it } from "vitest";
import {
  asBool,
  asString,
  coerceAbMassnahme,
  coerceMeilenstein,
  coerceMeilensteine,
  isRecord,
  kategorisiereMeilensteine,
  meilensteinSortKey,
  type AbMeilenstein,
} from "./arbeitsblatt";

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

  // Zeitstrahl (#208)
  describe("coerceMeilenstein", () => {
    it("übernimmt gültige Felder, Details optional", () => {
      expect(
        coerceMeilenstein(
          { id: "m1", datum: "2027-02-12", uhrzeit: "09:00", titel: "Einsatzbeginn", details: "Details" },
          () => "gen",
        ),
      ).toEqual({ id: "m1", datum: "2027-02-12", uhrzeit: "09:00", titel: "Einsatzbeginn", details: "Details" });
      expect(coerceMeilenstein({ datum: "2027-02-12", uhrzeit: "09:00", titel: "x" }, () => "gen").details).toBeUndefined();
    });

    it("fehlerhaftes Format → leere Strings, fehlende id → fallbackId (nie werfen)", () => {
      const out = coerceMeilenstein({ datum: "12.02.2027", uhrzeit: "9 Uhr", titel: 42 }, () => "gen");
      expect(out).toEqual({ id: "gen", datum: "", uhrzeit: "", titel: "", details: undefined });
      expect(coerceMeilenstein(null, () => "gen").id).toBe("gen");
    });

    it("coerceMeilensteine: fehlend/defekt → []", () => {
      expect(coerceMeilensteine(undefined, () => "gen")).toEqual([]);
      expect(coerceMeilensteine("müll", () => "gen")).toEqual([]);
      expect(coerceMeilensteine([null, { datum: "2027-02-12", uhrzeit: "10:00", titel: "x" }], () => "gen")).toHaveLength(2);
    });
  });

  describe("meilensteinSortKey + kategorisiereMeilensteine", () => {
    const m = (datum: string, uhrzeit: string, titel: string): AbMeilenstein => ({ id: titel, datum, uhrzeit, titel });
    // Fixe "Jetzt"-Zeit: 12.02.2027 14:00
    const jetzt = new Date("2027-02-12T14:00:00");

    it("SortKey ist lexicografisch chronologisch", () => {
      expect(meilensteinSortKey({ datum: "2027-02-12", uhrzeit: "09:00" })).toBe("2027-02-12T09:00");
      expect(
        meilensteinSortKey({ datum: "2027-02-13", uhrzeit: "01:00" }) >
          meilensteinSortKey({ datum: "2027-02-12", uhrzeit: "23:00" }),
      ).toBe(true);
    });

    it("kategorisiert vergangen/aktuell/naechstes/geplant korrekt", () => {
      const liste = [
        m("2027-02-12", "09:00", "A"),
        m("2027-02-12", "12:00", "B"),
        m("2027-02-12", "14:00", "C"),
        m("2027-02-12", "15:00", "D"),
        m("2027-02-12", "20:00", "E"),
      ];
      const out = kategorisiereMeilensteine(liste, jetzt);
      expect(out.map((x) => x.kategorie)).toEqual(["vergangen", "vergangen", "aktuell", "naechstes", "geplant"]);
    });

    it("alle in der Zukunft → keiner ist aktuell/vergangen", () => {
      const liste = [m("2027-02-12", "15:00", "D"), m("2027-02-12", "20:00", "E")];
      const out = kategorisiereMeilensteine(liste, jetzt);
      expect(out.map((x) => x.kategorie)).toEqual(["naechstes", "geplant"]);
    });

    it("alle vergangen → letzter ist aktuell, keine naechstes/geplant", () => {
      const liste = [m("2027-02-12", "09:00", "A"), m("2027-02-12", "12:00", "B")];
      const out = kategorisiereMeilensteine(liste, jetzt);
      expect(out.map((x) => x.kategorie)).toEqual(["vergangen", "aktuell"]);
    });

    it("leere Liste → leer", () => {
      expect(kategorisiereMeilensteine([], jetzt)).toEqual([]);
    });
  });
});
