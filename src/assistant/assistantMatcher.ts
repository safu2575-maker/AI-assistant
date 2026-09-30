import {
    AssistantEntity,
    AssistantMatch,
    AssistantMetric
} from "./assistantTypes";
import { normalizeAssistantText } from "./assistantParser";

declare const require: any;
const uFuzzyLib = require("@leeoniya/ufuzzy");
const UFuzzy: any = typeof uFuzzyLib === "function" ? uFuzzyLib : (uFuzzyLib.default || uFuzzyLib);

type SearchDoc<T> = {
    label: string;
    aliases: string[];
    normalizedLabels: string[];
    item: T;
};

const SYNONYMS: Record<string, string> = {
    // Revenue / Sales
    rev: "revenue",
    revenu: "revenue",
    rvenue: "revenue",
    sales: "revenue",
    sale: "revenue",
    turnover: "revenue",
    income: "revenue",
    proceeds: "revenue",
    takings: "revenue",
    earnings: "revenue",
    receipts: "revenue",
    // Area / Size
    gla: "area",
    sqm: "area",
    m2: "area",
    sqft: "area",
    "sq ft": "area",
    "sq m": "area",
    footage: "area",
    "gross leasable": "area",
    "leasable area": "area",
    "net area": "area",
    // Time periods
    yoy: "year over year",
    ytd: "year to date",
    qtd: "quarter to date",
    mtd: "month to date",
    // Occupancy
    occ: "occupancy",
    "occ rate": "occupancy",
    "occupancy rate": "occupancy",
    "occ percent": "occupancy",
    "occ %": "occupancy",
    // OCR
    ocr: "occupancy cost ratio",
    "cost ratio": "occupancy cost ratio",
    "rent to sales": "occupancy cost ratio",
    "rent ratio": "occupancy cost ratio",
    "rent sales ratio": "occupancy cost ratio",
    "occupancy cost": "occupancy cost ratio",
    // Rent / Lease
    leasing: "lease",
    rental: "rent",
    rentals: "rent",
    "base rent": "rent",
    "passing rent": "rent",
    "contracted rent": "rent",
    "effective rent": "rent",
    "headline rent": "rent",
    // Vacancy
    vacancy: "vacant",
    "vacancy rate": "vacant",
    unoccupied: "vacant",
    "empty units": "vacant",
    // F&B / Food
    fnb: "food beverage",
    "f&b": "food beverage",
    "food and beverage": "food beverage",
    "food court": "food beverage",
    dining: "food beverage",
    // Fashion / Apparel
    apparel: "fashion",
    clothing: "fashion",
    clothes: "fashion",
    garments: "fashion",
    // Stores / Units (retail generic)
    store: "unit",
    stores: "unit",
    shop: "unit",
    shops: "unit",
    outlet: "unit",
    outlets: "unit",
    branch: "unit",
    branches: "unit",
    premises: "unit",
    // Metrics (generic)
    kpi: "metric",
    measure: "metric",
    indicator: "metric"
};

