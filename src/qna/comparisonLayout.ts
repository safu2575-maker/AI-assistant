export function comparisonHeading(label: string): {group: string; leaf: string} {
 const match = /^(?:(January|February|March|April|May|June|July|August|September|October|November|December)\s+)?((?:19|20)\d{2})(?:\s*[·]\s*|\s+)?(.*)$/i.exec(label);
 if (!match) return {group: "", leaf: label};
 return {group: match[2], leaf: [match[1], match[3]].filter(Boolean).join(" · ") || "Value"};
}
export function comparisonPartner(columns: string[], source: number): number | undefined {
 const current = comparisonHeading(columns[source]);
 if (!current.group || /%|YTD|TTM|change|total/i.test(current.leaf)) return undefined;
 const matches = columns.map((label,index)=>({index,...comparisonHeading(label)})).filter(item=>item.group && item.group !== current.group && item.leaf === current.leaf);
 return matches.length === 1 ? matches[0].index : undefined;
}
