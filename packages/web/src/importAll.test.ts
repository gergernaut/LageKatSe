import { describe, expect, it } from "vitest";
import { classifyBundleFiles } from "./importAll";

// Ordnet ZIP-Einträge den Modulen zu (Präfix + .json). Der Zeitstempel/Code im
// Dateinamen variiert, daher Präfix-Matching statt exakter Namen.
describe("classifyBundleFiles", () => {
  it("erkennt die drei Bundle-Dateien an ihrem Präfix", () => {
    const cls = classifyBundleFiles([
      "lagekarte-ABCDEF-031748Aug26.json",
      "einsatztagebuch-ABCDEF-031748Aug26.json",
      "arbeitsblatt-ABCDEF-031748Aug26.json",
    ]);
    expect(cls.lagekarte).toBe("lagekarte-ABCDEF-031748Aug26.json");
    expect(cls.arbeitsblatt).toBe("arbeitsblatt-ABCDEF-031748Aug26.json");
    expect(cls.etb).toBe("einsatztagebuch-ABCDEF-031748Aug26.json");
  });

  it("ignoriert unbekannte Dateien und Nicht-JSON", () => {
    const cls = classifyBundleFiles(["readme.txt", "lagekarte-X.csv", "irgendwas.json"]);
    expect(cls).toEqual({});
  });

  it("liefert nur die vorhandenen Module (Teil-Bundle)", () => {
    const cls = classifyBundleFiles(["arbeitsblatt-X.json"]);
    expect(cls).toEqual({ arbeitsblatt: "arbeitsblatt-X.json" });
  });

  it("nimmt je Modul den ersten Treffer", () => {
    const cls = classifyBundleFiles(["lagekarte-1.json", "lagekarte-2.json"]);
    expect(cls.lagekarte).toBe("lagekarte-1.json");
  });
});