function uniq(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

// Pre-sort once and pre-build regex objects — avoids Object.keys().sort() on every synonymNormalize call
const SYNONYM_KEYS_SORTED = Object.keys(SYNONYMS).sort((a, b) => b.length - a.length);
const SYNONYM_REGEX_MAP = new Map<string, RegExp>(
    SYNONYM_KEYS_SORTED.map((key) => [key, new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g")])
);
const synonymNormalizeCache = new Map<string, string>();

function synonymNormalize(value: string): string {
    const cached = synonymNormalizeCache.get(value);
    if (cached !== undefined) return cached;
    let out = normalizeAssistantText(value).replace(/&/g, " and ");
    SYNONYM_KEYS_SORTED.forEach((key) => {
        out = out.replace(SYNONYM_REGEX_MAP.get(key)!, SYNONYMS[key]);
    });
    out = out.replace(/[^a-z0-9%]+/g, " ");
    out = out.replace(/\s+/g, " ").trim();
    if (synonymNormalizeCache.size >= 2000) synonymNormalizeCache.clear();
    synonymNormalizeCache.set(value, out);
    return out;
}

function compact(value: string): string {
    return synonymNormalize(value).replace(/\s+/g, "");
}

function ampersandVariants(value: string): string[] {
    const clean = synonymNormalize(value);
    const variants = new Set<string>([clean]);
    variants.add(clean.replace(/\s*&\s*/g, " and ").replace(/\s+/g, " ").trim());
    variants.add(clean.replace(/\s+and\s+/g, " & ").replace(/\s+/g, " ").trim());
    variants.add(clean.replace(/\s*&\s*/g, " ").replace(/\s+/g, " ").trim());
    variants.add(clean.replace(/\s+and\s+/g, " ").replace(/\s+/g, " ").trim());
    return Array.from(variants).filter(Boolean);
}

function sortedTokenKey(value: string): string {
    return ampersandVariants(value)
        .reduce<string[]>((acc, variant) => acc.concat(variant.split(/\s+/g)), [])
        .map((token) => token.trim())
        .filter(Boolean)
        .sort()
        .join(" ");
}

function sortedCompactTokenKey(value: string): string {
    return synonymNormalize(value)
        .replace(/&/g, " ")
        .replace(/\band\b/g, " ")
        .split(/\s+/g)
        .map((token) => token.trim())
        .filter(Boolean)
        .sort()
        .join(" ");
}

function ngrams(value: string, size: number = 3): Set<string> {
    const src = compact(value);
    const out = new Set<string>();
    if (src.length < size) {
        if (src) out.add(src);
        return out;
    }
    for (let i = 0; i <= src.length - size; i++) out.add(src.slice(i, i + size));
    return out;
}

function ngramScore(query: string, candidate: string): number | null {
    const q = ngrams(query);
    const c = ngrams(candidate);
    if (q.size < 2 || c.size < 2) return null;
    let overlap = 0;
    q.forEach((gram) => {
        if (c.has(gram)) overlap++;
    });
    const dice = (2 * overlap) / Math.max(1, q.size + c.size);
    return dice >= 0.72 ? Math.max(0.18, 1 - dice) : null;
}

function tokenSetScore(query: string, candidate: string): number | null {
    const q = sortedTokenKey(query);
    const c = sortedTokenKey(candidate);
    const qCompact = sortedCompactTokenKey(query);
    const cCompact = sortedCompactTokenKey(candidate);
    if (qCompact && cCompact && qCompact === cCompact && qCompact.indexOf(" ") >= 0) return 0.012;
    if (!q || !c || q.indexOf(" ") < 0 || c.indexOf(" ") < 0) return null;
    if (q === c) return 0.015;
    const qTokens = new Set(q.split(/\s+/g));
    const cTokens = new Set(c.split(/\s+/g));
    let overlap = 0;
    qTokens.forEach((token) => {
        if (cTokens.has(token)) overlap++;
    });
    const precision = overlap / Math.max(1, qTokens.size);
    const recall = overlap / Math.max(1, cTokens.size);
    return precision >= 1 && recall >= 0.66 ? 0.08 : null;
}

function weightedLabelScoreNorm(q: string, c: string): number | null {
    if (!q || !c) return null;
    if (q === c) return 0.001;
    if (compact(q) === compact(c)) return 0.006;
    const tokenScore = tokenSetScore(q, c);
    if (tokenScore !== null) return tokenScore;
    const typo = typoScore(q, c);
    if (typo !== null) return Math.max(0.04, typo + 0.04);
    const ng = ngramScore(q, c);
    if (ng !== null) return Math.max(0.2, ng);
    return null;
}

function editDistance(a: string, b: string, maxDistance: number): number {
    if (a === b) return 0;
    if (!a || !b) return Math.max(a.length, b.length);
    if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
    let prev = new Array(b.length + 1);
    let cur = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
        cur[0] = i;
        let rowMin = cur[0];
        for (let j = 1; j <= b.length; j++) {
            const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
            const val = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
            cur[j] = val;
            if (val < rowMin) rowMin = val;
        }
        if (rowMin > maxDistance) return maxDistance + 1;
        const swap = prev;
        prev = cur;
        cur = swap;
    }
    return prev[b.length];
}

function typoScore(query: string, candidate: string): number | null {
    const q = compact(query);
    const c = compact(candidate);
    if (q.length < 4 || c.length < 4) return null;
    if (q === c || c.indexOf(q) >= 0 || q.indexOf(c) >= 0) return 0.01;
    const maxDistance = Math.max(1, Math.min(4, Math.floor(Math.max(q.length, c.length) * 0.28)));
    const distance = editDistance(q, c, maxDistance);
    if (distance > maxDistance) return null;
    return Math.min(0.47, distance / Math.max(q.length, c.length));
}

export class AssistantMatcher {
    private uf: any;
    private metricDocs: Array<SearchDoc<AssistantMetric>>;
    private entityDocs: Array<SearchDoc<AssistantEntity>>;
    private metricHaystack: string[];
    private metricHaystackMap: Array<SearchDoc<AssistantMetric>>;
    private entityHaystack: string[];
    private entityHaystackMap: Array<SearchDoc<AssistantEntity>>;

    constructor(metrics: AssistantMetric[], entities: AssistantEntity[]) {
        this.uf = new UFuzzy({ intraMode: 1, intraIns: 1, intraSub: 1, intraDel: 1 });
        this.metricDocs = this.makeDocs(metrics, (m) => m.name, (m) => m.aliases || []);
        this.entityDocs = this.makeDocs(entities, (e) => e.label, (e) => e.aliases || []);
        [this.metricHaystack, this.metricHaystackMap] = this.buildHaystack(this.metricDocs);
        [this.entityHaystack, this.entityHaystackMap] = this.buildHaystack(this.entityDocs);
    }

    matchMetrics(phrases: string[], limit: number = 3): Array<AssistantMatch<AssistantMetric>> {
        const results = this.match(this.metricHaystack, this.metricHaystackMap, this.metricDocs, phrases, limit);
        if (results.length) return results;
        return this.matchMetricsFallback(phrases, limit);
    }

    private matchMetricsFallback(phrases: string[], limit: number): Array<AssistantMatch<AssistantMetric>> {
        const scored = new Map<AssistantMetric, number>();
        for (const phrase of phrases) {
            const query = synonymNormalize(normalizeAssistantText(phrase));
            if (!query || query.length < 2) continue;
            const qTokens = query.split(/\s+/g).filter((t) => t.length >= 3);
            if (!qTokens.length) continue;
            this.metricDocs.forEach((doc) => {
                let best: number | null = null;
                for (const norm of doc.normalizedLabels) {
                    if (!norm) continue;
                    if (norm === query) { best = 0.01; break; }
                    const cTokens = norm.split(/\s+/g).filter((t) => t.length >= 3);
                    const matched = qTokens.filter((qt) => cTokens.some((ct) => ct.startsWith(qt) || qt.startsWith(ct))).length;
                    if (matched === 0) continue;
                    const score = 0.38 + (1 - matched / Math.max(qTokens.length, 1)) * 0.1;
                    if (best === null || score < best) best = score;
                }
                if (best === null) return;
                const prev = scored.get(doc.item);
                if (prev === undefined || best < prev) scored.set(doc.item, best);
            });
        }
        return Array.from(scored.entries())
            .map(([item, score]) => ({ item, score }))
            .sort((a, b) => a.score - b.score)
            .slice(0, limit);
    }

    matchEntities(phrases: string[], limit: number = 6): Array<AssistantMatch<AssistantEntity>> {
        const matches = this.match(this.entityHaystack, this.entityHaystackMap, this.entityDocs, phrases, limit * 2);
        const seen = new Set<string>();
        const out: Array<AssistantMatch<AssistantEntity>> = [];
        for (const match of matches) {
            const key = `${match.item.kind}:${match.item.id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(match);
            if (out.length >= limit) break;
        }
        return out;
    }

    private match<T>(
        haystack: string[],
        haystackMap: Array<SearchDoc<T>>,
        docs: Array<SearchDoc<T>>,
        phrases: string[],
        limit: number
    ): Array<AssistantMatch<T>> {
        const scored = new Map<T, number>();

        for (const phrase of phrases) {
            const query = normalizeAssistantText(phrase);
            if (!query || query.length < 2) continue;
            const queryNorm = synonymNormalize(query);

            // uFuzzy pass — fast character-level fuzzy candidates
            let ufuzzyFoundGood = false;
            try {
                const result = this.uf.search(haystack, query);
                const idxs: number[] | null = result ? result[0] : null;
                if (idxs && idxs.length) {
                    idxs.forEach((idx) => {
                        const doc = haystackMap[idx];
                        if (!doc) return;
                        let best: number | null = null;
                        doc.normalizedLabels.forEach((normLabel) => {
                            const score = weightedLabelScoreNorm(queryNorm, normLabel);
                            if (score === null) return;
                            if (best === null || score < best) best = score;
                        });
                        const finalScore = best !== null ? best : 0.35;
                        if (finalScore > 0.48) return;
                        if (finalScore < 0.15) ufuzzyFoundGood = true;
                        const prev = scored.get(doc.item);
                        if (prev === undefined || finalScore < prev) scored.set(doc.item, finalScore);
                    });
                }
            } catch (_) {
                // uFuzzy can throw on some edge-case inputs — fall through to custom scan
            }

            // Custom scoring pass — catches synonym/token/ngram matches uFuzzy may miss.
            // Skipped when uFuzzy already found a high-confidence result for this phrase.
            if (ufuzzyFoundGood) continue;
            docs.forEach((doc) => {
                let best: number | null = null;
                doc.normalizedLabels.forEach((normLabel) => {
                    const score = weightedLabelScoreNorm(queryNorm, normLabel);
                    if (score === null) return;
                    if (best === null || score < best) best = score;
                });
                if (best === null || best > 0.34) return;
                const prev = scored.get(doc.item);
                if (prev === undefined || best < prev) scored.set(doc.item, best);
            });
        }

        return Array.from(scored.entries())
            .map(([item, score]) => ({ item, score }))
            .sort((a, b) => a.score - b.score)
            .slice(0, limit);
    }

    private buildHaystack<T>(docs: Array<SearchDoc<T>>): [string[], Array<SearchDoc<T>>] {
        const haystack: string[] = [];
        const map: Array<SearchDoc<T>> = [];
        docs.forEach((doc) => {
            [doc.label, ...doc.aliases].forEach((str) => {
                if (str) { haystack.push(str); map.push(doc); }
            });
        });
        return [haystack, map];
    }

    private makeDocs<T>(items: T[], getLabel: (item: T) => string, getAliases: (item: T) => string[]): Array<SearchDoc<T>> {
        return items.map((item) => {
            const label = getLabel(item);
            const aliases = uniq(getAliases(item).concat(label));
            const normalizedLabels = uniq([label, ...aliases]).map((l) => synonymNormalize(l)).filter(Boolean);
            return { label, aliases, normalizedLabels, item };
        });
    }
}
