import { AssistantAnswerContext, AssistantMetric, ParsedTopBottomQuery } from "./assistantTypes";
import { normalizeAssistantText } from "./assistantParser";
import { AssistantTransformerSemantic, TransformerSemanticRewrite } from "./assistantTransformerSemantic";
import { AssistantLocalSemanticPlanner } from "./assistantLocalSemanticPlanner";
import { AssistantDeterministicQueryPlanner } from "./assistantDeterministicQueryPlanner";

type SemanticMetricKind = "sales" | "rent" | "ocr" | "occupancy" | "vacancy" | "area" | "units" | "default";

interface SemanticRewriteRule {
    name: string;
    pattern: RegExp;
    direction: ParsedTopBottomQuery["direction"];
    metricKind: SemanticMetricKind;
    defaultDimension: ParsedTopBottomQuery["dimensionType"];
}

export interface AssistantSemanticRewrite {
    question: string;
    changed: boolean;
    reason?: string;
}

type CorrectionSource = "command" | "metric" | "entity";

interface CorrectionTerm {
    term: string;
    source: CorrectionSource;
}

const EXPLICIT_ANALYTIC_WORDS = /\b(top|bottom|highest|lowest|largest|smallest|max|min|rank|ranking|compare|vs|versus|against|formula|calculation|definition|trend|history|matrix|pivot|rows?|columns?|cols?|benchmark|percentile)\b/i;
const EXPLICIT_METRIC_WORDS = /\b(sales?|revenue|turnover|rent|rental|lease|ocr|occupancy|vacancy|vacant|area|sqm|m2|units?|gla)\b/i;
const SCOPE_RE = /\b(in|inside|within|under|from|for|on|at)\s+(.+?)$/i;
const PROTECTED_CORRECTION_WORDS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "by", "can", "for", "from", "has", "have", "having",
    "i", "in", "is", "me", "of", "on", "or", "the", "to", "with", "without", "than", "then",
    "top", "bottom", "highest", "lowest", "largest", "smallest", "best", "worst", "most", "least",
    "area", "sqm", "m2", "rent", "sales", "revenue", "ocr", "occupancy", "vacancy", "vacant", "units",
    "tenant", "tenants", "unit", "category", "group", "zone", "floor", "layer"
]);
const COMMAND_CORRECTION_WORDS = [
    "what", "which", "who", "where", "show", "tell", "find", "give", "list", "compare", "summarize",
    "summary", "explain", "why", "formula", "calculation", "trend", "history", "top", "bottom",
    "highest", "lowest", "largest", "smallest", "biggest", "maximum", "minimum", "best", "worst",
    "weak", "poor", "bad", "strong", "risk", "risky", "expensive", "costly", "vacant", "available",
    "empty", "occupied", "tenant", "unit", "category", "group", "zone", "floor", "layer", "area",
    "rent", "sales", "revenue", "turnover", "ocr", "occupancy", "units", "benchmark", "percentile"
];

const BUSINESS_REWRITE_RULES: SemanticRewriteRule[] = [
    {
        name: "weak_performance",
        pattern: /\b(weak|poor|bad|underperform(?:ing)?|low\s+perform(?:ing|ance)|not\s+doing\s+well|doing\s+bad|struggl(?:e|ing)|slow)\b/i,
        direction: "bottom",
        metricKind: "sales",
        defaultDimension: "tenant"
    },
    {
        name: "strong_performance",
        pattern: /\b(strong|best\s+perform(?:ing|ance)|top\s+perform(?:ing|ance)|good\s+perform(?:ing|ance)|doing\s+well|successful|winner|winners)\b/i,
        direction: "top",
        metricKind: "sales",
        defaultDimension: "tenant"
    },
    {
        name: "rent_pressure",
        pattern: /\b(rent\s+pressure|cost\s+pressure|lease\s+pressure|rent\s+stress|occupancy\s+cost\s+pressure|too\s+expensive|over\s*rented|overpriced)\b/i,
        direction: "top",
        metricKind: "ocr",
        defaultDimension: "tenant"
    },
    {
        name: "expensive",
        pattern: /\b(expensive|costly|highest\s+cost|high\s+rent|big\s+rent|large\s+rent)\b/i,
        direction: "top",
        metricKind: "rent",
        defaultDimension: "tenant"
    },
    {
        name: "risk",
        pattern: /\b(risk|risky|at\s+risk|problem(?:atic)?|issue|issues|concern|concerns|red\s+flag|redflag)\b/i,
        direction: "top",
        metricKind: "ocr",
        defaultDimension: "tenant"
    },
    {
        name: "space_efficiency",
        pattern: /\b(productive|productivity|efficient|efficiency|sales\s+density|revenue\s+density)\b/i,
        direction: "top",
        metricKind: "sales",
        defaultDimension: "tenant"
    }
];

