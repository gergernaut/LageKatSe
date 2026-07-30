// Generates public/taktische-zeichen/index.json from the vendored CC0 SVG set.
// Re-run after changing the SVG assets:  node packages/web/scripts/build-symbol-index.mjs
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const tzRoot = fileURLToPath(new URL("../public/taktische-zeichen", import.meta.url));
const svgRoot = join(tzRoot, "svg");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) out.push(...walk(abs));
    else if (entry.toLowerCase().endsWith(".svg")) out.push(abs);
  }
  return out;
}

const titleRe = /<title>([\s\S]*?)<\/title>/;

const symbols = walk(svgRoot).map((abs) => {
  const rel = relative(tzRoot, abs).split(sep).join("/"); // svg/<Category>/<name>.svg
  const parts = rel.split("/");
  const category = parts[1] ?? "Sonstiges";
  const name = basename(rel).replace(/\.svg$/i, "");
  const svg = readFileSync(abs, "utf8");
  const title = svg.match(titleRe)?.[1];
  const label = (title ?? name.replace(/_/g, " ")).trim();
  return {
    id: rel.replace(/^svg\//, "").replace(/\.svg$/i, ""), // <Category>/<name>
    category,
    label,
    file: rel,
  };
});

symbols.sort((a, b) => a.category.localeCompare(b.category, "de") || a.label.localeCompare(b.label, "de"));

const counts = {};
for (const s of symbols) counts[s.category] = (counts[s.category] ?? 0) + 1;

const index = {
  source: "jonas-koeritz/Taktische-Zeichen v2.0.0",
  license: "CC0-1.0 (symbols are public domain)",
  count: symbols.length,
  categories: Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, "de")),
  symbols,
};

const outPath = join(tzRoot, "index.json");
writeFileSync(outPath, JSON.stringify(index));
console.log(`wrote index.json: ${symbols.length} symbols in ${index.categories.length} categories`);
