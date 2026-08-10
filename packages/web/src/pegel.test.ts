import { describe, expect, it } from "vitest";
import { coercePegelStations, pegelStatusColor, PEGEL_STATUS_LABEL, type PegelState } from "./pegel";

// Rohform wie von PEGELONLINE (stations.json?includeCurrentMeasurement&includeTimeseries).
const station = (over: Record<string, unknown> = {}) => ({
  uuid: "u1",
  longname: "CELLE",
  latitude: 52.62,
  longitude: 10.06,
  water: { shortname: "ALLER", longname: "ALLER" },
  timeseries: [
    {
      shortname: "W",
      unit: "cm",
      currentMeasurement: { timestamp: "2026-08-10T11:00:00+02:00", value: 122, stateMnwMhw: "normal" },
    },
  ],
  ...over,
});

describe("coercePegelStations", () => {
  it("mappt eine gültige Station auf das schlanke Format", () => {
    const [p] = coercePegelStations([station()]);
    expect(p).toEqual({
      uuid: "u1",
      name: "CELLE",
      water: "ALLER",
      lat: 52.62,
      lon: 10.06,
      value: 122,
      unit: "cm",
      timestamp: "2026-08-10T11:00:00+02:00",
      state: "normal",
    });
  });

  it("überspringt Stationen ohne Koordinaten", () => {
    expect(coercePegelStations([station({ latitude: null })])).toEqual([]);
    expect(coercePegelStations([station({ longitude: "x" })])).toEqual([]);
  });

  it("überspringt Stationen ohne W-Zeitreihe mit gültigem Messwert", () => {
    // nur eine Q-Zeitreihe (Abfluss), kein Wasserstand
    const q = station({ timeseries: [{ shortname: "Q", unit: "m³/s", currentMeasurement: { value: 5 } }] });
    expect(coercePegelStations([q])).toEqual([]);
    // W ohne currentMeasurement
    const noCm = station({ timeseries: [{ shortname: "W", unit: "cm" }] });
    expect(coercePegelStations([noCm])).toEqual([]);
    // W mit nicht-numerischem value
    const badVal = station({ timeseries: [{ shortname: "W", unit: "cm", currentMeasurement: { value: "hoch" } }] });
    expect(coercePegelStations([badVal])).toEqual([]);
  });

  it("nimmt die W-Zeitreihe auch wenn eine andere zuerst steht", () => {
    const s = station({
      timeseries: [
        { shortname: "Q", unit: "m³/s", currentMeasurement: { value: 5 } },
        { shortname: "W", unit: "cm", currentMeasurement: { value: 88, stateMnwMhw: "low" } },
      ],
    });
    const [p] = coercePegelStations([s]);
    expect(p.value).toBe(88);
    expect(p.state).toBe("low");
  });

  it("unbekannte/fehlende stateMnwMhw fallen auf \"unknown\"", () => {
    const s = station({ timeseries: [{ shortname: "W", unit: "cm", currentMeasurement: { value: 1, stateMnwMhw: "quatsch" } }] });
    expect(coercePegelStations([s])[0].state).toBe("unknown");
    const s2 = station({ timeseries: [{ shortname: "W", unit: "cm", currentMeasurement: { value: 1 } }] });
    expect(coercePegelStations([s2])[0].state).toBe("unknown");
  });

  it("ist robust gegen Nicht-Arrays / Müll", () => {
    expect(coercePegelStations(null)).toEqual([]);
    expect(coercePegelStations({})).toEqual([]);
    expect(coercePegelStations(["x", 5, null])).toEqual([]);
  });
});

describe("pegelStatusColor / PEGEL_STATUS_LABEL", () => {
  it("liefert je Status eine Farbe, high≠normal≠low", () => {
    expect(pegelStatusColor("high")).not.toBe(pegelStatusColor("normal"));
    expect(pegelStatusColor("normal")).not.toBe(pegelStatusColor("low"));
    expect(pegelStatusColor("unknown")).toBe(pegelStatusColor("commented"));
  });

  it("hat ein Label für jeden Status", () => {
    for (const s of ["low", "normal", "high", "unknown", "commented"] as PegelState[]) {
      expect(PEGEL_STATUS_LABEL[s]).toBeTruthy();
    }
  });
});