function metricHaystack(metric: AssistantMetric): string {
    return [metric.name, metric.description || "", metric.formula || ""]
        .concat(metric.aliases || [])
        .join(" ")
        .toLowerCase();
}

function metricMatchesKind(metric: AssistantMetric, kind: SemanticMetricKind): boolean {
    const h = metricHaystack(metric);
    if (kind === "sales") return /\b(sales?|revenue|turnover|income|sales\s+productivity|rev)\b/.test(h);
    if (kind === "rent") return /\b(rent|rental|lease|erv|base\s+rent|passing\s+rent|contracted\s+rent)\b/.test(h);
    if (kind === "ocr") return /\b(ocr|occupancy\s+cost|cost\s+ratio|rent\s+to\s+sales|rent\s+sales\s+ratio)\b/.test(h);
    if (kind === "occupancy") return /\b(occupancy|occupied|leased)\b/.test(h);
    if (kind === "vacancy") return /\b(vacant|vacancy|empty|available|unleased)\b/.test(h);
    if (kind === "area") return /\b(area|sqm|sq\s*m|m2|gla)\b/.test(h);
    if (kind === "units") return /\b(units?|stores?|shops?)\b/.test(h);
    return false;
}

function genericMetricPhrase(kind: SemanticMetricKind): string {
    if (kind === "sales") return "sales";
    if (kind === "rent") return "rent";
    if (kind === "ocr") return "ocr";
    if (kind === "occupancy") return "occupancy";
    if (kind === "vacancy") return "vacant units";
    if (kind === "area") return "area";
    if (kind === "units") return "units";
    return "";
}

function detectDimension(normalized: string, fallback: ParsedTopBottomQuery["dimensionType"]): ParsedTopBottomQuery["dimensionType"] {
    if (/\b(units?|spaces?|locations?)\b/i.test(normalized)) return "unit";
    if (/\b(categor(?:y|ies)|segments?|class(?:es|ifications?)?|types?)\b/i.test(normalized)) return "category";
    if (/\b(groups?|departments?)\b/i.test(normalized)) return "group";
    if (/\b(zones?|areas?)\b/i.test(normalized)) return "zone";
    if (/\b(floors?|levels?)\b/i.test(normalized)) return "floor";
    return fallback;
}

function dimensionLabel(dimension: ParsedTopBottomQuery["dimensionType"]): string {
    if (dimension === "category") return "categories";
    return `${dimension}s`;
}

function dimensionFieldLabel(dimension: ParsedTopBottomQuery["dimensionType"]): string {
    if (dimension === "category") return "assigned sales category";
    if (dimension === "group") return "assigned group";
    if (dimension === "tenant") return "assigned tenant name";
    if (dimension === "unit") return "unit";
    if (dimension === "floor") return "floor";
    if (dimension === "zone") return "zone";
    if (dimension === "layer") return "layer";
    return dimensionLabel(dimension);
}

function explicitMetricPhrase(normalized: string, fallback: string): string {
    if (/\b(?:sum|total)\s+of\s+area\b/i.test(normalized)) return "sum of area";
    if (/\b(?:sales|revenue|turnover)\s*(?:per|\/)?\s*(?:sqm|sq\s*m|m2|area)\b|\bsales\/sqm\b/i.test(normalized)) return "sales/sqm";
    if (/\b(?:rent|rental|lease)\s*(?:per|\/)?\s*(?:sqm|sq\s*m|m2|area)\b|\brent\/sqm\b/i.test(normalized)) return "rent/sqm";
    return fallback;
}

