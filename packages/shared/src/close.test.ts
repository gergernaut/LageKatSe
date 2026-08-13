import { describe, expect, it } from "vitest";
import { buildCloseEtbText } from "./close";

describe("buildCloseEtbText", () => {
  it("baut den vollständigen Satz mit Ersteller", () => {
    expect(
      buildCloseEtbText({
        startDug: "031748Aug26",
        createdBy: "M. Mustermann (S3)",
        endDug: "051230Aug26",
        closedBy: "A. Beispiel (S2/S3)",
      }),
    ).toBe(
      "Lageraum abgeschlossen. Lagebeginn 031748Aug26, eröffnet durch M. Mustermann (S3), Lageende 051230Aug26, geschlossen von A. Beispiel (S2/S3).",
    );
  });

  it("lässt die Ersteller-Klausel weg, wenn createdBy fehlt/leer", () => {
    const text = buildCloseEtbText({ startDug: "031748Aug26", endDug: "051230Aug26", closedBy: "A. Beispiel (S2)" });
    expect(text).toBe(
      "Lageraum abgeschlossen. Lagebeginn 031748Aug26, Lageende 051230Aug26, geschlossen von A. Beispiel (S2).",
    );
    expect(text).not.toContain("eröffnet durch");
    // leerer String = gleiches Verhalten wie fehlend
    expect(buildCloseEtbText({ startDug: "a", endDug: "b", closedBy: "x", createdBy: "" })).not.toContain("eröffnet durch");
  });
});
