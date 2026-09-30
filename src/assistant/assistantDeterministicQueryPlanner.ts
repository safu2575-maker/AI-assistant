import { AssistantAnswerContext, ParsedTopBottomQuery } from "./assistantTypes";
import { normalizeAssistantText } from "./assistantParser";

export type DeterministicIntent =
    "attribute"
    | "matrix"
    | "compare"
    | "rank"
    | "breakdown"
    | "lookup"
    | "unknown";

export interface DeterministicFilterPhrases {
    include: string[];
    exclude: string[];
}

export interface DeterministicQueryPlan {
    question: string;
    changed: boolean;
    reason?: string;
    confidence: number;
    intent: DeterministicIntent;
    metricPhrase?: string;
    metricPhrases?: string[];
    entityPhrase?: string;
    rowPhrases?: string[];
    columnPhrases?: string[];
    filterPhrases?: DeterministicFilterPhrases;
    chartType?: "bar" | "column" | "line" | "pie" | "donut" | "table";
}

type PlannerDimension = Exclude<ParsedTopBottomQuery["dimensionType"], "bookmark" | "filter">;

interface DimensionRule {
    dimension: PlannerDimension;
    singular: string;
    plural: string;
    pattern: RegExp;
    aliases: string[];
}

const DIMENSION_RULES: DimensionRule[] = [
    { dimension: "tenant", singular: "tenant", plural: "tenants", pattern: /\b(?:assigned\s+tenant\s+names?|tenant\s+names?|tenants?|brands?|shops?|stores?|retailers?)\b/i, aliases: ["assigned tenant name", "assigned tenant names", "tenant name", "tenant names", "tenant", "tenants", "brand", "brands", "shop", "shops", "store", "stores", "retailer", "retailers"] },
    { dimension: "unit", singular: "unit", plural: "units", pattern: /\b(?:assigned\s+units?|unit\s+ids?|unit\s+names?|units?|spaces?|locations?)\b/i, aliases: ["assigned unit", "assigned units", "unit id", "unit ids", "unit name", "unit names", "unit", "units", "space", "spaces", "location", "locations"] },
    { dimension: "category", singular: "category", plural: "categories", pattern: /\b(?:assigned\s+sales\s+categor(?:y|ies)|sales\s+categor(?:y|ies)|assigned\s+categor(?:y|ies)|categor(?:y|ies)|segments?|class(?:es|ifications?)?)\b/i, aliases: ["assigned sales category", "assigned sales categories", "sales category", "sales categories", "assigned category", "assigned categories", "category", "categories", "segment", "segments", "class", "classes", "classification", "classifications"] },
    { dimension: "group", singular: "group", plural: "groups", pattern: /\b(?:assigned\s+groups?|tenant\s+groups?|retail\s+groups?|groups?|departments?)\b/i, aliases: ["assigned group", "assigned groups", "tenant group", "tenant groups", "retail group", "retail groups", "group", "groups", "department", "departments"] },
    { dimension: "zone", singular: "zone", plural: "zones", pattern: /\b(?:regions?|zones?|areas?)\b/i, aliases: ["zone", "zones", "region", "regions"] },
    { dimension: "floor", singular: "floor", plural: "floors", pattern: /\b(?:floors?|levels?)\b/i, aliases: ["floor", "floors", "level", "levels"] },
    { dimension: "layer", singular: "layer", plural: "layers", pattern: /\b(?:layers?)\b/i, aliases: ["layer", "layers"] }
];

