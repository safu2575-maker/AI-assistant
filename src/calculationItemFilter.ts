import { BasicFilter } from "powerbi-models";

// Accept only a literal calculation item and one model column. The optional
// variable declaration allows pasting the fragment from Performance Analyzer.
export function calculationItemFilter(source: string) {
    if (!source.trim()) return undefined;
    const match = /^(?:VAR\s+[A-Za-z_]\w*\s*=\s*)?TREATAS\s*\(\s*\{\s*"((?:""|[^"])*)"\s*\}\s*,\s*'((?:''|[^'])+)'\s*\[((?:\]\]|[^\]])+)\]\s*\)$/i.exec(source.trim());
    if (!match || !match[1].trim()) throw new Error('Use TREATAS({"Item"}, \'Table\'[Column]) with one calculation item.');
    const target = { table: match[2].replace(/''/g, "'"), column: match[3].replace(/\]\]/g, "]") };
    return { ...new BasicFilter(target, "In", [match[1].replace(/""/g, '"')]).toJSON(),
        displaySettings: { isHiddenInViewMode: true, isLockedInViewMode: true } };
}
