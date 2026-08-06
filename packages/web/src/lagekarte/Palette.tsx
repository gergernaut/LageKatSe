import { useMemo, useState } from "react";

export interface PaletteSymbol {
  id: string;
  category: string;
  label: string;
  file: string;
}

/** Categories with an underscore (e.g. "Feuerwehr_Einheiten") are split into
 *  a top-level type ("Einheiten") and a sub-group ("Feuerwehr"). Categories
 *  without an underscore stay as-is (top-level, no sub-group). */
const UNDERSCORE_TYPES = new Set(["Einheiten", "Einrichtungen", "Fahrzeuge", "Gebäude", "Personen"]);

interface Group {
  name: string;
  symbols: PaletteSymbol[];
  subgroups: Map<string, PaletteSymbol[]>;
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
  const [expandedSubgroups, setExpandedSubgroups] = useState<Set<string>>(() => new Set());
  const query = search.trim().toLocaleLowerCase("de");

  const groups = useMemo(() => {
    const grouped = new Map<string, Group>();

    for (const symbol of symbols) {
      if (query && !symbol.label.toLocaleLowerCase("de").includes(query)) continue;

      const rawCategory = symbol.category || "Ohne Kategorie";
      let topName = rawCategory;
      let subName: string | null = null;

      // Split "Org_Type" categories into sub-groups under "Type".
      if (rawCategory.includes("_")) {
        const [org, type] = rawCategory.split("_", 2);
        if (UNDERSCORE_TYPES.has(type)) {
          topName = type;
          subName = org;
        }
      }

      let group = grouped.get(topName);
      if (!group) {
        group = { name: topName, symbols: [], subgroups: new Map() };
        grouped.set(topName, group);
      }

      if (subName) {
        const sub = group.subgroups.get(subName);
        if (sub) sub.push(symbol);
        else group.subgroups.set(subName, [symbol]);
      } else {
        group.symbols.push(symbol);
      }
    }

    // Sort top-level groups, sub-groups within, and return.
    return [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right, "de"))
      .map(([name, g]) => ({
        name,
        symbols: g.symbols,
        subgroups: [...g.subgroups.entries()].sort(([a], [b]) => a.localeCompare(b, "de")),
        totalCount: g.symbols.length + [...g.subgroups.values()].reduce((sum, arr) => sum + arr.length, 0),
      }));
  }, [query, symbols]);

  const toggleCategory = (category: string) => {
    setExpandedCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const toggleSubgroup = (key: string) => {
    setExpandedSubgroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
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
        {groups.map((group) => {
          const expanded = query.length > 0 || expandedCategories.has(group.name);
          const hasDirect = group.symbols.length > 0;
          const hasSubs = group.subgroups.length > 0;
          return (
            <section className="lagekarte-symbol-group" key={group.name}>
              <button
                className="lagekarte-symbol-group__toggle"
                type="button"
                aria-expanded={expanded}
                onClick={() => toggleCategory(group.name)}
              >
                <span className="lagekarte-symbol-group__chevron">{expanded ? "▾" : "▸"}</span>
                <span>{group.name}</span>
                <span className="lagekarte-symbol-group__count">{group.totalCount}</span>
              </button>
              {expanded && (
                <>
                  {hasDirect && (
                    <div className="lagekarte-symbol-grid">
                      {group.symbols.map((symbol) => (
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
                  {hasSubs && group.subgroups.map(([subName, subSymbols]) => {
                    const subKey = `${group.name}::${subName}`;
                    const subExpanded = query.length > 0 || expandedSubgroups.has(subKey);
                    return (
                      <section className="lagekarte-symbol-group lagekarte-symbol-group--sub" key={subKey}>
                        <button
                          className="lagekarte-symbol-group__toggle lagekarte-symbol-group__toggle--sub"
                          type="button"
                          aria-expanded={subExpanded}
                          onClick={() => toggleSubgroup(subKey)}
                        >
                          <span className="lagekarte-symbol-group__chevron">{subExpanded ? "▾" : "▸"}</span>
                          <span>{subName}</span>
                          <span className="lagekarte-symbol-group__count">{subSymbols.length}</span>
                        </button>
                        {subExpanded && (
                          <div className="lagekarte-symbol-grid">
                            {subSymbols.map((symbol) => (
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
                </>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}