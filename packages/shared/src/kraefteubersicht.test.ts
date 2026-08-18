import { describe, expect, it } from "vitest";
import {
  asCount,
  asKraftOrg,
  asKraftStatus,
  buildKraftEtbText,
  coerceVehicle,
  countByTyp,
  formatStaerke,
  KRAFT_EXPORT_FORMAT,
  parseKraftExport,
  sumStaerke,
  vehicleStaerke,
  type KraftVehicle,
} from "./kraefteubersicht";

function vehicle(partial: Partial<KraftVehicle> = {}): KraftVehicle {
  return {
    id: "v1",
    org: "FW",
    typ: "LF 20",
    funkrufname: "Florian 1/44/1",
    fuehrer: 1,
    unterfuehrer: 2,
    helfer: 6,
    status: "br",
    createdAt: "2026-08-18T10:00:00.000Z",
    updatedAt: "2026-08-18T10:00:00.000Z",
    ...partial,
  };
}

describe("Stärke (DV 100)", () => {
  it("Gesamt ist die Summe der drei Anteile", () => {
    expect(vehicleStaerke({ fuehrer: 1, unterfuehrer: 2, helfer: 6 })).toEqual({
      fuehrer: 1,
      unterfuehrer: 2,
      helfer: 6,
      gesamt: 9,
    });
  });

  it("summiert anteilsweise über mehrere Fahrzeuge", () => {
    const sum = sumStaerke([
      { fuehrer: 1, unterfuehrer: 2, helfer: 6 },
      { fuehrer: 0, unterfuehrer: 1, helfer: 2 },
    ]);
    expect(sum).toEqual({ fuehrer: 1, unterfuehrer: 3, helfer: 8, gesamt: 12 });
  });

  it("leere Liste ⇒ 0/0/0//0", () => {
    expect(formatStaerke(sumStaerke([]))).toBe("0/0/0//0");
  });

  it("formatiert in DV-100-Schreibweise", () => {
    expect(formatStaerke({ fuehrer: 1, unterfuehrer: 2, helfer: 9, gesamt: 12 })).toBe("1/2/9//12");
  });

  it("defensive Zählung: NaN/negativ/Kommazahl werden bereinigt", () => {
    expect(asCount(3)).toBe(3);
    expect(asCount(2.7)).toBe(2);
    expect(asCount(-4)).toBe(0);
    expect(asCount("5")).toBe(0);
    expect(asCount(Number.NaN)).toBe(0);
  });
});

describe("countByTyp", () => {
  it("zählt Fahrzeuge je Typ, trimmt und fasst Leere unter 'ohne Typ'", () => {
    expect(
      countByTyp([{ typ: "LF 20" }, { typ: "LF 20 " }, { typ: "RTW" }, { typ: "" }, { typ: "   " }]),
    ).toEqual({ "LF 20": 2, RTW: 1, "ohne Typ": 2 });
  });
});

describe("Org- und Status-Coercion", () => {
  it("akzeptiert bekannte Orgs, sonst 'Sonstige'", () => {
    expect(asKraftOrg("THW")).toBe("THW");
    expect(asKraftOrg("XYZ")).toBe("Sonstige");
    expect(asKraftOrg(undefined)).toBe("Sonstige");
  });

  it("Status ist 'einsatz' nur bei exaktem Wert, sonst 'br'", () => {
    expect(asKraftStatus("einsatz")).toBe("einsatz");
    expect(asKraftStatus("br")).toBe("br");
    expect(asKraftStatus("irgendwas")).toBe("br");
  });
});

describe("buildKraftEtbText", () => {
  it("beschreibt das Verschieben in den Einsatz mit Org-Label, Typ und Stärke", () => {
    const text = buildKraftEtbText(vehicle(), "toEinsatz");
    expect(text).toBe("Kräfte in den Einsatz: Florian 1/44/1 (Feuerwehr, LF 20) — Stärke 1/2/6//9");
  });

  it("nennt beim Entlassen die Ursprungstabelle", () => {
    const text = buildKraftEtbText(vehicle({ status: "einsatz" }), "entlassen");
    expect(text).toContain("Kräfte entlassen (aus Im Einsatz):");
  });

  it("fällt bei fehlendem Funkrufnamen/Typ nicht um", () => {
    const text = buildKraftEtbText(vehicle({ funkrufname: "  ", typ: "" }), "toBr");
    expect(text).toBe("Kräfte zurück in den Bereitstellungsraum: (ohne Funkrufname) (Feuerwehr) — Stärke 1/2/6//9");
  });
});

describe("parseKraftExport / coerceVehicle", () => {
  let counter = 0;
  const fallbackId = () => `gen-${++counter}`;

  it("lehnt ein falsches Format ab", () => {
    expect(parseKraftExport({ format: "x", vehicles: [] }, fallbackId)).toBeNull();
    expect(parseKraftExport({ format: KRAFT_EXPORT_FORMAT }, fallbackId)).toBeNull();
    expect(parseKraftExport(null, fallbackId)).toBeNull();
  });

  it("coerct Fremdzeilen defensiv und vergibt fehlende IDs", () => {
    const rows = parseKraftExport(
      {
        format: KRAFT_EXPORT_FORMAT,
        version: 1,
        exportedAt: "2026-08-18T10:00:00.000Z",
        vehicles: [
          { org: "RD", typ: "RTW", funkrufname: "Rotkreuz 1", fuehrer: 0, unterfuehrer: 1, helfer: 1, status: "einsatz" },
          { org: "Quatsch", fuehrer: -3, helfer: 2.9, status: "unknown" },
        ],
      },
      fallbackId,
    );
    expect(rows).not.toBeNull();
    expect(rows).toHaveLength(2);
    expect(rows?.[0].org).toBe("RD");
    expect(rows?.[0].status).toBe("einsatz");
    expect(rows?.[0].id).toMatch(/^gen-/); // hatte keine eigene id
    expect(rows?.[1].org).toBe("Sonstige"); // unbekannt → Sonstige
    expect(rows?.[1].fuehrer).toBe(0); // negativ → 0
    expect(rows?.[1].helfer).toBe(2); // 2.9 → 2
    expect(rows?.[1].status).toBe("br"); // unbekannt → br
  });

  it("behält vorhandene IDs bei", () => {
    const row = coerceVehicle({ id: "keep-me", org: "FW" }, fallbackId);
    expect(row.id).toBe("keep-me");
  });
});
