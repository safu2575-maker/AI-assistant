import { AssistantAnswerContext, ParsedTopBottomQuery } from "./assistantTypes";
import { normalizeAssistantText } from "./assistantParser";

export interface LocalSemanticPlan {
    question: string;
    changed: boolean;
    reason?: string;
    confidence: number;
}

type PlannerDimension = ParsedTopBottomQuery["dimensionType"];

interface DimensionRule {
    dimension: PlannerDimension;
    label: string;
    pattern: RegExp;
}

const DIMENSION_RULES: DimensionRule[] = [
    { dimension: "tenant", label: "tenants", pattern: /\b(?:assigned\s+tenant\s+name|tenant\s+name|tenants?|brands?|shops?|stores?|retailers?)\b/i },
    { dimension: "unit", label: "units", pattern: /\b(?:unit\s+id|unit\s+name|units?|spaces?|locations?)\b/i },
    { dimension: "category", label: "categories", pattern: /\b(?:assigned\s+sales\s+categor(?:y|ies)|sales\s+categor(?:y|ies)|categor(?:y|ies)|segments?|class(?:es|ifications?)?)\b/i },
    { dimension: "group", label: "groups", pattern: /\b(?:assigned\s+groups?|tenant\s+groups?|retail\s+groups?|groups?|departments?)\b/i },
    { dimension: "zone", label: "zones", pattern: /\b(?:regions?|zones?|areas?)\b/i },
    { dimension: "floor", label: "floors", pattern: /\b(?:floors?|levels?)\b/i },
    { dimension: "layer", label: "layers", pattern: /\b(?:layers?)\b/i }
];

const TOP_WORDS = /\b(?:top|highest|largest|biggest|maximum|max|best|most|leading|main|greater|greatest)\b/i;
const BOTTOM_WORDS = /\b(?:bottom|lowest|smallest|minimum|min|least|worst|weakest|poorest|lower)\b/i;
const RANK_WORDS = /\b(?:top|bottom|highest|largest|biggest|maximum|max|best|most|lowest|smallest|minimum|min|least|worst|rank|ranking|which|who)\b/i;
const CHART_SCOPE_WORDS = /\b(?:bar|column|line|pie|donut|doughnut|area)?\s*(?:chart|graph|visual|plot|table)\b/i;
const MATRIX_WORDS = /\b(?:rows?|columns?|pivot|matrix)\b/i;
const BREAKDOWN_WORDS = /\b(?:by|across|per|split\s+by|grouped\s+by)\b/i;
const SUM_WORDS = /\b(?:sum|total|aggregate|aggregated)\b/i;
const ATTRIBUTE_LOOKUP_RE = /\b(?:what|which|show|tell|get|give)\b\s*(?:is|are|the|me|please|can|you|show|tell|give|get|find|value|field|assigned)*\s*(?:the\s+)?(?:assigned\s+sales\s+category|sales\s+category|assigned\s+category|category|assigned\s+group|group|assigned\s+tenant\s+name|tenant\s+name|tenant|assigned\s+unit|unit\s+id|unit|floor|level)\s+(?:of|for)\s+.+$/i;