const TOP_WORDS = /\b(?:top|highest|largest|biggest|maximum|max|best|most|leading|main|greater|greatest)\b/i;
const BOTTOM_WORDS = /\b(?:bottom|lowest|smallest|minimum|min|least|worst|weakest|poorest|lower)\b/i;
const RANK_WORDS = /\b(?:top|bottom|highest|largest|biggest|maximum|max|best|most|lowest|smallest|minimum|min|least|worst|rank|ranking|which|who|have|has)\b/i;
const BREAKDOWN_CONNECTOR = /\b(?:by|per|across|grouped\s+by|split\s+by)\b/i;
const MATRIX_WORDS = /\b(?:rows?|columns?|cols?|matrix|pivot|cross\s*tab|crosstab)\b/i;
const CHART_WORDS = /\b(?:bar|column|line|pie|donut|doughnut|table)\s*(?:chart|graph|visual|plot|view)?\b/i;
const ATTRIBUTE_LOOKUP_RE = /\b(?:what|which|show|tell|get|give)\b\s*(?:is|are|the|me|please|can|you|find|value|field|assigned)*\s*(?:the\s+)?(?:assigned\s+sales\s+category|sales\s+category|assigned\s+category|category|assigned\s+group|group|assigned\s+tenant\s+name|tenant\s+name|tenant|assigned\s+unit|unit\s+id|unit|floor|level)\s+(?:of|for)\s+.+$/i;
const MULTI_METRIC_LOOKUP_RE = /\b(?:sales|revenue|turnover|rent|rental|lease|ocr|occupancy|vacancy|vacant|units?|area|sqm|m2|gla)[\w/\s]*\s+(?:and|plus|,)\s+[\w/\s]*(?:sales|revenue|turnover|rent|rental|lease|ocr|occupancy|vacancy|vacant|units?|area|sqm|m2|gla)\b.+\b(?:of|for)\b/i;

function cleanText(value: string): string {
    return normalizeAssistantText(value)
        .replace(/\bcols?\b/g, "columns")
        .replace(/\bdoughnut\b/g, "donut")
        .replace(/\s+/g, " ")
        .trim();
}

