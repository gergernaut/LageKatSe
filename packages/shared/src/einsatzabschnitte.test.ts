import { describe, expect, it } from "vitest";
import {
  abschnittKraft,
  asEaTyp,
  buildEaEtbEntry,
  coerceBereitstellung,
  coerceEaListItem,
  coerceEaListItems,
  coerceEinsatzabschnitt,
  coerceFuehrung,
  EA_EXPORT_FORMAT,
  formatAbschnittTitel,
  parseBereitstellungExport,
  parseEinsatzabschnitteExport,
  parseFuehrungAuftraegeExport,
  parseFuehrungExport,
  unassignedEinsatzVehicles,
  vehiclesInAbschnitt,
} from "./einsatzabschnitte";
import type { KraftVehicle } from "./kraefteubersicht";

// Fahrzeug-Stub: nur die für die Ableitung relevanten Felder müssen stimmen.
function veh(part: Partial<KraftVehicle>): KraftVehicle {
  return {
    id: "v",
    org: "FW",
    typ: "",
    funkrufname: "",
    fuehrer: 0,
    unterfuehrer: 0,
    helfer: 0,
    status: "einsatz",
    createdAt: "",
    updatedAt: "",
    ...part,
  };
}

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
        auftraege: [],
        rueckmeldungen: [],
        anforderungen: [],
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

  // Kräfte-Ableitung je Abschnitt (#138/#140) — Feld C der Übersicht und das
  // Einsatzabschnitte-Modul teilen sich diese reinen Helfer, müssen also gleich zählen.
  describe("vehiclesInAbschnitt / abschnittKraft / unassignedEinsatzVehicles", () => {
    const fleet: KraftVehicle[] = [
      veh({ id: "a", status: "einsatz", einsatzabschnittId: "N", fuehrer: 1, unterfuehrer: 0, helfer: 5 }),
      veh({ id: "b", status: "einsatz", einsatzabschnittId: "N", fuehrer: 0, unterfuehrer: 1, helfer: 2 }),
      veh({ id: "c", status: "einsatz", einsatzabschnittId: "S", fuehrer: 1, unterfuehrer: 1, helfer: 8 }),
      veh({ id: "d", status: "einsatz" }), // im Einsatz, unzugeordnet
      veh({ id: "e", status: "br", einsatzabschnittId: "N", fuehrer: 9 }), // im BR → zählt NIE mit
    ];

    it("zählt nur Einsatz-Fahrzeuge des Abschnitts (BR bleibt außen vor)", () => {
      expect(vehiclesInAbschnitt(fleet, "N").map((v) => v.id)).toEqual(["a", "b"]);
      expect(vehiclesInAbschnitt(fleet, "S").map((v) => v.id)).toEqual(["c"]);
    });

    it("summiert die DV-100-Stärke je Abschnitt", () => {
      expect(abschnittKraft(fleet, "N")).toEqual({
        staerke: { fuehrer: 1, unterfuehrer: 1, helfer: 7, gesamt: 9 },
        count: 2,
      });
      expect(abschnittKraft(fleet, "S")).toEqual({
        staerke: { fuehrer: 1, unterfuehrer: 1, helfer: 8, gesamt: 10 },
        count: 1,
      });
    });

    it("unbekannter Abschnitt → leere Stärke, count 0", () => {
      expect(abschnittKraft(fleet, "gibtsnicht")).toEqual({
        staerke: { fuehrer: 0, unterfuehrer: 0, helfer: 0, gesamt: 0 },
        count: 0,
      });
    });

    it("unassignedEinsatzVehicles: nur Einsatz-Fahrzeuge ohne Zuordnung", () => {
      expect(unassignedEinsatzVehicles(fleet).map((v) => v.id)).toEqual(["d"]);
    });
  });

  describe("parseEinsatzabschnitteExport", () => {
    const envelope = (abschnitte: unknown[]) => ({
      format: EA_EXPORT_FORMAT,
      version: 1,
      exportedAt: "2026-08-27T00:00:00.000Z",
      abschnitte,
    });

    it("erhält die id (Fahrzeug-Zuordnung bleibt nach dem Import gültig)", () => {
      const rows = parseEinsatzabschnitteExport(envelope([{ id: "N", typ: "EA", titel: "Nord" }]), () => "gen");
      expect(rows).not.toBeNull();
      expect(rows?.[0].id).toBe("N");
      expect(rows?.[0].titel).toBe("Nord");
    });

    it("vergibt fallback-id für Zeilen ohne eigene", () => {
      const rows = parseEinsatzabschnitteExport(envelope([{ typ: "UA", titel: "X" }]), () => "gen");
      expect(rows?.[0].id).toBe("gen");
    });

    it("falsches Format/Struktur → null", () => {
      expect(parseEinsatzabschnitteExport({ format: "fremd", abschnitte: [] }, () => "x")).toBeNull();
      expect(parseEinsatzabschnitteExport({ format: EA_EXPORT_FORMAT }, () => "x")).toBeNull();
      expect(parseEinsatzabschnitteExport(null, () => "x")).toBeNull();
    });
  });

  // Abhakbare Listen (#161)
  describe("coerceEaListItem / coerceEaListItems", () => {
    it("übernimmt Text + erledigt, behält die id", () => {
      expect(coerceEaListItem({ id: "i1", text: "Riegel legen", erledigt: true }, () => "gen")).toEqual({
        id: "i1",
        text: "Riegel legen",
        erledigt: true,
      });
    });

    it("erledigt ist nur bei echtem true wahr; fehlende id → fallback", () => {
      expect(coerceEaListItem({ text: "x", erledigt: "ja" }, () => "gen")).toEqual({
        id: "gen",
        text: "x",
        erledigt: false,
      });
    });

    it("createdAt + uebermittelt (#180): übernommen wenn gültig, sonst weggelassen", () => {
      expect(
        coerceEaListItem(
          { id: "i2", text: "x", erledigt: false, createdAt: "2026-09-02T10:00:00.000Z", uebermittelt: true },
          () => "gen",
        ),
      ).toEqual({ id: "i2", text: "x", erledigt: false, createdAt: "2026-09-02T10:00:00.000Z", uebermittelt: true });
      // Alte Zeile ohne die neuen Felder → sie fehlen (kein künstlicher Zeitstempel).
      const old = coerceEaListItem({ id: "i3", text: "y", erledigt: false }, () => "gen");
      expect(old).toEqual({ id: "i3", text: "y", erledigt: false });
      expect("createdAt" in old).toBe(false);
      expect("uebermittelt" in old).toBe(false);
      // Defekte Werte werden verworfen (uebermittelt nur bei echtem true, createdAt nur String).
      expect(
        coerceEaListItem({ id: "i4", text: "z", erledigt: false, uebermittelt: "ja", createdAt: 42 }, () => "gen"),
      ).toEqual({ id: "i4", text: "z", erledigt: false });
    });

    it("coerceEaListItems: Nicht-Array → [], sonst zeilenweise coerct", () => {
      expect(coerceEaListItems(undefined, () => "x")).toEqual([]);
      expect(coerceEaListItems([{ text: "a" }, "müll"], () => "gen").map((i) => i.text)).toEqual(["a", ""]);
    });

    it("coerceEinsatzabschnitt zieht die drei Listen mit (fehlend → [])", () => {
      const a = coerceEinsatzabschnitt(
        { id: "ea1", auftraege: [{ id: "a1", text: "T", erledigt: true }] },
        () => "gen",
      );
      expect(a.auftraege).toEqual([{ id: "a1", text: "T", erledigt: true }]);
      expect(a.rueckmeldungen).toEqual([]);
      expect(a.anforderungen).toEqual([]);
    });
  });

  // ETB-Sync (#162)
  describe("buildEaEtbEntry", () => {
    it("Rückmeldung: Richtung E, Von = Abschnittstitel, Inhalt mit Einzahl-Label", () => {
      expect(buildEaEtbEntry({ typ: "EA", titel: "Nord" }, "rueckmeldungen", "Lage stabil")).toEqual({
        richtung: "E",
        von: "EA Nord",
        inhalt: "Rückmeldung: Lage stabil",
      });
    });
    it("Anforderung + UA-Titel; Text wird getrimmt", () => {
      expect(buildEaEtbEntry({ typ: "UA", titel: "1" }, "anforderungen", "  2x Rüstwagen  ")).toEqual({
        richtung: "E",
        von: "UA 1",
        inhalt: "Anforderung: 2x Rüstwagen",
      });
    });
    it("ohne Titel → Fallback-Von", () => {
      expect(buildEaEtbEntry({ typ: "EA", titel: "" }, "rueckmeldungen", "x").von).toBe("EA");
    });
  });

  // Führungs-Singleton (#154)
  describe("coerceFuehrung / parseFuehrungExport", () => {
    it("übernimmt gültige Felder", () => {
      expect(
        coerceFuehrung({ fuehrer: "EL", befehlsstelle: "FüKW", kommunikation: "Florian 10", standort: "RH" }),
      ).toEqual({ fuehrer: "EL", befehlsstelle: "FüKW", kommunikation: "Florian 10", standort: "RH" });
    });

    it("defekte/fehlende Felder → leere Strings (nie werfen)", () => {
      expect(coerceFuehrung({ fuehrer: 42 })).toEqual({ fuehrer: "", befehlsstelle: "", kommunikation: "", standort: "" });
      expect(coerceFuehrung(null)).toEqual({ fuehrer: "", befehlsstelle: "", kommunikation: "", standort: "" });
    });

    it("parseFuehrungExport liest das Feld aus dem Envelope, fehlt es → leer", () => {
      expect(
        parseFuehrungExport({ format: EA_EXPORT_FORMAT, abschnitte: [], fuehrung: { fuehrer: "EL" } }).fuehrer,
      ).toBe("EL");
      // Ältere Datei ohne fuehrung-Feld bleibt gültig → leere Führung.
      expect(parseFuehrungExport({ format: EA_EXPORT_FORMAT, abschnitte: [] })).toEqual({
        fuehrer: "",
        befehlsstelle: "",
        kommunikation: "",
        standort: "",
      });
    });
  });

  // Auftrags-Liste der Führung (#177)
  describe("parseFuehrungAuftraegeExport", () => {
    it("liest die Liste verlustfrei aus dem Envelope (IDs erhalten)", () => {
      const items = [
        { id: "a1", text: "Lagefeststellung 12:00", erledigt: false },
        { id: "a2", text: "Nachforderungen bündeln", erledigt: true },
      ];
      expect(parseFuehrungAuftraegeExport({ format: EA_EXPORT_FORMAT, fuehrungAuftraege: items }, () => "gen")).toEqual(
        items,
      );
    });

    it("fehlt das Feld (ältere Datei) → leere Liste (nie werfen)", () => {
      expect(parseFuehrungAuftraegeExport({ format: EA_EXPORT_FORMAT, abschnitte: [] }, () => "gen")).toEqual([]);
      expect(parseFuehrungAuftraegeExport(null, () => "gen")).toEqual([]);
    });

    it("defekte Zeilen werden coerct (nie geworfen); Nicht-Array → []", () => {
      const out = parseFuehrungAuftraegeExport(
        { fuehrungAuftraege: [{ text: "x" }, "müll", { text: "y", erledigt: "ja" }] },
        () => "gen",
      );
      // "müll" wird zu einer Zeile mit leerem Text coerct (nicht übersprungen).
      expect(out.map((i) => ({ text: i.text, erledigt: i.erledigt }))).toEqual([
        { text: "x", erledigt: false },
        { text: "", erledigt: false },
        { text: "y", erledigt: false },
      ]);
      expect(parseFuehrungAuftraegeExport({ fuehrungAuftraege: "kein Array" }, () => "gen")).toEqual([]);
    });
  });

  // Bereitstellungsraum-Singleton (#180)
  describe("coerceBereitstellung / parseBereitstellungExport", () => {
    it("übernimmt Felder + drei Listen; fehlend → leere Defaults", () => {
      const br = coerceBereitstellung(
        {
          befehlsstelle: "ELW 1",
          leiter: "ZF Meier",
          kommunikation: "Kanal 4",
          auftrag: "Kräfte sammeln",
          einsatzbeginn: "021200Sep26",
          auftraege: [{ id: "a1", text: "Verpflegung", erledigt: false }],
        },
        () => "gen",
      );
      expect(br).toEqual({
        befehlsstelle: "ELW 1",
        leiter: "ZF Meier",
        kommunikation: "Kanal 4",
        auftrag: "Kräfte sammeln",
        einsatzbeginn: "021200Sep26",
        auftraege: [{ id: "a1", text: "Verpflegung", erledigt: false }],
        rueckmeldungen: [],
        anforderungen: [],
      });
    });

    it("nicht-Objekt → leerer Bereitstellungsraum (nie werfen)", () => {
      expect(coerceBereitstellung(null, () => "x")).toEqual({
        befehlsstelle: "",
        leiter: "",
        kommunikation: "",
        auftrag: "",
        einsatzbeginn: "",
        auftraege: [],
        rueckmeldungen: [],
        anforderungen: [],
      });
    });

    it("parseBereitstellungExport: liest payload.bereitstellung; fehlt → leer", () => {
      expect(
        parseBereitstellungExport({ format: EA_EXPORT_FORMAT, bereitstellung: { leiter: "X" } }, () => "gen").leiter,
      ).toBe("X");
      expect(parseBereitstellungExport({ format: EA_EXPORT_FORMAT }, () => "gen").leiter).toBe("");
      expect(parseBereitstellungExport(null, () => "gen").auftraege).toEqual([]);
    });
  });
});
