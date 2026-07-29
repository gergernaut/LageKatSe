import { useMemo, useState } from "react";

export interface PaletteSymbol {
  id: string;
  category: string;
  label: string;
  file: string;
}

export function Palette({
  symbols,
  selectedSymbolId,
  onSelect,
  onDisarm,
}: {
  symbols: PaletteSymbol[];
  selectedSymbolId: string | null;
  onSelect: (symbol: PaletteSymbol) => void;
  onDisarm: () => void;
}) {
  const [search, setSearch] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(() => new Set());
  const query = search.trim().toLocaleLowerCase("de");
  const groups = useMemo(() => {
    const grouped = new Map<string, PaletteSymbol[]>();
    for (const symbol of symbols) {
      if (query && !symbol.label.toLocaleLowerCase("de").includes(query)) continue;
      const category = symbol.category || "Ohne Kategorie";
      const group = grouped.get(category);
      if (group) group.push(symbol);
      else grouped.set(category, [symbol]);
    }
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right, "de"));
  }, [query, symbols]);

  const toggleCategory = (category: string) => {
    setExpandedCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  return (
    <aside className="lagekarte-palette" aria-label="Taktische Zeichen">
      <div className="lagekarte-panel__head">
        <div>
          <span className="eyebrow">Werkzeuge</span>
          <h2>Taktische Zeichen</h2>
        </div>
        <span className="lagekarte-panel__count">{symbols.length}</span>
      </div>
      <div className="lagekarte-palette__search">
        <input
          aria-label="Taktische Zeichen durchsuchen"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Zeichen suchen…"
        />
      </div>
      {selectedSymbolId && (
        <button className="lagekarte-disarm" type="button" onClick={onDisarm}>
          Platzieren beenden <span>Esc</span>
        </button>
      )}
      <div className="lagekarte-palette__groups">
        {groups.length === 0 && <p className="lagekarte-palette__empty">Keine Zeichen gefunden.</p>}
        {groups.map(([category, categorySymbols]) => {
          const expanded = query.length > 0 || expandedCategories.has(category);
          return (
            <section className="lagekarte-symbol-group" key={category}>
              <button
                className="lagekarte-symbol-group__toggle"
                type="button"
                aria-expanded={expanded}
                onClick={() => toggleCategory(category)}
              >
                <span className="lagekarte-symbol-group__chevron">{expanded ? "▾" : "▸"}</span>
                <span>{category}</span>
                <span className="lagekarte-symbol-group__count">{categorySymbols.length}</span>
              </button>
              {expanded && (
                <div className="lagekarte-symbol-grid">
                  {categorySymbols.map((symbol) => (
                    <button
                      className={`lagekarte-symbol-choice ${
                        selectedSymbolId === symbol.id ? "lagekarte-symbol-choice--active" : ""
                      }`}
                      type="button"
                      key={symbol.id}
                      title={symbol.label}
                      aria-pressed={selectedSymbolId === symbol.id}
                      onClick={() => onSelect(symbol)}
                    >
                      <img
                        loading="lazy"
                        src={`/taktische-zeichen/${encodeURI(symbol.file)}`}
                        alt=""
                      />
                      <span>{symbol.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