function cleanSlot(value: string): string {
    return cleanText(value)
        .replace(/\b(?:show|display|get|give|create|build|please|me|the|a|an)\b/g, " ")
        .replace(/\b(?:in|as|with)\s+(?:bar|column|line|pie|donut|table)?\s*(?:chart|graph|visual|plot|view|table)\b/g, " ")
        .replace(/\b(?:bar|column|line|pie|donut|table)\s*(?:chart|graph|visual|plot|view)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function escapeRegExp(value: string): string {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unique(values: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    values.forEach((value) => {
        const clean = String(value || "").trim();
        const key = clean.toLowerCase();
        if (!clean || seen.has(key)) return;
        seen.add(key);
        out.push(clean);
    });
    return out;
}

function containsPhrase(normalized: string, phrase: string): boolean {
    const clean = cleanText(phrase);
    return !!clean && new RegExp(`(?:^|\\s)${escapeRegExp(clean)}(?:\\s|$)`, "i").test(normalized);
}

function detectChartType(normalized: string): DeterministicQueryPlan["chartType"] {
    if (/\btable|tabular|grid\b/i.test(normalized)) return "table";
    if (/\bline\s*(?:chart|graph|visual|plot)?\b/i.test(normalized)) return "line";
    if (/\bcolumn\s*(?:chart|graph|visual|plot)?\b/i.test(normalized)) return "column";
    if (/\bpie\s*(?:chart|graph|visual|plot)?\b/i.test(normalized)) return "pie";
    if (/\b(?:donut|doughnut)\s*(?:chart|graph|visual|plot)?\b/i.test(normalized)) return "donut";
    if (/\bbar\s*(?:chart|graph|visual|plot)?\b/i.test(normalized)) return "bar";
    if (/\bchart|graph|visual|plot\b/i.test(normalized)) return "bar";
    return undefined;
}

function chartSuffix(chartType: DeterministicQueryPlan["chartType"]): string {
    if (!chartType) return "";
    if (chartType === "table") return " in table";
    return ` in ${chartType} chart`;
}

function metricPhraseFromText(context: AssistantAnswerContext, normalized: string): string | null {
    const text = cleanSlot(normalized);
    if (/\b(?:sum|total)\s+of\s+area\b/i.test(text)) return "sum of area";
    if (/\b(?:sum|total)\s+of\s+(?:sqm|sq\s*m|m2|size|gla)\b/i.test(text)) return "area";
    if (/\b(?:sales|revenue|turnover)\s*(?:per|\/)?\s*(?:sqm|m2|area)\b|\b(?:sales|revenue|turnover)\s+density\b|\bspace\s+productivity\b/i.test(text)) return "sales/sqm";
    if (/\b(?:rent|rental|lease)\s*(?:per|\/)?\s*(?:sqm|m2|area)\b/i.test(text)) return "rent/sqm";
    if (/\b(?:area|sqm|sq\s*m|m2|size|gla)\b/i.test(text)) return "area";
    if (/\b(?:ocr|occupancy\s+cost|cost\s+ratio|rent\s+to\s+sales)\b/i.test(text)) return "ocr";
    if (/\b(?:occupancy|occupied)\b/i.test(text)) return "occupancy";
    if (/\b(?:vacancy|vacant|empty|available|unleased)\b/i.test(text)) return "vacant units";
    if (/\b(?:units?|stores?|shops?)\b/i.test(text) && /\b(?:count|number|how\s+many|total|sum)\b/i.test(text)) return "units";

    const candidates = (context.metrics || [])
        .flatMap((metric) => unique([metric.name].concat(metric.aliases || [])).map((phrase) => ({ phrase, metricName: metric.name })))
        .filter((candidate) => cleanText(candidate.phrase).length >= 3)
        .sort((a, b) => cleanText(b.phrase).length - cleanText(a.phrase).length);
    for (const candidate of candidates) {
        if (containsPhrase(text, candidate.phrase)) return candidate.metricName;
    }

    if (/\b(?:sales|revenue|turnover|income)\b/i.test(text)) return "sales";
    if (/\b(?:rent|rental|lease|erv)\b/i.test(text)) return "rent";
    return null;
}

function metricPhrasesFromText(context: AssistantAnswerContext, normalized: string): string[] {
    const text = cleanSlot(normalized);
    const candidates = (context.metrics || [])
        .flatMap((metric) => unique([metric.name].concat(metric.aliases || [])).map((phrase) => ({ phrase, metricName: metric.name })))
        .filter((candidate) => cleanText(candidate.phrase).length >= 3)
        .sort((a, b) => cleanText(b.phrase).length - cleanText(a.phrase).length);
    const matches: Array<{ metricName: string; index: number; length: number }> = [];
    candidates.forEach((candidate) => {
        const cleanPhrase = cleanText(candidate.phrase);
        const re = new RegExp(`\\b${escapeRegExp(cleanPhrase)}\\b`, "ig");
        let match: RegExpExecArray | null;
        while ((match = re.exec(text))) {
            matches.push({ metricName: candidate.metricName, index: match.index, length: cleanPhrase.length });
        }
    });
    const genericRules: Array<{ metricName: string; re: RegExp }> = [
        { metricName: "sales/sqm", re: /\b(?:sales|revenue|turnover)\s*(?:per|\/)\s*(?:sqm|sq\s*m|m2|area)\b|\bsales\/sqm\b|\bspace\s+productivity\b/gi },
        { metricName: "rent/sqm", re: /\b(?:rent|rental|lease)\s*(?:per|\/)\s*(?:sqm|sq\s*m|m2|area)\b|\brent\/sqm\b/gi },
        { metricName: "ocr", re: /\b(?:ocr|occupancy\s+cost|cost\s+ratio|rent\s+to\s+sales)\b/gi },
        { metricName: "area", re: /\b(?:sum|total)?\s*(?:of\s+)?(?:area|sqm|sq\s*m|m2|size|gla)\b/gi },
        { metricName: "units", re: /\b(?:units?|unit\s+count|number\s+of\s+units?)\b/gi }
    ];
    genericRules.forEach((rule) => {
        let match: RegExpExecArray | null;
        while ((match = rule.re.exec(text))) {
            matches.push({ metricName: rule.metricName, index: match.index, length: String(match[0] || "").length });
        }
    });
    matches.sort((a, b) => a.index - b.index || b.length - a.length);
    const occupied: Array<{ start: number; end: number }> = [];
    const out: string[] = [];
    matches.forEach((match) => {
        const start = match.index;
        const end = match.index + match.length;
        if (occupied.some((range) => start < range.end && end > range.start)) return;
        occupied.push({ start, end });
        out.push(match.metricName);
    });
    return unique(out);
}

function dimensionFromText(normalized: string): DimensionRule | null {
    for (const rule of DIMENSION_RULES) {
        if (rule.pattern.test(normalized)) return rule;
    }
    return null;
}

function dimensionPhrasesFromText(value: string): string[] {
    const clean = cleanSlot(value);
    const out: string[] = [];
    DIMENSION_RULES.forEach((rule) => {
        if (rule.pattern.test(clean)) out.push(rule.singular === "category" ? "assigned sales category" : rule.singular === "tenant" ? "assigned tenant name" : rule.singular === "group" ? "assigned group" : rule.singular);
    });
    if (out.length) return unique(out);
    return clean
        .split(/\s*,\s*|\s+\band\s+|\s*>\s*/i)
        .map(cleanSlot)
        .filter((part) => part && part.length >= 2);
}

function canonicalDimensionPhrase(rule: DimensionRule): string {
    if (rule.dimension === "category") return "assigned sales category";
    if (rule.dimension === "tenant") return "assigned tenant name";
    if (rule.dimension === "group") return "assigned group";
    return rule.singular;
}

function orderedDimensionPhrasesFromText(value: string): string[] {
    const clean = cleanSlot(value);
    const matches: Array<{ phrase: string; index: number; length: number }> = [];
    DIMENSION_RULES.forEach((rule) => {
        rule.aliases.forEach((alias) => {
            const aliasClean = cleanText(alias);
            if (!aliasClean) return;
            const re = new RegExp(`\\b${escapeRegExp(aliasClean)}\\b`, "ig");
            let match: RegExpExecArray | null;
            while ((match = re.exec(clean))) {
                matches.push({ phrase: canonicalDimensionPhrase(rule), index: match.index, length: aliasClean.length });
            }
        });
    });
    if (!matches.length) return dimensionPhrasesFromText(clean);
    matches.sort((a, b) => a.index - b.index || b.length - a.length);
    const occupied: Array<{ start: number; end: number }> = [];
    const out: string[] = [];
    matches.forEach((match) => {
        const start = match.index;
        const end = match.index + match.length;
        if (occupied.some((range) => start < range.end && end > range.start)) return;
        occupied.push({ start, end });
        out.push(match.phrase);
    });
    return unique(out);
}

function dimensionDistinctCount(context: AssistantAnswerContext, phrase: string): number {
    const clean = cleanText(phrase);
    const values = new Set<string>();
    const add = (value: string) => {
        const cleanValue = String(value || "").trim();
        if (!cleanValue || /^n\/a$|^na$|^none$|^null$|^undefined$|^-$/i.test(cleanValue)) return;
        values.add(cleanValue.toLowerCase());
    };
    if (/^(assigned\s+tenant\s+name|tenant|tenants|tenant\s+name|tenant\s+names)$/.test(clean)) {
        (context.rows || []).forEach((row) => add(row?.tenant || ""));
        return values.size;
    }
    if (/^(unit|units|assigned\s+unit|assigned\s+units)$/.test(clean)) {
        (context.rows || []).forEach((row) => add(row?.unitId || row?.shapeKey || ""));
        return values.size;
    }
    if (/^(assigned\s+sales\s+category|sales\s+category|category|categories)$/.test(clean)) {
        (context.rows || []).forEach((row) => add(row?.category || ""));
        return values.size;
    }
    if (/^(assigned\s+group|group|groups)$/.test(clean)) {
        (context.rows || []).forEach((row) => add(row?.group || ""));
        return values.size;
    }
    if (/^(floor|floors|level|levels)$/.test(clean)) {
        (context.rows || []).forEach((row) => (row?.floors || []).forEach(add));
        return values.size;
    }
    if (/^(zone|zones|region|regions)$/.test(clean)) {
        (context.entities || []).filter((entity) => entity.kind === "zone").forEach((entity) => add(entity.label));
        return values.size;
    }
    if (/^(layer|layers)$/.test(clean)) {
        (context.entities || []).filter((entity) => entity.kind === "layer").forEach((entity) => add(entity.label));
        return values.size;
    }
    const fieldKeys = new Set<string>();
    (context.rows || []).forEach((row) => Object.keys(row?.filters || {}).forEach((key) => fieldKeys.add(key)));
    const matchedKey = Array.from(fieldKeys).find((key) => cleanText(key) === clean || cleanText(key).replace(/\s+/g, "") === clean.replace(/\s+/g, ""));
    if (matchedKey) (context.rows || []).forEach((row) => add((row?.filters || {})[matchedKey]));
    return values.size || 999;
}

function chooseAutoMatrixAxes(context: AssistantAnswerContext, dimensions: string[]): { rows: string[]; columns: string[] } | null {
    const uniqueDims = unique(dimensions).slice(0, 4);
    if (uniqueDims.length < 2) return null;
    const scored = uniqueDims.map((phrase, index) => ({
        phrase,
        index,
        count: dimensionDistinctCount(context, phrase)
    }));
    const highCardinality = scored.filter((item) => item.count > 30);
    if (highCardinality.length) {
        const rows = highCardinality.map((item) => item.phrase);
        const columns = scored.filter((item) => rows.indexOf(item.phrase) < 0).map((item) => item.phrase);
        return columns.length ? { rows, columns } : { rows: [scored[0].phrase], columns: scored.slice(1, 2).map((item) => item.phrase) };
    }
    const rowFirst = scored.slice().sort((a, b) => b.count - a.count || a.index - b.index)[0];
    const columns = scored.filter((item) => item.phrase !== rowFirst.phrase).map((item) => item.phrase);
    return columns.length ? { rows: [rowFirst.phrase], columns } : null;
}

function findEntityPhrase(context: AssistantAnswerContext, normalized: string): string | null {
    const text = cleanSlot(normalized);
    const candidates = (context.entities || [])
        .flatMap((entity) => unique([entity.label].concat(entity.aliases || [])).map((phrase) => ({ phrase, label: entity.label })))
        .filter((candidate) => cleanText(candidate.phrase).length >= 3)
        .sort((a, b) => cleanText(b.phrase).length - cleanText(a.phrase).length);
    for (const candidate of candidates) {
        if (containsPhrase(text, candidate.phrase)) return candidate.label;
    }
    return null;
}

function extractLimit(normalized: string): number {
    const numeric = normalized.match(/\b(?:top|bottom)\s+(\d{1,3})\b/);
    const parsed = Number(numeric?.[1] || 0);
    if (Number.isFinite(parsed) && parsed > 0) return Math.min(100, parsed);
    if (/\b(?:top|bottom)\s+ten\b/i.test(normalized)) return 10;
    if (/\b(?:top|bottom)\s+five\b/i.test(normalized)) return 5;
    if (/\b(?:top|bottom)\s+three\b/i.test(normalized)) return 3;
    if (/\b(?:top|bottom)\s+one\b/i.test(normalized)) return 1;
    return 5;
}

function extractScope(normalized: string): string {
    const withoutMetric = cleanSlot(normalized)
        .replace(/\bby\s+.+?(?=\s+(?:in|inside|within|under|from|on|at)\s+|$)/i, " ")
        .replace(CHART_WORDS, " ");
    const match = withoutMetric.match(/\b(?:in|inside|within|under|from|on|at)\s+(.+)$/i);
    const scope = cleanSlot(match?.[1] || "");
    if (!scope || dimensionFromText(scope)) return "";
    if (/^(?:bar|column|line|pie|donut|table|chart|graph|visual|plot)$/.test(scope)) return "";
    return scope;
}

function extractFilters(normalized: string): DeterministicFilterPhrases {
    const out: DeterministicFilterPhrases = { include: [], exclude: [] };
    const pushMatches = (mode: keyof DeterministicFilterPhrases, connector: string, stop: string) => {
        const re = new RegExp(`\\b(?:${connector})\\s+(.+?)(?=\\s+\\b(?:${stop})\\b|$)`, "gi");
        let match: RegExpExecArray | null;
        while ((match = re.exec(normalized))) {
            const body = cleanSlot(match[1] || "");
            if (body) out[mode].push(body);
        }
    };
    pushMatches("exclude", "excluding|exclude|except|without|not including|remove", "including|include|only|just|within|limited to|filtered by|by|as|in|on|at|for");
    pushMatches("include", "including|include|only|just|limited to|filtered by", "excluding|exclude|except|without|not including|remove|by|as|in|on|at|for");
    out.include = unique(out.include);
    out.exclude = unique(out.exclude);
    return out;
}

function filterSuffix(filters: DeterministicFilterPhrases): string {
    const include = filters.include.length ? ` including ${filters.include.join(" and ")}` : "";
    const exclude = filters.exclude.length ? ` excluding ${filters.exclude.join(" and ")}` : "";
    return `${include}${exclude}`;
}

function parseMatrixSlots(normalized: string, metricPhrase: string | null): { rows: string[]; columns: string[] } | null {
    if (!MATRIX_WORDS.test(normalized)) return null;
    const rowAxis = "rows?|row";
    const columnAxis = "columns?|cols?|column|col";
    const aggregateMetric = "(?:sum|total|average|avg|min|max|count)\\s+of\\s+[a-z0-9&/\\s]+?";
    const metricPart = metricPhrase
        ? `(?:${aggregateMetric}|${escapeRegExp(metricPhrase)})`
        : aggregateMetric;
    const measureColumnFirst = normalized.match(new RegExp(`\\b(?:show|display|get|give|create|build)?\\s*${metricPart}\\s+\\b(?:of|for|by|with)\\b\\s+(.+?)\\s+\\bas\\s+(?:${columnAxis})\\s+(?:and\\s+)?(.+?)\\s+\\bas\\s+(?:${rowAxis})\\b`, "i"));
    if (measureColumnFirst?.[1] && measureColumnFirst?.[2]) {
        return {
            columns: orderedDimensionPhrasesFromText(measureColumnFirst[1]),
            rows: orderedDimensionPhrasesFromText(measureColumnFirst[2])
        };
    }
    const measureRowFirst = normalized.match(new RegExp(`\\b(?:show|display|get|give|create|build)?\\s*${metricPart}\\s+\\b(?:of|for|by|with)\\b\\s+(.+?)\\s+\\bas\\s+(?:${rowAxis})\\s+(?:and\\s+)?(.+?)\\s+\\bas\\s+(?:${columnAxis})\\b`, "i"));
    if (measureRowFirst?.[1] && measureRowFirst?.[2]) {
        return {
            rows: orderedDimensionPhrasesFromText(measureRowFirst[1]),
            columns: orderedDimensionPhrasesFromText(measureRowFirst[2])
        };
    }
    const keywordRowFirst = normalized.match(new RegExp(`\\b(?:${rowAxis})\\s*[:=]?\\s*(.+?)\\s+\\b(?:${columnAxis})\\s*[:=]?\\s*(.+?)(?=\\s+\\b(?:values?|measures?|metrics?)\\b|$)`, "i"));
    if (keywordRowFirst?.[1] && keywordRowFirst?.[2]) {
        return {
            rows: orderedDimensionPhrasesFromText(keywordRowFirst[1]),
            columns: orderedDimensionPhrasesFromText(keywordRowFirst[2])
        };
    }
    const keywordColumnFirst = normalized.match(new RegExp(`\\b(?:${columnAxis})\\s*[:=]?\\s*(.+?)\\s+\\b(?:${rowAxis})\\s*[:=]?\\s*(.+?)(?=\\s+\\b(?:values?|measures?|metrics?)\\b|$)`, "i"));
    if (keywordColumnFirst?.[1] && keywordColumnFirst?.[2]) {
        return {
            columns: orderedDimensionPhrasesFromText(keywordColumnFirst[1]),
            rows: orderedDimensionPhrasesFromText(keywordColumnFirst[2])
        };
    }
    const keywordRowOnly = normalized.match(new RegExp(`\\b(?:${rowAxis})\\s*[:=]?\\s*(.+?)(?=\\s+\\b(?:values?|measures?|metrics?|${columnAxis})\\b|$)`, "i"));
    if (keywordRowOnly?.[1]) {
        const rows = orderedDimensionPhrasesFromText(keywordRowOnly[1]);
        if (rows.length) return { rows, columns: [] };
    }
    return null;
}

function parseAutoPivotSlots(context: AssistantAnswerContext, normalized: string, metricPhrase: string | null): { rows: string[]; columns: string[] } | null {
    if (!metricPhrase) return null;
    if (!/\b(?:pivot|matrix|report|table|summary|by|with|across|grouped\s+by|split\s+by)\b/i.test(normalized)) return null;
    const metricIndex = normalized.indexOf(cleanText(metricPhrase));
    const afterMetric = metricIndex >= 0 ? normalized.slice(metricIndex + cleanText(metricPhrase).length) : normalized;
    const body = cleanSlot(afterMetric.replace(/^\s*(?:of|for|by|with|across|grouped\s+by|split\s+by)\s+/i, " "));
    const dims = orderedDimensionPhrasesFromText(body);
    return chooseAutoMatrixAxes(context, dims);
}

function splitCompareEntities(context: AssistantAnswerContext, normalized: string): string[] {
    const metric = metricPhraseFromText(context, normalized);
    let body = cleanSlot(normalized)
        .replace(/\bcompare|comparison|versus|vs|against|difference|better\b/g, " ")
        .replace(/\bboth|all|the\b/g, " ")
        .replace(/\bby\s+.+$/g, " ");
    if (metric) body = body.replace(new RegExp(escapeRegExp(cleanText(metric)), "ig"), " ");
    const exact = (context.entities || [])
        .filter((entity) => containsPhrase(body, entity.label) || (entity.aliases || []).some((alias) => containsPhrase(body, alias)))
        .sort((a, b) => b.label.length - a.label.length)
        .map((entity) => entity.label);
    if (exact.length >= 2) return unique(exact).slice(0, 4);
    return unique(body.split(/\s+(?:and|with|vs|versus|against|&)\s+|,/i).map(cleanSlot).filter(Boolean)).slice(0, 4);
}

export class AssistantDeterministicQueryPlanner {
    private context: AssistantAnswerContext;

    constructor(context: AssistantAnswerContext) {
        this.context = context;
    }

    updateContext(context: AssistantAnswerContext): void {
        this.context = context;
    }

    plan(question: string): DeterministicQueryPlan {
        const raw = String(question || "").trim();
        const normalized = cleanText(raw);
        if (!normalized) return { question: raw, changed: false, confidence: 0, intent: "unknown" };

        const chartType = detectChartType(normalized);
        const metricPhrases = metricPhrasesFromText(this.context, normalized);
        const metricPhrase = metricPhrases[0] || metricPhraseFromText(this.context, normalized);
        const filters = extractFilters(normalized);

        if (ATTRIBUTE_LOOKUP_RE.test(normalized)) {
            return {
                question: raw,
                changed: false,
                reason: "deterministic_attribute_guard",
                confidence: 0.94,
                intent: "attribute",
                metricPhrase,
                metricPhrases,
                entityPhrase: findEntityPhrase(this.context, normalized) || undefined,
                filterPhrases: filters,
                chartType
            };
        }

        if (MULTI_METRIC_LOOKUP_RE.test(normalized) && findEntityPhrase(this.context, normalized)) {
            return {
                question: raw,
                changed: false,
                reason: "deterministic_multi_metric_guard",
                confidence: 0.9,
                intent: "lookup",
                metricPhrase,
                metricPhrases,
                entityPhrase: findEntityPhrase(this.context, normalized) || undefined,
                filterPhrases: filters,
                chartType
            };
        }

        const matrixSlots = parseMatrixSlots(normalized, metricPhrase);
        if (matrixSlots && metricPhrase && (matrixSlots.columns.length || matrixSlots.rows.length)) {
            const matrixMetricText = metricPhrases.length > 1 ? metricPhrases.join(" and ") : metricPhrase;
            const rewritten = matrixSlots.columns.length
                ? `show ${matrixMetricText} of ${matrixSlots.columns.join(", ")} as columns and ${matrixSlots.rows.join(", ") || "assigned sales category"} as rows${filterSuffix(filters)}${chartSuffix(chartType)}`
                : `show ${matrixMetricText} matrix of ${matrixSlots.rows.join(", ")} as rows${filterSuffix(filters)}${chartSuffix(chartType || "table")}`;
            return {
                question: rewritten.replace(/\s+/g, " ").trim(),
                changed: cleanText(rewritten) !== normalized,
                reason: "deterministic_matrix_planner",
                confidence: 0.92,
                intent: "matrix",
                metricPhrase,
                metricPhrases,
                rowPhrases: matrixSlots.rows,
                columnPhrases: matrixSlots.columns,
                filterPhrases: filters,
                chartType
            };
        }

        const autoMatrixSlots = parseAutoPivotSlots(this.context, normalized, metricPhrase);
        if (autoMatrixSlots && metricPhrase && autoMatrixSlots.columns.length) {
            const matrixMetricText = metricPhrases.length > 1 ? metricPhrases.join(" and ") : metricPhrase;
            const rewritten = `show ${matrixMetricText} of ${autoMatrixSlots.columns.join(", ")} as columns and ${autoMatrixSlots.rows.join(", ")} as rows${filterSuffix(filters)}${chartSuffix(chartType || "table")}`.replace(/\s+/g, " ").trim();
            return {
                question: rewritten,
                changed: cleanText(rewritten) !== normalized,
                reason: "deterministic_pivot_planner",
                confidence: 0.86,
                intent: "matrix",
                metricPhrase,
                metricPhrases,
                rowPhrases: autoMatrixSlots.rows,
                columnPhrases: autoMatrixSlots.columns,
                filterPhrases: filters,
                chartType: chartType || "table"
            };
        }

        if (/\b(?:compare|comparison|versus|vs|against|difference|better)\b/i.test(normalized)) {
            const entities = splitCompareEntities(this.context, normalized);
            if (entities.length >= 2 && metricPhrase) {
                const rewritten = `compare ${entities.join(" and ")} by ${metricPhrase}${filterSuffix(filters)}${chartSuffix(chartType)}`.replace(/\s+/g, " ").trim();
                return {
                    question: rewritten,
                    changed: cleanText(rewritten) !== normalized,
                    reason: "deterministic_compare_planner",
                    confidence: 0.86,
                    intent: "compare",
                    metricPhrase,
                    entityPhrase: entities.join(", "),
                    filterPhrases: filters,
                    chartType
                };
            }
        }

        const dimension = dimensionFromText(normalized);
        if (dimension && metricPhrase && RANK_WORDS.test(normalized) && (TOP_WORDS.test(normalized) || BOTTOM_WORDS.test(normalized))) {
            const direction = BOTTOM_WORDS.test(normalized) && !TOP_WORDS.test(normalized) ? "bottom" : "top";
            const scope = extractScope(normalized);
            const rewritten = `${direction} ${extractLimit(normalized)} ${dimension.plural} by ${metricPhrase}${scope ? ` in ${scope}` : ""}${filterSuffix(filters)}${chartSuffix(chartType)}`.replace(/\s+/g, " ").trim();
            return {
                question: rewritten,
                changed: cleanText(rewritten) !== normalized,
                reason: "deterministic_rank_planner",
                confidence: 0.9,
                intent: "rank",
                metricPhrase,
                metricPhrases,
                entityPhrase: scope || undefined,
                filterPhrases: filters,
                chartType
            };
        }

        if (dimension && metricPhrase && (BREAKDOWN_CONNECTOR.test(normalized) || /\b(?:of|for)\s+(?:assigned\s+)?(?:sales\s+category|category|group|tenant\s+name|tenant|unit|zone|floor|layer)s?\b/i.test(normalized))) {
            const rewritten = `show ${metricPhrase} by ${dimension.plural}${filterSuffix(filters)}${chartSuffix(chartType)}`.replace(/\s+/g, " ").trim();
            return {
                question: rewritten,
                changed: cleanText(rewritten) !== normalized,
                reason: "deterministic_breakdown_planner",
                confidence: 0.84,
                intent: "breakdown",
                metricPhrase,
                metricPhrases,
                filterPhrases: filters,
                chartType
            };
        }

        const entityPhrase = metricPhrase ? findEntityPhrase(this.context, normalized) : null;
        if (metricPhrase && entityPhrase) {
            const aggregatePrefix = /\b(?:sum|total|aggregate|aggregated)\b/i.test(normalized) ? "sum of " : "";
            const rewritten = `show ${aggregatePrefix}${metricPhrase} for ${entityPhrase}${filterSuffix(filters)}${chartSuffix(chartType)}`.replace(/\s+/g, " ").trim();
            return {
                question: rewritten,
                changed: cleanText(rewritten) !== normalized,
                reason: "deterministic_lookup_planner",
                confidence: 0.86,
                intent: "lookup",
                metricPhrase,
                metricPhrases,
                entityPhrase,
                filterPhrases: filters,
                chartType
            };
        }

        return {
            question: raw,
            changed: false,
            confidence: 0.35,
            intent: "unknown",
            metricPhrase: metricPhrase || undefined,
            metricPhrases,
            filterPhrases: filters,
            chartType
        };
    }
}
