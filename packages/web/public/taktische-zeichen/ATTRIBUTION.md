# Taktische Zeichen — Herkunft & Lizenz

Die SVG-Zeichen unter `svg/` stammen aus
**[jonas-koeritz/Taktische-Zeichen](https://github.com/jonas-koeritz/Taktische-Zeichen) v2.0.0**
(`release.zip`).

- **Zeichen (SVG):** gemeinfrei — **CC0 1.0**. Laut Repository sind „die fertigen
  Zeichen aus den `release.zip` Dateien … gemeinfrei". Keine Attribution erforderlich
  (dieser Hinweis dient nur der Nachvollziehbarkeit).
- **Eingebettete Schrift:** textführende Zeichen enthalten *Roboto Slab* (Apache-2.0)
  als eingebettete `@font-face` (Base64-WOFF). Die Zeichen sind dadurch selbst-enthaltend
  und rendern den Text ohne extern installierte Schrift.

Hinweis: Der Quell-*Code* des Repositories steht unter CC BY 4.0 — wir übernehmen aber
nur die **fertigen Zeichen** aus `release.zip`, die gemeinfrei sind.

`index.json` wird aus `svg/` generiert:
`node packages/web/scripts/build-symbol-index.mjs`.