function canonicalSubject(value: string): { singular: string; plural: string; kind: ParsedTopBottomQuery["dimensionType"] } | null {
    const clean = normalizeAssistantText(value);
    if (/\b(?:tenants?|tenant names?|brands?|shops?|stores?|retailers?)\b/i.test(clean)) return { singular: "tenant", plural: "tenants", kind: "tenant" };
    if (/\b(?:units?|unit ids?|unit names?|spaces?|locations?)\b/i.test(clean)) return { singular: "unit", plural: "units", kind: "unit" };
    if (/\b(?:categor(?:y|ies)|sales categor(?:y|ies)|segments?|classes|classifications?)\b/i.test(clean)) return { singular: "category", plural: "categories", kind: "category" };
    if (/\b(?:groups?|departments?)\b/i.test(clean)) return { singular: "group", plural: "groups", kind: "group" };
    if (/\b(?:zones?|regions?|areas?)\b/i.test(clean)) return { singular: "zone", plural: "zones", kind: "zone" };
    if (/\b(?:floors?|levels?)\b/i.test(clean)) return { singular: "floor", plural: "floors", kind: "floor" };
    if (/\b(?:layers?)\b/i.test(clean)) return { singular: "layer", plural: "layers", kind: "layer" };
    return null;
}

function normalizeQuestionWords(value: string): string {
    return normalizeAssistantText(value)
        .replace(/\bunit\s+sin\b/g, "units in")
        .replace(/\bunitsin\b/g, "units in")
        .replace(/\btenantsin\b/g, "tenants in")
        .replace(/\b(?:ther|thre|tere|threre)\b/g, "there")
        .replace(/\b(?:frist|fisrt|frst)\b/g, "first")
        .replace(/\b(?:secnd|seconf|scnd)\b/g, "second")
        .replace(/\b(?:thrid|thrd|thirt|thirst|thirsd)\b/g, "third")
        .replace(/\b(?:no|num|nbr)\s+of\b/g, "number of")
        .replace(/\bhow\s+much\s+(units?|tenants?|stores?|shops?|brands?)\b/g, "how many $1")
        .replace(/\b(?:are|is|was|were)\s+th?ere\b/g, "are there")
        .replace(/\s+/g, " ")
        .trim();
}

