import { describe, expect, it } from "vitest";
import { radarColor } from "./brightskyRadar";

// Reine Farbrampe des Bright-Sky-Radars (0,01 mm/5 min → RGBA). Nur die Logik
// (Schwellen, Transparenz) wird getestet; Reprojektion/Fetch brauchen DOM/Netz.
describe("radarColor", () => {
  it("0, negativ und Nodata-Clutter (>1000) sind vollständig transparent", () => {
    expect(radarColor(0)[3]).toBe(0);
    expect(radarColor(-5)[3]).toBe(0);
    expect(radarColor(65535)[3]).toBe(0); // typischer Uint16-Nodata-Wert
  });

  it("Regen ist sichtbar (Alpha > 0) und wird mit der Intensität deckender", () => {
    const leicht = radarColor(5);
    const stark = radarColor(150);
    expect(leicht[3]).toBeGreaterThan(0);
    expect(stark[3]).toBeGreaterThan(leicht[3]);
  });

  it("leichter Regen ist bläulich, starke Zellen warm (rot dominiert)", () => {
    const leicht = radarColor(5);
    expect(leicht[2]).toBeGreaterThan(leicht[0]); // Blau > Rot
    const stark = radarColor(240);
    expect(stark[0]).toBeGreaterThan(stark[2]); // Rot > Blau
  });

  it("Deckkraft ist auf 0,8 (204) gedeckelt", () => {
    expect(radarColor(250)[3]).toBe(Math.round(0.8 * 255));
  });
});