function cleanPlannerText(value: string): string {
    return normalizeAssistantText(value)
        .replace(/\bassigned\s+/g, "assigned ")
        .replace(/\btenant\s+names?\b/g, "tenant name")
        .replace(/\bsales\s+categories\b/g, "sales category")
        .replace(/\bregions\b/g, "region")
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

function dimensionFromText(normalized: string): DimensionRule | null {
    for (const rule of DIMENSION_RULES) {
        if (rule.pattern.test(normalized)) return rule;
    }
    return null;
}

function extractLimit(normalized: string): number {
    const numeric = normalized.match(/\btop\s+(\d{1,3})\b|\bbottom\s+(\d{1,3})\b/);
    const parsed = Number(numeric?.[1] || numeric?.[2] || 0);
    if (Number.isFinite(parsed) && parsed > 0) return Math.min(100, parsed);
    if (/\btop\s+ten\b|\bbottom\s+ten\b/i.test(normalized)) return 10;
    if (/\btop\s+five\b|\bbottom\s+five\b/i.test(normalized)) return 5;
    if (/\btop\s+three\b|\bbottom\s+three\b/i.test(normalized)) return 3;
    if (/\btop\s+one\b|\bbottom\s+one\b/i.test(normalized)) return 1;
    if (/\b(?:largest|highest|biggest|lowest|smallest|best|worst)\b/i.test(normalized)) return 5;
    return 5;
}

function stripChartWords(value: string): string {
    return String(value || "")
        .replace(/\b(?:in|as|with)\s+(?:a\s+)?(?:bar|column|line|pie|donut|doughnut|area)?\s*(?:chart|graph|visual|plot|table)\b/gi, " ")
        .replace(/\b(?:bar|column|line|pie|donut|doughnut|area)?\s*(?:chart|graph|visual|plot|table)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function containsPhrase(normalized: string, phrase: string): boolean {
    const clean = cleanPlannerText(phrase);
    if (!clean || clean.length < 2) return false;
    return new RegExp(`(?:^|\\s)${escapeRegExp(clean)}(?:\\s|$)`, "i").test(normalized);
}

function metricPhraseFromText(context: AssistantAnswerContext, normalized: string): string | null {
    const text = stripChartWords(normalized);
    if (/\b(?:sum|total)\s+of\s+area\b/i.test(text)) return "sum of area";
    if (/\b(?:sum|total)\s+of\s+(?:sqm|sq\s*m|m2|size|gla)\b/i.test(text)) return "area";
    if (/\b(?:sales|revenue|turnover)\s*(?:per|\/)?\s*(?:sqm|sq\s*m|m2|area)\b|\b(?:sales|revenue|turnover)\s+density\b|\bspace\s+productivity\b/i.test(text)) return "sales/sqm";
    if (/\b(?:rent|rental|lease)\s*(?:per|\/)?\s*(?:sqm|sq\s*m|m2|area)\b/i.test(text)) return "rent/sqm";
    const candidates = (context.metrics || [])
        .flatMap((metric) => unique([metric.name].concat(metric.aliases || [])).map((phrase) => ({ phrase, metricName: metric.name })))
        .filter((candidate) => cleanPlannerText(candidate.phrase).length >= 3)
        .sort((a, b) => cleanPlannerText(b.phrase).length - cleanPlannerText(a.phrase).length);
    for (const candidate of candidates) {
        if (containsPhrase(text, candidate.phrase)) return candidate.metricName;
    }

    if (/\b(?:sum|total)?\s*(?:of\s+)?area\b|\b(?:sqm|m2|gla|size)\b/i.test(text)) return "area";
    if (/\b(?:ocr|occupancy\s+cost|cost\s+ratio|rent\s+to\s+sales)\b/i.test(text)) return "ocr";
    if (/\b(?:occupancy|occupied)\b/i.test(text)) return "occupancy";
    if (/\b(?:vacancy|vacant|empty|available|unleased)\b/i.test(text)) return "vacant units";
    if (/\b(?:units?|stores?|shops?)\b/i.test(text) && /\b(?:count|number|how\s+many|total)\b/i.test(text)) return "units";
    if (/\b(?:sales|revenue|turnover|income)\b/i.test(text)) return "sales";
    if (/\b(?:rent|rental|lease|erv)\b/i.test(text)) return "rent";
    return null;
}

function findEntityPhrase(context: AssistantAnswerContext, normalized: string): string | null {
    const text = stripChartWords(normalized);
    const candidates = (context.entities || [])
        .flatMap((entity) => unique([entity.label].concat(entity.aliases || [])).map((phrase) => ({ phrase, label: entity.label })))
        .filter((candidate) => cleanPlannerText(candidate.phrase).length >= 3)
        .sort((a, b) => cleanPlannerText(b.phrase).length - cleanPlannerText(a.phrase).length);
    for (const candidate of candidates) {
        if (containsPhrase(text, candidate.phrase)) return candidate.label;
    }
    return null;
}

function extractRankScope(normalized: string): string {
    const withoutChart = stripChartWords(normalized);
    const byMetricRemoved = withoutChart.replace(/\bby\s+.+?(?=\s+(?:in|inside|within|under|from|on|at)\s+|$)/i, " ");
    const scopeMatch = byMetricRemoved.match(/\b(?:in|inside|within|under|from|on|at)\s+(.+)$/i);
    if (scopeMatch?.[1]) return scopeMatch[1].replace(/\s+/g, " ").trim();

    const prefix = withoutChart.match(/^(.+?)\s+\b(?:top|bottom|highest|largest|biggest|maximum|max|best|most|lowest|smallest|minimum|min|least|worst)\b/i);
    const prefixText = prefix?.[1]?.trim() || "";
    if (!prefixText || dimensionFromText(prefixText) || metricPhraseFromText({ rows: [], metrics: [], entities: [], getMetricValue: () => 0, formatMetricValue: () => "", formatNumber: () => "" }, prefixText)) return "";
    if (/\b(?:show|find|give|tell|which|who|what|please)\b/i.test(prefixText)) return "";
    return prefixText;
}

function appendPresentation(original: string): string {
    const normalized = cleanPlannerText(original);
    const match = normalized.match(/\b(?:in|as|with)\s+(?:a\s+)?((?:bar|column|line|pie|donut|doughnut|area)\s+chart|table|chart|graph|visual|plot)\b/i);
    if (!match?.[1]) return "";
    const presentation = match[1].replace(/\bdoughnut\b/i, "donut");
    if (presentation === "graph" || presentation === "visual" || presentation === "plot" || presentation === "chart") return " in bar chart";
    return ` in ${presentation}`;
}

export class AssistantLocalSemanticPlanner {
    private context: AssistantAnswerContext;

    constructor(context: AssistantAnswerContext) {
        this.context = context;
    }

    updateContext(context: AssistantAnswerContext): void {
        this.context = context;
    }

    plan(question: string): LocalSemanticPlan {
        const raw = String(question || "").trim();
        const normalized = cleanPlannerText(raw);
        if (!normalized) return { question: raw, changed: false, confidence: 0 };
        if (ATTRIBUTE_LOOKUP_RE.test(normalized)) return { question: raw, changed: false, reason: "attribute_lookup_guard", confidence: 0.9 };

        const rank = this.planRank(raw, normalized);
        if (rank.changed) return rank;

        const breakdown = this.planBreakdownOrLookup(raw, normalized);
        if (breakdown.changed) return breakdown;

        return { question: raw, changed: false, confidence: 0.35 };
    }

    private planRank(raw: string, normalized: string): LocalSemanticPlan {
        if (MATRIX_WORDS.test(normalized)) return { question: raw, changed: false, confidence: 0.25 };
        if (!RANK_WORDS.test(normalized)) return { question: raw, changed: false, confidence: 0.25 };

        const dimension = dimensionFromText(normalized);
        const metricPhrase = metricPhraseFromText(this.context, normalized);
        if (!dimension || !metricPhrase) return { question: raw, changed: false, confidence: 0.45 };

        const direction = BOTTOM_WORDS.test(normalized) && !TOP_WORDS.test(normalized) ? "bottom" : "top";
        const limit = extractLimit(normalized);
        const scope = extractRankScope(normalized);
        const presentation = appendPresentation(raw);
        const rewritten = `${direction} ${limit} ${dimension.label} by ${metricPhrase}${scope ? ` in ${scope}` : ""}${presentation}`.replace(/\s+/g, " ").trim();
        if (cleanPlannerText(rewritten) === normalized) return { question: raw, changed: false, confidence: 0.9 };
        return { question: rewritten, changed: true, reason: "local_semantic_planner_rank", confidence: 0.9 };
    }

    private planBreakdownOrLookup(raw: string, normalized: string): LocalSemanticPlan {
        if (MATRIX_WORDS.test(normalized)) return { question: raw, changed: false, confidence: 0.3 };
        const metricPhrase = metricPhraseFromText(this.context, normalized);
        if (!metricPhrase) return { question: raw, changed: false, confidence: 0.35 };

        const dimension = dimensionFromText(normalized);
        if (dimension && BREAKDOWN_WORDS.test(normalized) && !CHART_SCOPE_WORDS.test(normalized.replace(dimension.label, ""))) {
            const presentation = appendPresentation(raw);
            const rewritten = `show ${metricPhrase} by ${dimension.label}${presentation}`.replace(/\s+/g, " ").trim();
            return { question: rewritten, changed: true, reason: "local_semantic_planner_breakdown", confidence: 0.82 };
        }

        const entityPhrase = findEntityPhrase(this.context, normalized);
        if (!entityPhrase) return { question: raw, changed: false, confidence: 0.45 };
        const presentation = appendPresentation(raw);
        const aggregatePrefix = SUM_WORDS.test(normalized) ? "sum of " : "";
        const rewritten = `show ${aggregatePrefix}${metricPhrase} for ${entityPhrase}${presentation}`.replace(/\s+/g, " ").trim();
        return { question: rewritten, changed: true, reason: "local_semantic_planner_lookup", confidence: 0.84 };
    }
}
