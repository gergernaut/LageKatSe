import { describe, expect, it } from "vitest";
import type { PDFFont } from "pdf-lib";
import { wrapText } from "./pdf";

// wrapText nutzt vom Font ausschließlich widthOfTextAtSize. Ein deterministischer
// Monospace-Mock (Breite = Zeichenzahl · size) macht die Umbruchlogik pur testbar,
// ohne pdf-lib eine echte Schrift einbetten zu lassen.
const monoFont = {
  widthOfTextAtSize: (text: string, size: number) => text.length * size,
} as unknown as PDFFont;

const wrap = (text: string, maxWidth: number) => wrapText(text, monoFont, 1, maxWidth);

describe("wrapText", () => {
  it("lässt Text, der passt, auf einer Zeile", () => {
    expect(wrap("hallo welt", 20)).toEqual(["hallo welt"]);
  });

  it("bricht an Wortgrenzen um, wenn die Breite überschritten wird", () => {
    expect(wrap("hallo welt", 5)).toEqual(["hallo", "welt"]);
  });

  it("kollabiert Mehrfach-Whitespace zu einem Leerzeichen", () => {
    expect(wrap("a   b", 5)).toEqual(["a b"]);
  });

  it("bricht ein einzelnes zu langes Wort zeichenweise hart um", () => {
    expect(wrap("abcdefgh", 3)).toEqual(["abc", "def", "gh"]);
  });

  it("erhält explizite Zeilenumbrüche (\\n)", () => {
    expect(wrap("a\nb", 80)).toEqual(["a", "b"]);
  });

  it("bildet Leerzeilen aus aufeinanderfolgenden \\n ab", () => {
    expect(wrap("a\n\nb", 80)).toEqual(["a", "", "b"]);
  });

  it("gibt für leeren Text genau eine leere Zeile zurück", () => {
    expect(wrap("", 80)).toEqual([""]);
    expect(wrap("   ", 80)).toEqual([""]);
  });
});