function cleanCanonicalSlot(value: string): string {
    return normalizeAssistantText(value)
        .replace(/\b(?:please|show|tell|give|get|find|me|the|a|an|there|are|is|was|were|has|have)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function canonicalRankDirection(value: string): "top" | "bottom" {
    return /\b(?:bottom|lowest|least|smallest|min|minimum|worst|weakest|poorest)\b/i.test(value) ? "bottom" : "top";
}

function stripScopeFromMetricPhrase(value: string): string {
    return cleanCanonicalSlot(value)
        .replace(/\s+\b(?:in|inside|within|under|from|for|on|at)\b\s+.+$/i, "")
        .trim();
}

function rewriteCommonQuestionParaphrase(question: string): AssistantSemanticRewrite {
    const normalized = normalizeQuestionWords(question);
    if (!normalized) return { question, changed: false };

    const countTarget = normalized.match(/\b(?:how\s+many|count|number\s+of|number|total(?:\s+number\s+of)?)\s+(tenants?|tenant names?|brands?|shops?|stores?|units?|unit ids?|categories|category|groups?|zones?|floors?|levels?|layers?)\b/i)
        || normalized.match(/\b(tenants?|brands?|shops?|stores?|units?|categories|category|groups?|zones?|floors?|levels?|layers?)\s+(?:are|is|was|were)?\s*(?:there\s+)?(?:in|inside|within|under|on|at|for|$)/i);
    if (countTarget?.[1] && /\b(?:how\s+many|count|number|total|there)\b/i.test(normalized)) {
        const subject = canonicalSubject(countTarget[1]);
        const scope = normalized.match(/\b(?:in|inside|within|under|on|at|for)\s+(.+)$/i)?.[1] || "";
        if (subject) {
            const rewritten = `how many ${subject.plural}${scope ? ` in ${cleanCanonicalSlot(scope)}` : ""}`.trim();
            if (rewritten && rewritten !== normalizeAssistantText(question)) return { question: rewritten, changed: true, reason: "common_count_paraphrase" };
        }
    }

    const drilldownListMatch = normalized.match(/\b(?:show|list|display)\s+(?:all\s+)?(tenants?|tenant names?|brands?|shops?|stores?)\s+\b(?:under|within|inside)\s+each\s+(groups?|categories|category|zones?|floors?|levels?|layers?)\s+\b(?:by|using|with)\b\s+(.+)$/i);
    if (drilldownListMatch?.[2] && drilldownListMatch?.[3]) {
        const parent = canonicalSubject(drilldownListMatch[2]);
        const metric = cleanCanonicalSlot(drilldownListMatch[3]);
        if (parent && metric) return { question: `show ${metric} by ${parent.singular} and tenant`, changed: true, reason: "common_matrix_drilldown_paraphrase" };
    }

    const listMatch = normalized.match(/\b(?:which|what|who|show|list|display)\s+(?:are|is|all\s+)?(tenants?|tenant names?|brands?|shops?|stores?|units?)\s+(?:are\s+|is\s+)?(?:in|inside|within|under|from|for|on|at)\s+(.+)$/i)
        || normalized.match(/\b(?:who|what)\s+(?:is|are)\s+(?:in|inside|within|under|from|for|on|at)\s+(.+)$/i);
    if (listMatch) {
        const subjectText = listMatch[2] ? listMatch[1] : "tenants";
        const subject = canonicalSubject(subjectText || "tenants");
        const scope = cleanCanonicalSlot(listMatch[2] || listMatch[1] || "");
        if (subject && scope) return { question: `list ${subject.plural} in ${scope}`, changed: true, reason: "common_list_paraphrase" };
    }

    const rankMatch = normalized.match(/\b(?:which|what|who)\s+(tenants?|tenant names?|brands?|shops?|stores?|units?|categories|category|groups?|zones?|floors?|levels?|layers?)?\s*(?:has|have|having|with|is|are)?\s*(top|highest|largest|biggest|maximum|max|best|most|leading|bottom|lowest|smallest|minimum|min|least|worst|weakest|poorest)\s+(.+)$/i)
        || normalized.match(/\b(top|highest|largest|biggest|maximum|max|best|most|leading|bottom|lowest|smallest|minimum|min|least|worst|weakest|poorest)\s+(tenants?|tenant names?|brands?|shops?|stores?|units?|categories|category|groups?|zones?|floors?|levels?|layers?)\s+(?:by|for|with|on)\s+(.+)$/i);
    if (rankMatch) {
        const first = rankMatch[1] || "";
        const second = rankMatch[2] || "";
        const third = rankMatch[3] || "";
        const subject = canonicalSubject(first) || canonicalSubject(second) || { singular: "tenant", plural: "tenants", kind: "tenant" as ParsedTopBottomQuery["dimensionType"] };
        const directionWord = canonicalSubject(first) ? second : first;
        const metric = stripScopeFromMetricPhrase(third);
        if (metric) return { question: `${canonicalRankDirection(directionWord)} 1 ${subject.plural} by ${metric}`, changed: true, reason: "common_rank_paraphrase" };
    }

    const compareMatch = normalized.match(/\b(?:difference|diff|compare|comparison)\s+(?:between\s+)?(.+?)\s+(?:and|vs|versus|against)\s+(.+?)(?:\s+(?:by|using|with|for|on)\s+(.+))?$/i);
    if (compareMatch?.[1] && compareMatch?.[2]) {
        const left = cleanCanonicalSlot(compareMatch[1]);
        const right = cleanCanonicalSlot(compareMatch[2]);
        const metric = stripScopeFromMetricPhrase(compareMatch[3] || "");
        if (left && right) return { question: `compare ${left} and ${right}${metric ? ` by ${metric}` : ""}`, changed: true, reason: "common_compare_paraphrase" };
    }

    const breakdownMatch = normalized.match(/\b(?:breakdown|break\s+down|split|summary|summarize)\s+(?:of\s+)?(.+?)\s+(?:by|per|across|for\s+each|grouped\s+by|split\s+by)\s+(.+)$/i)
        || normalized.match(/^(.+?)\s+(?:by|per|across|for\s+each|grouped\s+by|split\s+by)\s+(.+)$/i)
        || normalized.match(/^(.+?)\s+wise\s+(.+)$/i)
        || normalized.match(/^(.+?)\s+(.+?)\s+wise$/i);
    if (breakdownMatch?.[1] && breakdownMatch?.[2]) {
        const left = cleanCanonicalSlot(breakdownMatch[1]);
        const right = cleanCanonicalSlot(breakdownMatch[2]);
        const leftSubject = canonicalSubject(left);
        const rightSubject = canonicalSubject(right);
        if (left && right && (leftSubject || rightSubject)) {
            const metric = leftSubject && !rightSubject ? right : left;
            const dimension = leftSubject && !rightSubject ? left : right;
            return { question: `show ${metric} by ${dimension}`, changed: true, reason: "common_breakdown_paraphrase" };
        }
    }

    return { question, changed: false };
}

function isDirectMatrixQuestion(normalized: string): boolean {
    const dim = "(?:assigned\\s+)?(?:tenant\\s+names?|tenants?|units?|unit\\s+ids?|sales\\s+categor(?:y|ies)|categor(?:y|ies)|cat(?:s)?|groups?|zones?|floors?|layers?)";
    const metric = "(?:sum\\s+of\\s+area|area|sqm|sales\\s*/?\\s*sqm|sales|rent|ocr|occupancy|units?|earliest|latest)";
    return /\b(?:matrix|pivot|cross\s*tab|crosstab|rows?|columns?|cols?)\b/i.test(normalized)
        || /\bwise\b.+\b(?:split\s+by|by|across)\b/i.test(normalized)
        || new RegExp(`\\b${dim}\\b\\s+(?:vs|versus|against|x)\\s+\\b${dim}\\b.+\\b${metric}\\b`, "i").test(normalized)
        || new RegExp(`\\bcompare\\s+${dim}\\s+(?:and|vs|versus|against)\\s+${dim}\\s+(?:using|by|with)\\b`, "i").test(normalized)
        || new RegExp(`\\btop\\s+\\d{1,3}\\s+${dim}\\s+by\\s+.+?\\s+(?:per|by|for\\s+each|under\\s+each)\\s+${dim}\\b`, "i").test(normalized)
        || new RegExp(`\\b${metric}\\b.+\\b(?:by|with|across|split\\s+by)\\b\\s+${dim}\\s+(?:and|,|>)\\s+${dim}\\b`, "i").test(normalized)
        || new RegExp(`\\b${metric}\\b\\s+(?:and|plus|,)\\s+\\b${metric}\\b.+\\b(?:by|with|across)\\b\\s+${dim}\\b`, "i").test(normalized);
}

function explicitMetricPhrases(context: AssistantAnswerContext, raw: string, normalized: string, fallback: string): string[] {
    const text = `${raw || ""} ${normalized || ""}`.toLowerCase().replace(/[?!.;:()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
    const matches: Array<{ name: string; index: number; length: number }> = [];
    (context.metrics || []).forEach((metric) => {
        [metric.name].concat(metric.aliases || []).forEach((label) => {
            const clean = String(label || "").toLowerCase().replace(/[?!.;:()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
            if (clean.length < 3) return;
            const index = text.indexOf(clean);
            const outputName = /\b(?:sum|total|average|avg|min|max|earliest|latest)\b/i.test(String(label || ""))
                ? String(label || metric.name).trim()
                : metric.name;
            if (index >= 0) matches.push({ name: outputName, index, length: clean.length });
        });
    });
    if (/\b(?:sum|total)\s+of\s+area\b/i.test(text) && !matches.some((match) => /^area$/i.test(match.name))) {
        matches.push({ name: "sum of area", index: text.search(/\b(?:sum|total)\s+of\s+area\b/i), length: 11 });
    }
    matches.sort((a, b) => a.index - b.index || b.length - a.length);
    const occupied: Array<{ start: number; end: number }> = [];
    const out: string[] = [];
    matches.forEach((match) => {
        const start = match.index;
        const end = match.index + match.length;
        if (occupied.some((range) => start < range.end && end > range.start)) return;
        occupied.push({ start, end });
        if (!out.some((item) => item.toLowerCase() === match.name.toLowerCase())) out.push(match.name);
    });
    return out.length ? out.slice(0, 6) : [explicitMetricPhrase(normalized, fallback)];
}

function cleanScopeSuffix(question: string): string {
    const match = String(question || "").match(SCOPE_RE);
    if (!match?.[0]) return "";
    const suffix = match[0]
        .replace(/\b(by|with|using|based\s+on)\b.+$/i, "")
        .replace(/[?!.;]+$/g, "")
        .replace(/\s+/g, " ")
        .trim();
    if (!suffix) return "";
    if (/\b(metric|measure|kpi|sales|revenue|rent|ocr|occupancy|area|sqm|m2|units?)\b/i.test(suffix)) return "";
    return ` ${suffix}`;
}

function hasGenericRetailSubject(normalized: string): boolean {
    return /\b(tenants?|brands?|shops?|stores?|retailers?|units?|categories|category|groups?|zones?|floors?|spaces?)\b/i.test(normalized);
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

function maxCorrectionDistance(token: string): number {
    const length = token.length;
    if (length < 4) return 0;
    if (length <= 5) return 1;
    if (length <= 8) return 2;
    return 3;
}

function correctionScore(source: CorrectionSource, distance: number, tokenLength: number): number {
    const sourceBias = source === "command" ? 0 : source === "metric" ? 0.04 : 0.06;
    return distance / Math.max(1, tokenLength) + sourceBias;
}

export class AssistantSemanticLayer {
    private context: AssistantAnswerContext;
    private correctionVocabulary: CorrectionTerm[] = [];
    private correctionExact = new Set<string>();
    private transformerSemantic: AssistantTransformerSemantic;
    private deterministicPlanner: AssistantDeterministicQueryPlanner;
    private localPlanner: AssistantLocalSemanticPlanner;

    constructor(context: AssistantAnswerContext) {
        this.context = context;
        this.transformerSemantic = new AssistantTransformerSemantic(context);
        this.deterministicPlanner = new AssistantDeterministicQueryPlanner(context);
        this.localPlanner = new AssistantLocalSemanticPlanner(context);
        this.rebuildCorrectionVocabulary();
        this.transformerSemantic.warmUp();
    }

    updateContext(context: AssistantAnswerContext): void {
        this.context = context;
        this.transformerSemantic.updateContext(context);
        this.deterministicPlanner.updateContext(context);
        this.localPlanner.updateContext(context);
        this.rebuildCorrectionVocabulary();
        this.transformerSemantic.warmUp();
    }

    rewriteQuestion(question: string): AssistantSemanticRewrite {
        const raw = String(question || "").trim();
        const rawNormalized = normalizeAssistantText(raw);
        if (rawNormalized && isDirectMatrixQuestion(rawNormalized)) {
            return { question: raw, changed: false, reason: "direct_matrix_question" };
        }
        const correctedRaw = this.correctQuestionText(raw);
        return this.rewriteCorrectedQuestion(raw, correctedRaw, null);
    }

    async rewriteQuestionAsync(question: string): Promise<AssistantSemanticRewrite> {
        const raw = String(question || "").trim();
        const rawNormalized = normalizeAssistantText(raw);
        if (rawNormalized && isDirectMatrixQuestion(rawNormalized)) {
            return { question: raw, changed: false, reason: "direct_matrix_question" };
        }
        const correctedRaw = this.correctQuestionText(raw);
        const transformerRewrite = await this.transformerSemantic.suggestRewrite(correctedRaw);
        return this.rewriteCorrectedQuestion(raw, correctedRaw, transformerRewrite);
    }

    private rewriteCorrectedQuestion(raw: string, correctedRaw: string, transformerRewrite: TransformerSemanticRewrite | null): AssistantSemanticRewrite {
        const normalized = normalizeAssistantText(correctedRaw);
        if (!normalized) return { question: raw, changed: false };
        if (isDirectMatrixQuestion(normalized)) {
            return {
                question: correctedRaw,
                changed: correctedRaw !== raw,
                reason: correctedRaw !== raw ? "typo_correction" : "direct_matrix_question"
            };
        }

        const rawCommonParaphrase = rewriteCommonQuestionParaphrase(raw);
        if (rawCommonParaphrase.changed) return rawCommonParaphrase;

        const commonParaphrase = rewriteCommonQuestionParaphrase(correctedRaw);
        if (commonParaphrase.changed) return commonParaphrase;

        const deterministicPlan = this.deterministicPlanner.plan(correctedRaw);
        if (deterministicPlan.confidence >= 0.82) {
            if (deterministicPlan.reason === "deterministic_attribute_guard" || deterministicPlan.reason === "deterministic_multi_metric_guard") {
                return {
                    question: correctedRaw,
                    changed: correctedRaw !== raw,
                    reason: correctedRaw !== raw ? "typo_correction" : undefined
                };
            }
            if (deterministicPlan.intent === "matrix" && !deterministicPlan.changed) {
                return {
                    question: correctedRaw,
                    changed: correctedRaw !== raw,
                    reason: correctedRaw !== raw ? "typo_correction" : deterministicPlan.reason
                };
            }
            if (deterministicPlan.changed) {
                return {
                    question: deterministicPlan.question,
                    changed: true,
                    reason: deterministicPlan.reason || "deterministic_query_planner"
                };
            }
        }

        const localPlan = this.localPlanner.plan(correctedRaw);
        if (localPlan.reason === "attribute_lookup_guard") {
            return {
                question: correctedRaw,
                changed: correctedRaw !== raw,
                reason: correctedRaw !== raw ? "typo_correction" : undefined
            };
        }
        if (localPlan.changed && localPlan.confidence >= 0.78) {
            return {
                question: localPlan.question,
                changed: true,
                reason: localPlan.reason || "local_semantic_planner"
            };
        }

        if (transformerRewrite && !EXPLICIT_ANALYTIC_WORDS.test(normalized)) {
            return {
                question: transformerRewrite.question,
                changed: true,
                reason: `${transformerRewrite.reason}:${transformerRewrite.score}`
            };
        }

        const vacancyRewrite = this.rewriteVacancyQuestion(correctedRaw, normalized);
        if (vacancyRewrite.changed) return vacancyRewrite;

        if (EXPLICIT_ANALYTIC_WORDS.test(normalized)) {
            return { question: correctedRaw, changed: correctedRaw !== raw, reason: correctedRaw !== raw ? "typo_correction" : undefined };
        }

        for (const rule of BUSINESS_REWRITE_RULES) {
            if (!rule.pattern.test(normalized)) continue;
            if (!hasGenericRetailSubject(normalized) && !/\b(who|which|what|show|find|tell|give)\b/i.test(normalized)) continue;
            const dimension = detectDimension(normalized, rule.defaultDimension);
            const metricPhrase = this.resolveMetricPhrase(rule.metricKind);
            const limit = /\b(all|every|each)\b/i.test(normalized) ? 50 : 5;
            const scope = cleanScopeSuffix(correctedRaw);
            const rewritten = `${rule.direction} ${limit} ${dimensionLabel(dimension)} by ${metricPhrase}${scope}`;
            return { question: rewritten, changed: true, reason: rule.name };
        }

        const directMetricRewrite = this.rewriteImplicitMetricQuestion(correctedRaw, normalized);
        if (directMetricRewrite.changed) return directMetricRewrite;

        return { question: correctedRaw, changed: correctedRaw !== raw, reason: correctedRaw !== raw ? "typo_correction" : undefined };
    }

    private rebuildCorrectionVocabulary(): void {
        const terms = new Map<string, CorrectionTerm>();
        const add = (value: string, source: CorrectionSource) => {
            const clean = normalizeAssistantText(value);
            if (!clean) return;
            const addTerm = (term: string) => {
                const normalized = normalizeAssistantText(term);
                if (!normalized || normalized.length < 3 || /^\d+$/.test(normalized)) return;
                const existing = terms.get(normalized);
                if (!existing || existing.source !== "command") terms.set(normalized, { term: normalized, source });
            };
            addTerm(clean);
            clean.split(/\s+/g).forEach(addTerm);
            const compact = clean.replace(/\s+/g, "");
            if (compact.length >= 5) addTerm(compact);
        };

        COMMAND_CORRECTION_WORDS.forEach((word) => add(word, "command"));
        (this.context.metrics || []).forEach((metric) => {
            add(metric.name, "metric");
            (metric.aliases || []).forEach((alias) => add(alias, "metric"));
        });
        (this.context.entities || []).forEach((entity) => {
            add(entity.label, "entity");
            (entity.aliases || []).forEach((alias) => add(alias, "entity"));
            Object.keys(entity.meta || {}).forEach((key) => add(entity.meta?.[key] || "", "entity"));
        });

        this.correctionVocabulary = Array.from(terms.values());
        this.correctionExact = new Set(this.correctionVocabulary.map((item) => item.term));
    }

    private correctQuestionText(question: string): string {
        const normalized = normalizeAssistantText(question);
        if (!normalized || !this.correctionVocabulary.length) return String(question || "").trim();
        return normalized
            .split(/\s+/g)
            .map((token) => this.correctToken(token))
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
    }

    private correctToken(token: string): string {
        const clean = normalizeAssistantText(token);
        if (!clean || clean.length < 4 || /^\d+$/.test(clean)) return clean;
        if (PROTECTED_CORRECTION_WORDS.has(clean) || this.correctionExact.has(clean)) return clean;
        const maxDistance = maxCorrectionDistance(clean);
        if (!maxDistance) return clean;

        let best: { term: string; distance: number; score: number } | null = null;
        let second: { term: string; distance: number; score: number } | null = null;
        for (const candidate of this.correctionVocabulary) {
            const term = candidate.term;
            if (term === clean || Math.abs(term.length - clean.length) > maxDistance) continue;
            const distance = editDistance(clean, term, maxDistance);
            if (distance <= 0 || distance > maxDistance) continue;
            const score = correctionScore(candidate.source, distance, clean.length);
            if (!best || score < best.score) {
                second = best;
                best = { term, distance, score };
            } else if (!second || score < second.score) {
                second = { term, distance, score };
            }
        }

        if (!best) return clean;
        if (best.distance / Math.max(clean.length, best.term.length) > 0.32) return clean;
        if (second && second.term !== best.term && Math.abs(second.score - best.score) < 0.035) return clean;
        return best.term;
    }

    private resolveMetricPhrase(kind: SemanticMetricKind): string {
        const direct = genericMetricPhrase(kind);
        if (direct && (this.context.metrics || []).some((metric) => metricMatchesKind(metric, kind))) return direct;
        const heatmapKey = (this.context.heatmapSelectedKeys || [])[0];
        const heatmapMetric = heatmapKey ? (this.context.metrics || []).find((metric) => metric.key === heatmapKey) : null;
        if (heatmapMetric) return heatmapMetric.name;
        const dynamic = (this.context.metrics || []).find((metric) => metric.kind === "dynamic");
        return dynamic?.name || direct || "units";
    }

    private rewriteVacancyQuestion(raw: string, normalized: string): AssistantSemanticRewrite {
        if (!/\b(vacant|vacancy|empty|available|free|unleased|not\s+leased)\b/i.test(normalized)) {
            return { question: raw, changed: false };
        }
        if (EXPLICIT_ANALYTIC_WORDS.test(normalized) || /\blist\b/i.test(normalized)) {
            return { question: raw, changed: false };
        }
        const dimension = detectDimension(normalized, "unit");
        const scope = cleanScopeSuffix(raw);
        const wantsCount = /\b(how\s+many|count|number\s+of|total)\b/i.test(normalized);
        const rewritten = wantsCount
            ? `list vacant ${dimensionLabel(dimension)}${scope}`
            : `list vacant ${dimensionLabel(dimension)}${scope}`;
        return { question: rewritten, changed: true, reason: "vacancy" };
    }

    private rewriteImplicitMetricQuestion(raw: string, normalized: string): AssistantSemanticRewrite {
        if (!hasGenericRetailSubject(normalized)) return { question: raw, changed: false };
        if (!/\b(which|what|who|show|find|tell|give)\b/i.test(normalized)) return { question: raw, changed: false };
        if (!EXPLICIT_METRIC_WORDS.test(normalized)) return { question: raw, changed: false };

        const dimension = detectDimension(normalized, "tenant");
        const direction = /\b(low|lowest|less|least|small|smallest|under|below)\b/i.test(normalized) ? "bottom" : "top";
        const metricKind: SemanticMetricKind = /\b(ocr|occupancy\s+cost|cost\s+ratio)\b/i.test(normalized)
            ? "ocr"
            : /\b(sales|revenue|turnover)\b/i.test(normalized)
            ? "sales"
            : /\b(rent|rental|lease)\b/i.test(normalized)
            ? "rent"
            : /\b(occupancy|occupied)\b/i.test(normalized)
            ? "occupancy"
            : /\b(area|sqm|m2|gla)\b/i.test(normalized)
            ? "area"
            : /\b(units?|stores?|shops?)\b/i.test(normalized)
            ? "units"
            : "sales";
        const metricPhrase = explicitMetricPhrase(normalized, this.resolveMetricPhrase(metricKind));
        const wantsBreakdown = /\b(?:show|display|get|give)\b/i.test(normalized)
            && /\b(?:and|by|with)\s+(?:assigned\s+)?(?:tenant\s+names?|tenants?|unit\s+ids?|units?|sales\s+categor(?:y|ies)|categor(?:y|ies)|groups?|zones?|regions?|floors?|levels?|layers?)\b/i.test(normalized)
            && !/\b(top|bottom|highest|lowest|largest|smallest|max|min|best|worst|rank|ranking|which|who)\b/i.test(normalized);
        if (wantsBreakdown) {
            const metricPhrases = explicitMetricPhrases(this.context, raw, normalized, metricPhrase);
            return {
                question: `show ${metricPhrases.join(" and ")} matrix by ${dimensionFieldLabel(dimension)}`,
                changed: true,
                reason: "implicit_metric_matrix"
            };
        }
        const scope = cleanScopeSuffix(raw);
        return {
            question: `${direction} 5 ${dimensionLabel(dimension)} by ${metricPhrase}${scope}`,
            changed: true,
            reason: "implicit_metric"
        };
    }
}
