import { describe, expect, it } from "vitest";
import { formatDistance } from "./distance";

// Mess-Tool (#175): Distanz-Formatierung. Leaflets map.distance() liefert Meter;
// hier wird nur die menschenlesbare Aufbereitung geprüft.
describe("formatDistance", () => {
  it("kleine Distanzen in Metern (gerundet)", () => {
    expect(formatDistance(450)).toBe("450 m");
    expect(formatDistance(0)).toBe("0 m");
    expect(formatDistance(999.4)).toBe("999 m");
  });

  it("ab 1 km in Kilometern mit einer Nachkommastelle (deutsches Komma)", () => {
    expect(formatDistance(2340)).toBe("2,3 km");
    expect(formatDistance(1000)).toBe("1,0 km");
    expect(formatDistance(12345)).toBe("12,3 km");
  });

  it("ungültige Werte → leerer String", () => {
    expect(formatDistance(-5)).toBe("");
    expect(formatDistance(NaN)).toBe("");
    expect(formatDistance(Infinity)).toBe("");
  });
});
