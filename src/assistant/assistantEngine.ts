import { answerAttributeLookup, answerAverageComparison, answerBenchmarkRankFallback, answerBookmarkCount, answerBreakdown, answerCompare, answerCrossMetric, answerEntityCount, answerExplain, answerFilter, answerFilterFieldBreakdown, answerFormula, answerHelp, answerList, answerLookup, answerMatrix, answerMetricThreshold, answerRank, answerSummary, answerTrend, formatAssistantMetric, resolveMetricValue } from "./assistantAnswers";
import { AssistantAction, AssistantAnswerContext, AssistantAutocompleteItem, AssistantConfidence, AssistantEntity, AssistantFieldResolution, AssistantMatch, AssistantMetric, AssistantResponse, ParsedAssistantFilter, ParsedAssistantQuestion, ParsedTopBottomQuery, SelectedAssistantToken } from "./assistantTypes";
import { AssistantMatcher } from "./assistantMatcher";
import { MatrixQuery, normalizeMatrixQuery } from "./matrixQueryBuilder";
import { normalizeAssistantText, parseAssistantQuestion } from "./assistantParser";
import { AssistantSemanticLayer } from "./assistantSemanticLayer";
import { ExtractedQuestion, QuestionSlotExtractor } from "./assistantQuestionSlotExtractor";
import { defaultMatrixConfig, MatrixQueryPlanner } from "./assistantMatrixQueryPlanner";
import { ChartQueryPlanner, CountQueryPlanner, ListQueryPlanner } from "./assistantQueryPlanners";
import { AssistantMetricResolver, isDimensionMetric } from "./assistantMetricResolver";

type CanonicalAssistantQueryIntent = "list" | "count" | "matrix" | "rank" | "compare" | "chart" | "lookup";

interface CanonicalAssistantQuery {
    intent: CanonicalAssistantQueryIntent;
    measures: string[];
    fields: string[];
    filters: ParsedAssistantFilter[];
    output?: "table" | "matrix" | "bar" | "column" | "line" | "donut" | "area";
    confidence: number;
}

interface AssistantAutocompleteIndex {
    filterFieldKeys: string[];
    filterFieldKeySet: Set<string>;
    normalizedFilterFieldKeySet: Set<string>;
    valueItems: Array<{
        type: SelectedAssistantToken["type"];
        label: string;
        indices: number[];
        subtitle: string;
        detail?: string;
        fieldName?: string;
    }>;
}

interface AssistantPerformanceProfile {
    label: string;
    start: number;
    timings: Record<string, number>;
}

interface AssistantAutocompletePerformance {
    query: string;
    contextHint: string;
    limit: number;
    resultCount: number;
    totalMs: number;
    cacheHit: boolean;
}

interface LockedSelectedTokens {
    fields: string[];
    metrics: AssistantMetric[];
    entities: AssistantEntity[];
}

interface AssistantCardinalityStat {
    label: string;
    type: "Field" | "Measure";
    distinct: number;
    pct: number;
    index: number;
    role: string;
}

function addKnownMetricAliases(metric: AssistantMetric): AssistantMetric {
    const name = String(metric.name || "").toLowerCase();
    const aliases = new Set<string>((metric.aliases || []).concat(metric.name));
    if (/\bocr\b|occupancy cost/.test(name)) {
        ["ocr", "occupancy cost ratio", "cost ratio", "rent to sales", "rent sales ratio", "rent pressure", "rent stress", "lease pressure", "cost pressure", "risk", "tenant risk", "over rent", "over rented"].forEach((alias) => aliases.add(alias));
    }
    if (/rent/.test(name)) {
        ["rent", "rental", "lease", "base rent", "contracted rent", "passing rent", "expensive", "costly", "lease cost", "rent cost"].forEach((alias) => aliases.add(alias));
        if (/sqm|sq\s*m|m2|area|psm|per\s*(?:sqm|m2|area)/.test(name)) {
            ["rent per sqm", "rent per area", "rent/sqm", "rent psm", "rental per sqm", "lease per sqm"].forEach((alias) => aliases.add(alias));
        }
    }
    if (/sales|revenue|turnover/.test(name)) {
        ["sales", "sale", "revenue", "rev", "turnover", "performance", "tenant performance", "brand performance", "business performance", "doing well", "weak performance", "underperforming"].forEach((alias) => aliases.add(alias));
        if (/sqm|sq\s*m|m2|area|productivity|psm|per\s*(?:sqm|m2|area)/.test(name)) {
            ["sales productivity", "sales per area", "revenue productivity", "revenue per sqm", "sales per sqm", "sales/sqm", "revenue/sqm", "turnover/sqm", "sales density", "revenue density", "space productivity", "area productivity"].forEach((alias) => aliases.add(alias));
        }
    }
    if (/\bytd\b|year\s+to\s+date/.test(name)) {
        ["ytd", "year to date", "to date year"].forEach((alias) => aliases.add(alias));
    }
    if (/\byoy\b|year\s+over\s+year/.test(name)) {
        ["yoy", "year over year", "yearly growth"].forEach((alias) => aliases.add(alias));
    }
    if (/growth|increase|change/.test(name)) {
        ["growth", "increase", "change", "performance growth", "growth momentum", "growth opportunity", "improvement", "decline", "momentum"].forEach((alias) => aliases.add(alias));
    }
    if (/^(?:area|sum of area|total area|floor area|gla|sqm|sq m|m2)$/i.test(name)) {
        ["sqm", "m2", "per sqm", "area", "gla", "gross leasable area"].forEach((alias) => aliases.add(alias));
    }
    if (/\b(?:fl|fi|floor)\s*area\b/.test(name)) {
        ["fl area", "fi area", "floor area", "floor leasable area"].forEach((alias) => aliases.add(alias));
    }
    return { ...metric, aliases: Array.from(aliases) };
}

function builtinMetrics(): AssistantMetric[] {
    return [
        { key: "__builtin::units", name: "Units", kind: "builtin", aliases: ["unit count", "number of units", "stores"] },
        { key: "__builtin::area", name: "Area", kind: "builtin", aliases: ["sqm", "size", "total area", "actual area"] },
        { key: "__builtin::vacant", name: "Vacant units", kind: "builtin", aliases: ["vacancy", "empty", "available"] },
        { key: "__builtin::occupied", name: "Occupied units", kind: "builtin", aliases: ["occupied", "leased"] },
        { key: "__builtin::occupancy", name: "Occupancy", kind: "builtin", aliases: ["occupancy percent", "occupancy percentage", "occ"] }
    ];
}

function prepareContext(ctx: AssistantAnswerContext): AssistantAnswerContext {
    const seen = new Set<string>();
    const measureConfig = ctx.dataDictionary?.measures || [];
    const measureConfigByKey = new Map<string, NonNullable<AssistantAnswerContext["dataDictionary"]>["measures"][number]>();
    const normalizeConfigName = (value: string): string => String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
    measureConfig.forEach((item) => {
        if (item?.key) measureConfigByKey.set(item.key, item);
        if (item?.actualName) measureConfigByKey.set(`name:${normalizeConfigName(item.actualName)}`, item);
    });
    const hasMeasureAllowList = !!ctx.dataDictionary && Array.isArray(ctx.dataDictionary.measures);
    const metrics = builtinMetrics().concat(ctx.metrics || [])
        .filter((metric) => {
            const key = String(metric.key || "").trim();
            if (!key || seen.has(key)) return false;
            const configured = measureConfigByKey.get(key) || measureConfigByKey.get(`name:${normalizeConfigName(metric.name)}`);
            if (hasMeasureAllowList && (!configured || configured.enabled === false)) return false;
            seen.add(key);
            return true;
        })
        .map((metric) => {
            const configured = measureConfigByKey.get(metric.key) || measureConfigByKey.get(`name:${normalizeConfigName(metric.name)}`);
            if (!configured || configured.enabled === false) return metric;
            const displayName = String(configured.displayName || metric.name || "").trim();
            const aliases = Array.from(new Set([metric.name, displayName, configured.actualName]
                .concat(metric.aliases || [])
                .concat(configured.synonyms || [])
                .map((value) => String(value || "").trim())
                .filter(Boolean)));
            return {
                ...metric,
                name: displayName || metric.name,
                aliases,
                aggregationHint: configured.aggregation && configured.aggregation !== "visual" ? configured.aggregation : metric.aggregationHint,
                showInSuggestions: configured.showInSuggestions !== false
            };
        })
        .map(addKnownMetricAliases);
    const fieldConfig = ctx.dataDictionary?.fields || [];
    const hasFieldAllowList = !!ctx.dataDictionary && Array.isArray(ctx.dataDictionary.fields);
    const enabledFieldLabels = new Set<string>();
    fieldConfig
        .filter((field) => field.enabled !== false)
        .forEach((field) => {
            [field.actualName, field.displayName].concat(field.synonyms || []).forEach((label) => {
                const clean = normalizeConfigName(label || "");
                if (clean) enabledFieldLabels.add(clean);
            });
        });
    const fieldAllowed = (labels: string[]): boolean => {
        if (!hasFieldAllowList) return true;
        return labels.some((label) => enabledFieldLabels.has(normalizeConfigName(label || "")));
    };
    const entityAllowed = (entity: AssistantEntity): boolean => {
        if (!hasFieldAllowList) return true;
        if (entity.kind === "tenant") return fieldAllowed(["Assigned Tenant Name", "Assigned Tenant", "Tenant", "Tenant Name"]);
        if (entity.kind === "unit") return fieldAllowed(["Unit", "Unit ID", "Assigned Unit"]);
        if (entity.kind === "category") return fieldAllowed(["Assigned Sales Category", "Sales Category", "Category"]);
        if (entity.kind === "group") return fieldAllowed(["Assigned Group", "Group"]);
        if (entity.kind === "floor") return fieldAllowed(["Floor"]);
        if (entity.kind === "zone") return fieldAllowed(["Zone"]);
        if (entity.kind === "layer") return fieldAllowed(["Layer"]);
        if (entity.kind === "filter") {
            const field = String(entity.meta?.field || entity.meta?.subtitle || "").trim();
            return field ? fieldAllowed([field]) : true;
        }
        return true;
    };
    const entities = enrichEntityAliases((ctx.entities || []).filter(entityAllowed));
    const allowedMetricKeys = new Set(metrics.map((metric) => String(metric.key || "")).filter(Boolean));
    const bookmarkMeasureGroups = (ctx.bookmarkMeasureGroups || [])
        .map((group) => {
            const metricKeys = (group.metricKeys || []).map((key) => String(key || "").trim()).filter((key) => allowedMetricKeys.has(key));
            const metricGroups = (group.metricGroups || [])
                .map((metricGroup) => ({
                    name: String(metricGroup.name || "").trim(),
                    metricKeys: (metricGroup.metricKeys || []).map((key) => String(key || "").trim()).filter((key) => allowedMetricKeys.has(key))
                }))
                .filter((metricGroup) => metricGroup.name && metricGroup.metricKeys.length);
            return {
                ...group,
                metricKeys,
                metricGroups
            };
        })
        .filter((group) => group.metricKeys.length);
    return {
        ...ctx,
        metrics,
        entities,
        bookmarkMeasureGroups,
        matrixConfig: {
            ...defaultMatrixConfig(),
            ...(ctx.matrixConfig || {})
        }
    };
}

function acronym(value: string): string {
    return String(value || "")
        .split(/[^a-z0-9]+/i)
        .map((part) => part.trim()[0] || "")
        .join("")
        .toLowerCase();
}

function clampConfidence(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function isDimensionLikeMetric(metric: AssistantMetric): boolean {
    return isDimensionMetric(metric);
}

function enrichEntityAliases(entities: AssistantEntity[]): AssistantEntity[] {
    return (entities || []).map((entity) => {
        const aliases = new Set<string>((entity.aliases || []).concat(entity.label));
        const label = String(entity.label || "").trim();
        const lower = label.toLowerCase();
        const first = label.split(/\s+/g).filter(Boolean)[0] || "";
        const ac = acronym(label);
        if ((entity.kind === "tenant" || entity.kind === "unit") && first.length >= 4) {
            aliases.add(first);
            aliases.add(`${first}s`);
        }
        if (ac.length >= 2) aliases.add(ac);
        if (/victoria/.test(lower)) aliases.add("victoria");
        if (/marks\s*&\s*spencer|marks and spencer/.test(lower)) ["m&s", "mands", "marks"].forEach((alias) => aliases.add(alias));
        if (/harvey\s+nichols/.test(lower)) ["hn", "harvey"].forEach((alias) => aliases.add(alias));
        if (/lc\s*waikiki/.test(lower)) ["lcw", "waikiki"].forEach((alias) => aliases.add(alias));
        if (/go\s*crispy|crispy/.test(lower)) ["go crispy", "gocrispy", "go cripsy", "go cripsy", "go crisply", "go crisp", "crispy"].forEach((alias) => aliases.add(alias));
        if ((entity.kind === "category" || entity.kind === "group" || entity.kind === "filter") && /fashion|apparel|sportswear|clothes|clothing/.test(lower)) {
            ["fashion", "fashions", "fashion tenants", "clothing", "apparel"].forEach((alias) => aliases.add(alias));
        }
        if ((entity.kind === "category" || entity.kind === "group" || entity.kind === "filter") && /\b(men|mens|men's|male)\b/.test(lower)) {
            ["men", "mens", "men fashion", "mens fashion", "male fashion", "fashion men"].forEach((alias) => aliases.add(alias));
        }
        if ((entity.kind === "category" || entity.kind === "group" || entity.kind === "filter") && /\b(women|womens|women's|ladies|lady|female)\b/.test(lower)) {
            ["women", "womens", "ladies", "women fashion", "womens fashion", "ladies fashion", "female fashion", "fashion women"].forEach((alias) => aliases.add(alias));
        }
        if ((entity.kind === "category" || entity.kind === "group" || entity.kind === "filter") && /electronics|technology|tech|gadget|digital|mobile|phone|computer/.test(lower)) {
            ["electronics", "tech", "technology", "gadgets", "digital", "mobile", "phones"].forEach((alias) => aliases.add(alias));
        }
        if ((entity.kind === "category" || entity.kind === "group" || entity.kind === "filter") && /home|furniture|houseware|decor|department\s*store|department/.test(lower)) {
            ["home", "furniture", "houseware", "decor", "department store", "department stores"].forEach((alias) => aliases.add(alias));
        }
        if ((entity.kind === "category" || entity.kind === "group" || entity.kind === "filter") && /restaurant|food|f\s*&\s*b|f&b|cafe|coffee|dining|qsr/.test(lower)) {
            ["restaurant", "restaurants", "food", "food brands", "food court", "dining", "f&b", "fnb"].forEach((alias) => aliases.add(alias));
        }
        if (/\bkfc\b/i.test(label)) {
            aliases.add("kfc");
            aliases.add("kfcs");
        }
        return { ...entity, aliases: Array.from(aliases).filter(Boolean) };
    });
}

export class VisualAssistantEngine {
    private context: AssistantAnswerContext;
    private matcher: AssistantMatcher;
    private semanticLayer: AssistantSemanticLayer;
    private slotExtractor: QuestionSlotExtractor;
    private matrixPlanner: MatrixQueryPlanner;
    private chartPlanner: ChartQueryPlanner;
    private listPlanner: ListQueryPlanner;
    private countPlanner: CountQueryPlanner;
    private metricResolver: AssistantMetricResolver;
    private autocompleteCache = new Map<string, AssistantAutocompleteItem[]>();
    private valueAutocompleteCache = new Map<string, AssistantAutocompleteItem[]>();
    private autocompleteIndex: AssistantAutocompleteIndex;
    private performanceProfile: AssistantPerformanceProfile | null = null;
    private lastAutocompletePerformance: AssistantAutocompletePerformance | null = null;

    constructor(context: AssistantAnswerContext) {
        this.context = prepareContext(context);
        this.matcher = new AssistantMatcher(this.context.metrics, this.context.entities);
        this.semanticLayer = new AssistantSemanticLayer(this.context);
        this.slotExtractor = new QuestionSlotExtractor(this.context);
        this.matrixPlanner = new MatrixQueryPlanner(this.context);
        this.chartPlanner = new ChartQueryPlanner(this.context);
        this.listPlanner = new ListQueryPlanner();
        this.countPlanner = new CountQueryPlanner();
        this.metricResolver = this.createMetricResolver();
        this.autocompleteIndex = this.buildAutocompleteIndex();
        this.autocompleteCache.clear();
        this.valueAutocompleteCache.clear();
    }

    updateContext(context: AssistantAnswerContext): void {
        this.context = prepareContext(context);
        this.matcher = new AssistantMatcher(this.context.metrics, this.context.entities);
        this.semanticLayer.updateContext(this.context);
        this.slotExtractor = new QuestionSlotExtractor(this.context);
        this.matrixPlanner = new MatrixQueryPlanner(this.context);
        this.chartPlanner = new ChartQueryPlanner(this.context);
        this.listPlanner = new ListQueryPlanner();
        this.countPlanner = new CountQueryPlanner();
        this.metricResolver = this.createMetricResolver();
        this.autocompleteIndex = this.buildAutocompleteIndex();
        this.autocompleteCache.clear();
        this.valueAutocompleteCache.clear();
    }

    getMeasureAccessDiagnostics(): { mode: "all" | "bookmarkGroups"; groups: string[]; measureCount: number; message?: string } {
        const access = this.context.measureAccess;
        return {
            mode: access?.mode === "bookmarkGroups" ? "bookmarkGroups" : "all",
            groups: (access?.groups || []).map((group) => String(group || "").trim()).filter(Boolean),
            measureCount: Math.max(0, Number(access?.measureCount ?? this.context.metrics.length) || 0),
            message: access?.message
        };
    }

    private bookmarkMeasureAccessBlockedResponse(): AssistantResponse | null {
        const access = this.getMeasureAccessDiagnostics();
        if (access.mode !== "bookmarkGroups" || access.measureCount > 0) return null;
        return {
            handled: true,
            text: access.message || "No AI measures are available for your access group. Contact an admin."
        };
    }

    private createMetricResolver(): AssistantMetricResolver {
        return new AssistantMetricResolver(this.context, {
            fallbackMatches: (phrase, limit) => this.matcher.matchMetrics([phrase], limit).map((match) => match.item)
        });
    }

    metricLowerIsBetter(label: string): boolean | null {
        const normalized = normalizeAssistantText(label);
        if (!normalized) return null;
        const metric = (this.context.metrics || []).find((item) => {
            const names = [item.name].concat(item.aliases || []);
            return names.some((name) => normalizeAssistantText(name) === normalized);
        });
        if (!metric || typeof metric.higherIsBetter !== "boolean") return null;
        return metric.higherIsBetter === false;
    }

    private performanceNow(): number {
        return (typeof performance !== "undefined" && typeof performance.now === "function")
            ? performance.now()
            : Date.now();
    }

    private beginPerformanceProfile(label: string): boolean {
        if (this.performanceProfile) return false;
        this.performanceProfile = {
            label,
            start: this.performanceNow(),
            timings: {}
        };
        return true;
    }

    private addPerformanceTiming(name: string, ms: number): void {
        if (!this.performanceProfile) return;
        const cleanMs = Math.max(0, Math.round(ms * 10) / 10);
        this.performanceProfile.timings[name] = Math.round(((this.performanceProfile.timings[name] || 0) + cleanMs) * 10) / 10;
    }

    private profileStep<T>(name: string, fn: () => T): T {
        const start = this.performanceNow();
        try {
            return fn();
        } finally {
            this.addPerformanceTiming(name, this.performanceNow() - start);
        }
    }

    private async profileStepAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
        const start = this.performanceNow();
        try {
            return await fn();
        } finally {
            this.addPerformanceTiming(name, this.performanceNow() - start);
        }
    }

    private finishPerformanceProfile(response: AssistantResponse, owner: boolean): AssistantResponse {
        if (!this.performanceProfile) return response;
        if (owner) {
            const totalMs = this.performanceNow() - this.performanceProfile.start;
            this.addPerformanceTiming("answerTotal", totalMs);
        }
        response.performanceTimings = {
            ...(response.performanceTimings || {}),
            ...this.performanceProfile.timings
        };
        if (owner) this.performanceProfile = null;
        return response;
    }

    private clearPerformanceProfile(owner: boolean): void {
        if (owner) this.performanceProfile = null;
    }

    getLastAutocompletePerformance(): AssistantAutocompletePerformance | null {
        return this.lastAutocompletePerformance ? { ...this.lastAutocompletePerformance } : null;
    }

    private getDefaultRankMetric(): AssistantMetric | null {
        const keys = this.context.heatmapSelectedKeys || [];
        for (const key of keys) {
            const m = this.context.metrics.find((metric) => metric.key === key && metric.kind === "dynamic");
            if (m) return m;
        }
        return this.context.metrics.find((m) => m.kind === "dynamic") || null;
    }

    private getDefaultMatrixMetric(): AssistantMetric | null {
        const keys = this.context.heatmapSelectedKeys || [];
        for (const key of keys) {
            const metric = this.context.metrics.find((item) => item.key === key);
            if (metric) return metric;
        }
        return this.context.metrics.find((metric) => metric.kind === "dynamic" && metric.role === "heatmap")
            || this.getDefaultRankMetric();
    }

    getHeatmapSelectedMetricNames(): string[] {
        const keys = this.context.heatmapSelectedKeys || [];
        if (!keys.length) return [];
        return keys
            .map((key) => this.context.metrics.find((m) => m.key === key))
            .filter(Boolean)
            .map((m) => m!.name);
    }

    answerSavedMatrixQuery(query: MatrixQuery): AssistantResponse {
        const accessBlocked = this.bookmarkMeasureAccessBlockedResponse();
        if (accessBlocked) return accessBlocked;
        const cleanQuery = normalizeMatrixQuery(query);
        const valueText = cleanQuery.values.join(", ");
        const rowText = cleanQuery.rows.join(", ");
        const columnText = cleanQuery.columns.join(", ");
        const raw = `${valueText || "Values"} matrix by ${rowText || "rows"}${columnText ? ` and ${columnText} columns` : ""}`;
        const filterTexts = cleanQuery.filters.map((filter) => filter.phrase).filter(Boolean);
        const parsed: ParsedAssistantQuestion = {
            raw,
            normalized: this.normalizeOverrideText(raw),
            tokens: raw.split(/\s+/).filter(Boolean),
            intent: "matrix",
            plannerSource: "slot",
            hasExplicitSelections: true,
            metricPhrases: cleanQuery.values.slice(),
            entityPhrases: [],
            matrix: {
                intent: "matrix",
                rows: cleanQuery.rows.slice(),
                columns: cleanQuery.columns.slice(),
                values: cleanQuery.values.slice(),
                filters: filterTexts,
                query: cleanQuery,
                defaultValue: false,
                autoAxes: false,
                hideZeros: cleanQuery.hideZeros,
                valueMode: cleanQuery.valueMode,
                metricPhrase: cleanQuery.values[0] || "",
                metricPhrases: cleanQuery.values.length > 1 ? cleanQuery.values.slice() : undefined,
                rowPhrases: cleanQuery.rows.slice(),
                columnPhrases: cleanQuery.columns.slice()
            },
            requestedFields: {
                rows: cleanQuery.rows.slice(),
                columns: cleanQuery.columns.slice(),
                values: cleanQuery.values.slice(),
                metrics: cleanQuery.values.slice(),
                entities: [],
                filters: filterTexts
            }
        };
        const wanted = new Set(cleanQuery.values.map((value) => this.normalizeOverrideText(value)).filter(Boolean));
        const metrics = this.resolveMatrixValueMetrics(parsed, undefined, Math.max(1, cleanQuery.values.length || 1))
            .filter((metric) => [metric.name].concat(metric.aliases || [])
                .some((label) => wanted.has(this.normalizeOverrideText(label || ""))));
        return answerMatrix(this.context, parsed, metrics, []);
    }

    getMetricSuggestions(limit: number = 30): string[] {
        const preferred = ["Area", "Units", "Occupancy", "Vacant units", "Occupied units"];
        const heatmapNames = this.context.metrics
            .filter((metric) => metric.kind === "dynamic" && metric.role === "heatmap")
            .map((metric) => String(metric.name || "").trim())
            .filter(Boolean);
        const names = this.context.metrics.map((metric) => String(metric.name || "").trim()).filter(Boolean);
        const out: string[] = [];
        preferred.concat(heatmapNames, names).forEach((name) => {
            if (out.some((item) => item.toLowerCase() === name.toLowerCase())) return;
            out.push(name);
        });
        return out.slice(0, limit);
    }

    private isCardinalityQuestion(rawQuestion: string): boolean {
        const raw = String(rawQuestion || "").trim();
        const asksCardinality = /\b(cardinality|cardinlaity|cardinlaoty|cardinality\s+check|distinct\s+count|unique\s+count|unique\s+values?)\b/i.test(raw);
        const asksLayoutFit = /\b(table\s+or\s+matrix|matrix\s+or\s+table|work\s+as\s+(?:a\s+)?matrix|suitable\s+for\s+(?:a\s+)?matrix|good\s+for\s+(?:a\s+)?matrix)\b/i.test(raw);
        return asksCardinality || asksLayoutFit;
    }

    private answerCardinalityQuestion(rawQuestion: string, forcedFields?: string[], forcedMetrics?: AssistantMetric[]): AssistantResponse | null {
        const raw = String(rawQuestion || "").trim();
        const asksCardinality = this.isCardinalityQuestion(raw);
        const asksLayoutFit = /\b(table\s+or\s+matrix|matrix\s+or\s+table|work\s+as\s+(?:a\s+)?matrix|suitable\s+for\s+(?:a\s+)?matrix|good\s+for\s+(?:a\s+)?matrix)\b/i.test(raw);
        if (!asksCardinality && !asksLayoutFit) return null;
        const fields = (forcedFields && forcedFields.length ? forcedFields : this.extractCardinalityFields(raw))
            .map((field) => this.canonicalMatrixFieldLabel(field) || field)
            .filter(Boolean)
            .filter((field, index, arr) => arr.findIndex((candidate) => this.normalizeOverrideText(candidate) === this.normalizeOverrideText(field)) === index);
        const metrics = ((forcedMetrics && forcedMetrics.length ? forcedMetrics : this.resolveExactMetricsInText(raw)) || [])
            .filter((metric, index, arr) => arr.findIndex((item) => item.key === metric.key) === index);
        if (fields.length + metrics.length < 1) {
            return {
                handled: true,
                text: "Please mention at least one field, value, or measure to check cardinality. For layout checks, mention at least two fields.",
                suggestions: [
                    "check cardinality of Assigned Sales Category with Assigned Group",
                    "check cardinality of Assigned Group with Assigned Tenant Name",
                    "table or matrix for Assigned Sales Category, Assigned Group and Unit"
                ]
            };
        }
        const rowCount = Math.max(1, (this.context.rows || []).length);
        const fieldStats: AssistantCardinalityStat[] = fields.map((field, index) => {
            const distinct = this.matrixDimensionDistinctCount(field);
            const pct = (distinct / rowCount) * 100;
            return {
                label: field,
                type: "Field" as const,
                distinct,
                pct,
                index,
                role: this.cardinalityRole(distinct, pct)
            };
        });
        const measureStats: AssistantCardinalityStat[] = metrics.map((metric, metricIndex) => {
            const distinct = this.metricDistinctCount(metric);
            const pct = (distinct / rowCount) * 100;
            return {
                label: metric.name,
                type: "Measure" as const,
                distinct,
                pct,
                index: fields.length + metricIndex,
                role: this.cardinalityMeasureRole(pct)
            };
        });
        const stats: AssistantCardinalityStat[] = fieldStats.concat(measureStats);
        const recommendation = this.cardinalityRecommendation(stats, rowCount);
        const rows = stats.map((item) => [
            item.label,
            item.type,
            String(item.distinct),
            `${Math.round(item.pct)}%`,
            this.cardinalityDisplayRole(item, recommendation.layout)
        ]);
        rows.push([
            "Recommendation",
            "",
            recommendation.layout,
            "",
            recommendation.reason
        ]);
        return {
            handled: true,
            text: `Cardinality check for ${stats.length} item${stats.length === 1 ? "" : "s"} across ${rowCount.toLocaleString()} loaded rows. Recommended: ${recommendation.layout}. ${recommendation.reason}`,
            table: {
                columns: ["Item", "Type", "Distinct Count", "% of Rows", "Recommended Role"],
                rows
            },
            suggestions: recommendation.suggestions
        };
    }

    private extractCardinalityFields(rawQuestion: string): string[] {
        const question = ` ${this.normalizeFieldResolutionText(rawQuestion)} `;
        const candidates: Array<{ field: string; pos: number; length: number }> = [];
        this.knownMatrixFields().forEach((field) => {
            [field.name].concat(field.aliases || []).forEach((label) => {
                const clean = this.normalizeFieldResolutionText(label);
                if (!clean || clean.length < 3) return;
                const padded = ` ${clean} `;
                const pos = question.indexOf(padded);
                if (pos < 0) return;
                candidates.push({ field: field.name, pos, length: clean.length });
            });
        });
        const deduped: Array<{ field: string; pos: number; length: number }> = [];
        candidates
            .sort((a, b) => a.pos - b.pos || b.length - a.length)
            .forEach((candidate) => {
                const existing = deduped.find((item) => this.normalizeFieldResolutionText(item.field) === this.normalizeFieldResolutionText(candidate.field));
                if (existing) {
                    if (candidate.pos < existing.pos || (candidate.pos === existing.pos && candidate.length > existing.length)) {
                        existing.pos = candidate.pos;
                        existing.length = candidate.length;
                    }
                    return;
                }
                deduped.push({ ...candidate });
            });
        return deduped
            .sort((a, b) => a.pos - b.pos || b.length - a.length)
            .map((item) => item.field)
            .slice(0, 6);
    }

    private cardinalityRole(distinct: number, pct: number): string {
        if (pct <= 15) return "Matrix row parent";
        if (pct <= 60) return "Matrix row / table column";
        return "Matrix child / table detail";
    }

    private cardinalityMeasureRole(pct: number): string {
        if (pct <= 15) return "Low variation measure";
        if (pct <= 60) return "Moderate variation measure";
        return "High variation measure";
    }

    private cardinalityDisplayRole(item: AssistantCardinalityStat, layout: "Table" | "Matrix"): string {
        if (item.type === "Measure") return item.role;
        if (layout === "Table") {
            if (item.pct > 60) return "Table detail";
            if (item.pct > 15) return "Table column";
            return "Table grouping column";
        }
        return item.role;
    }

    private metricDistinctCount(metric: AssistantMetric): number {
        const values = new Set<string>();
        (this.context.rows || []).forEach((_, index) => {
            const value = this.context.getMetricValue(metric.key, [index]);
            if (!Number.isFinite(value)) return;
            values.add(Number(value).toPrecision(12));
        });
        return values.size;
    }

    private cardinalityRecommendation(
        stats: AssistantCardinalityStat[],
        rowCount: number
    ): { layout: "Table" | "Matrix"; reason: string; suggestions: string[] } {
        const fieldStats = stats.filter((item) => item.type === "Field");
        if (fieldStats.length < 2) {
            return {
                layout: "Table",
                reason: fieldStats.length ? "Only one field was selected, so a table is the clearest diagnostic view." : "Measures can be diagnosed for distinct values, but matrix layout needs fields.",
                suggestions: ["Check another field combination"]
            };
        }
        const sorted = fieldStats.slice().sort((a, b) => a.distinct - b.distinct || a.index - b.index);
        const high = fieldStats.filter((item) => item.pct > 60);
        const min = sorted[0];
        const max = sorted[sorted.length - 1];
        const ratio = min && max && min.distinct > 0 ? max.distinct / min.distinct : Number.POSITIVE_INFINITY;
        const close = min && max && min.distinct > 0 && ratio <= 1.5;
        if (high.length) {
            const detail = this.joinCardinalityLabels(high.map((item) => item.label));
            const detailVerb = high.length === 1 ? "is" : "are";
            const lower = fieldStats.filter((item) => item.pct <= 60).sort((a, b) => a.distinct - b.distinct);
            if (lower.length >= 1 && min && max && ratio >= 2) {
                return {
                    layout: "Matrix",
                    reason: `${min.label} has much lower cardinality than ${max.label}, so use ${min.label} > ${max.label} as a matrix hierarchy. ${detail} ${detailVerb} high-cardinality, but suitable as the child/detail level under the parent.`,
                    suggestions: ["Show as matrix", "Show as table"]
                };
            }
            const matrixHint = lower.length >= 2
                ? ` Use ${lower.map((item) => item.label).slice(0, 2).join(" > ")} as matrix rows, and keep ${detail} in table detail.`
                : "";
            return {
                layout: "Table",
                reason: `${detail} ${detailVerb} near row-level cardinality, so a matrix will be sparse.${matrixHint}`,
                suggestions: ["Show as table", "Check another field combination"]
            };
        }
        if (close) {
            return {
                layout: "Table",
                reason: `${min.label} and ${max.label} have similar cardinality, so a flat table is easier to read.`,
                suggestions: ["Show as table", "Check another field combination"]
            };
        }
        if (stats.length >= 2 && ratio >= 2) {
            return {
                layout: "Matrix",
                reason: `${min.label} has much lower cardinality than ${max.label}, so it can work as a matrix parent/hierarchy.`,
                suggestions: ["Show as matrix", "Show as table"]
            };
        }
        return {
            layout: rowCount > 0 ? "Table" : "Table",
            reason: "The selected fields do not have a clear low-cardinality parent, so a table is the safer layout.",
            suggestions: ["Show as table", "Check another field combination"]
        };
    }

    private joinCardinalityLabels(labels: string[]): string {
        const clean = (labels || []).map((label) => String(label || "").trim()).filter(Boolean);
        if (clean.length <= 1) return clean[0] || "";
        if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
        return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
    }

    private assistantKindForField(field: string): ParsedTopBottomQuery["dimensionType"] {
        const clean = this.normalizeOverrideText(field);
        if (clean === "assigned sales category" || clean === "sales category" || clean === "category" || clean === "categories") return "category";
        if (clean === "assigned group" || clean === "group" || clean === "groups") return "group";
        if (clean === "assigned tenant" || clean === "assigned tenant name" || clean === "tenant" || clean === "tenant name" || clean === "tenants") return "tenant";
        if (clean === "assigned unit" || clean === "unit" || clean === "unit id" || clean === "units") return "unit";
        if (clean === "zone" || clean === "zones") return "zone";
        if (clean === "floor" || clean === "floors" || clean === "level" || clean === "levels") return "floor";
        if (/\btenant|brand|shop|store\b/.test(clean)) return "tenant";
        if (/\bunit|space\b/.test(clean)) return "unit";
        if (/\bcategory|sales category|segment|class|type\b/.test(clean)) return "category";
        if (/\bgroup|department\b/.test(clean)) return "group";
        if (/\bzone|region\b/.test(clean)) return "zone";
        if (/\bfloor|level\b/.test(clean)) return "floor";
        if (/\blayer\b/.test(clean)) return "layer";
        return "filter";
    }

    private planMatrixSlots(extracted: ExtractedQuestion) {
        const metricLabels = new Set((extracted.measures || []).map((value) => this.normalizeOverrideText(value)));
        const isMetricField = (field: string): boolean => {
            const clean = this.normalizeOverrideText(field);
            return !!clean && (metricLabels.has(clean) || (!this.isKnownMatrixFieldLabel(field) && this.isKnownMetricLabel(field)));
        };
        return this.matrixPlanner.plan({
            ...extracted,
            fields: (extracted.fields || []).filter((field) => !isMetricField(field)),
            filters: (extracted.filters || []).filter((filter) => !this.isKnownMatrixFieldLabel(filter.value)),
            axes: {
                rows: (extracted.axes.rows || []).filter((field) => !isMetricField(field)),
                columns: (extracted.axes.columns || []).filter((field) => !isMetricField(field))
            }
        });
    }

    private defaultMetricPhraseForSlots(): string {
        return this.getDefaultRankMetric()?.name || this.getDefaultMatrixMetric()?.name || "";
    }

    private applyExtractedQuestionSlots(parsed: ParsedAssistantQuestion, extracted: ExtractedQuestion): void {
        if (!extracted || extracted.confidence < 0.82) return;
        parsed.plannerSource = "slot";
        const extractedFilters: ParsedAssistantFilter[] = (extracted.filters || [])
            .filter((filter) => !this.isKnownMatrixFieldLabel(filter.value))
            .map((filter) => {
                const kind = filter.kind || (filter.field ? this.assistantKindForField(filter.field) : undefined);
                return {
                    phrase: filter.value,
                    type: kind && kind !== "filter" && kind !== "context" ? kind : undefined,
                    matchedIndices: filter.indices
                };
            })
            .filter((filter) => !!filter.phrase);
        const applyAuthoritativeFilters = () => {
            parsed.filters = extractedFilters.length
                ? { includeFilters: extractedFilters }
                : undefined;
        };
        const extractedChartType = (extracted.chartType as string) === "pie" ? "donut" : extracted.chartType;
        if (extractedChartType === "bar"
            || extractedChartType === "column"
            || extractedChartType === "line"
            || extractedChartType === "donut"
            || extractedChartType === "area") {
            parsed.chartType = extractedChartType;
        }
        if (extracted.intent === "compare") {
            applyAuthoritativeFilters();
            const entityPhrases = Array.from(new Set((extracted.entities || [])
                .map((entity) => String(entity.label || "").trim())
                .filter(Boolean)));
            parsed.intent = "compare";
            parsed.matrix = undefined;
            parsed.topBottom = undefined;
            parsed.breakdown = undefined;
            if (extracted.measures.length) {
                parsed.metricPhrases = extracted.measures;
                parsed.explicitMetricPhrase = extracted.measures[0];
            }
            if (entityPhrases.length) {
                parsed.entityPhrases = entityPhrases;
                parsed.explicitEntityPhrases = entityPhrases;
                parsed.compareEntityPhrases = entityPhrases;
            }
            parsed.requestedFields = {
                rows: [],
                columns: [],
                values: extracted.measures,
                metrics: extracted.measures,
                entities: entityPhrases,
                filters: extractedFilters.map((filter) => filter.phrase)
            };
            parsed.detectedIntent = {
                intent: "compare",
                confidence: extracted.confidence,
                reasons: ["slot_extractor"].concat(extracted.reasons || [])
            };
            return;
        }
        if (extracted.intent === "percentile" && extracted.rank) {
            const dimensionField = extracted.rank.dimensionField || extracted.fields[0] || "Assigned Tenant Name";
            const kind = this.assistantKindForField(dimensionField);
            const metricPhrase = extracted.measures[0] || parsed.topBottom?.metricPhrase || parsed.explicitMetricPhrase || this.defaultMetricPhraseForSlots();
            applyAuthoritativeFilters();
            parsed.intent = "rank";
            parsed.matrix = undefined;
            parsed.breakdown = undefined;
            parsed.topBottom = {
                direction: extracted.rank.direction,
                limit: extracted.rank.limit || parsed.limit || 5,
                dimensionType: kind,
                dimensionField: kind === "filter" ? dimensionField : undefined,
                metricPhrase
            };
            parsed.explicitMetricPhrase = metricPhrase;
            parsed.metricPhrases = extracted.measures.length ? extracted.measures : [metricPhrase];
            parsed.requestedFields = {
                rows: [],
                columns: [],
                values: [metricPhrase],
                metrics: [metricPhrase],
                entities: extracted.fields,
                filters: extractedFilters.map((filter) => filter.phrase)
            };
            parsed.detectedIntent = {
                intent: "rank",
                confidence: extracted.confidence,
                reasons: ["slot_extractor", "percentile"].concat(extracted.reasons || [])
            };
            return;
        }
        if (extracted.intent === "rank" && extracted.rank) {
            const dimensionField = extracted.rank.dimensionField
                || extracted.fields.find((field) => this.assistantKindForField(field) !== "filter")
                || "Assigned Tenant Name";
            const kind = this.assistantKindForField(dimensionField);
            const metricPhrase = extracted.measures[0] || parsed.topBottom?.metricPhrase || parsed.explicitMetricPhrase || this.defaultMetricPhraseForSlots();
            applyAuthoritativeFilters();
            parsed.intent = "rank";
            parsed.matrix = undefined;
            parsed.breakdown = undefined;
            parsed.topBottom = {
                direction: extracted.rank.direction,
                limit: extracted.rank.limit || parsed.limit || 5,
                dimensionType: kind,
                dimensionField: kind === "filter" ? dimensionField : undefined,
                metricPhrase
            };
            parsed.explicitMetricPhrase = metricPhrase;
            parsed.requestedFields = {
                rows: [],
                columns: [],
                values: [metricPhrase],
                metrics: [metricPhrase],
                entities: [],
                filters: extractedFilters.map((filter) => filter.phrase)
            };
            parsed.detectedIntent = {
                intent: "rank",
                confidence: extracted.confidence,
                reasons: ["slot_extractor"].concat(extracted.reasons || [])
            };
            return;
        }
        if (extracted.intent === "chart") {
            const planned = this.chartPlanner.plan(extracted);
            if (!planned) return;
            applyAuthoritativeFilters();
            parsed.intent = "lookup";
            parsed.matrix = undefined;
            parsed.topBottom = undefined;
            parsed.breakdown = undefined;
            const plannedChartType = (planned.chartType as string) === "pie" ? "donut" : planned.chartType;
            if (plannedChartType === "bar" || plannedChartType === "column" || plannedChartType === "line" || plannedChartType === "donut" || plannedChartType === "area") {
                parsed.chartType = plannedChartType;
            }
            parsed.metricPhrases = planned.values;
            parsed.explicitMetricPhrase = planned.values[0];
            parsed.limit = planned.topN || parsed.limit;
            parsed.direction = planned.sort?.direction === "asc" ? "bottom" : planned.sort?.direction === "desc" ? "top" : parsed.direction;
            parsed.requestedFields = {
                rows: planned.category ? [planned.category] : [],
                columns: planned.series ? [planned.series] : [],
                values: planned.values,
                metrics: planned.values,
                entities: [],
                filters: planned.filters
            };
            parsed.detectedIntent = {
                intent: "lookup",
                confidence: extracted.confidence,
                reasons: ["slot_extractor", "chart_planner"].concat(extracted.reasons || [])
            };
            return;
        }
        if (extracted.measures.length
            && extractedFilters.length
            && !(extracted.fields || []).length
            && !this.hasExplicitMatrixLanguage(parsed.raw || parsed.normalized || "")
            && !(extracted.axes.rows || []).length
            && !(extracted.axes.columns || []).length) {
            applyAuthoritativeFilters();
            parsed.intent = "lookup";
            parsed.matrix = undefined;
            parsed.topBottom = undefined;
            parsed.breakdown = undefined;
            parsed.explicitMetricPhrase = extracted.measures[0];
            parsed.metricPhrases = extracted.measures;
            parsed.entityPhrases = extractedFilters.map((filter) => filter.phrase);
            parsed.explicitEntityPhrases = extractedFilters.map((filter) => filter.phrase);
            parsed.requestedFields = {
                rows: [],
                columns: [],
                values: extracted.measures,
                metrics: extracted.measures,
                entities: extractedFilters.map((filter) => filter.phrase),
                filters: extractedFilters.map((filter) => filter.phrase)
            };
            parsed.detectedIntent = {
                intent: "lookup",
                confidence: Math.max(0.9, extracted.confidence),
                reasons: ["slot_extractor", "entity_metric_lookup"].concat(extracted.reasons || [])
            };
            return;
        }
        if (extracted.intent === "matrix" && (extracted.measures.length || extracted.fields.length)) {
            const matrixExtracted = {
                ...extracted,
                fields: this.mergeMatrixFieldsFromQuestion(parsed.raw || parsed.normalized || "", extracted.fields || [])
            };
            const planned = this.planMatrixSlots(matrixExtracted);
            if (!planned) {
                this.promoteMeasureWithFieldsToBreakdown(
                    parsed,
                    extracted.measures.length ? extracted.measures : [this.defaultMetricPhraseForSlots()],
                    matrixExtracted.fields,
                    extractedFilters.map((filter) => filter.phrase),
                    ["slot_extractor", "cardinality_table_fallback"].concat(extracted.reasons || [])
                );
                applyAuthoritativeFilters();
                return;
            }
            const { rows, columns, values, filterTexts } = planned;
            applyAuthoritativeFilters();
            parsed.intent = "matrix";
            parsed.topBottom = undefined;
            parsed.breakdown = undefined;
            parsed.matrix = {
                intent: "matrix",
                rows,
                columns,
                values,
                filters: filterTexts,
                query: planned.query,
                defaultValue: !extracted.measures.length,
                autoAxes: false,
                hideZeros: planned.query.hideZeros,
                totalsMode: planned.totalsMode,
                metricPhrase: values[0],
                metricPhrases: values.length > 1 ? values : undefined,
                rowPhrases: rows,
                columnPhrases: columns
            };
            parsed.explicitMetricPhrase = values[0];
            parsed.requestedFields = {
                rows,
                columns,
                values,
                metrics: values,
                entities: [],
                filters: filterTexts
            };
            parsed.detectedIntent = {
                intent: "matrix",
                confidence: extracted.confidence,
                reasons: ["slot_extractor"].concat(extracted.reasons || [])
            };
            return;
        }
        if (extracted.intent === "count" && extracted.fields.length) {
            const planned = this.countPlanner.plan(extracted);
            if (!planned) return;
            applyAuthoritativeFilters();
            parsed.intent = "list";
            parsed.matrix = undefined;
            parsed.topBottom = undefined;
            parsed.breakdown = undefined;
            parsed.requestedFields = {
                rows: [],
                columns: [],
                values: [],
                metrics: [],
                entities: [planned.target],
                filters: planned.filters
            };
            parsed.detectedIntent = {
                intent: "list",
                confidence: extracted.confidence,
                reasons: ["slot_extractor", "count_planner"].concat(extracted.reasons || [])
            };
            return;
        }
        if (extracted.intent === "list") {
            const planned = this.listPlanner.plan(extracted);
            if (!planned) return;
            applyAuthoritativeFilters();
            parsed.intent = "list";
            parsed.matrix = undefined;
            parsed.topBottom = undefined;
            parsed.breakdown = undefined;
            parsed.requestedFields = {
                rows: extracted.axes.rows,
                columns: extracted.axes.columns,
                values: [],
                metrics: [],
                entities: [planned.target],
                filters: planned.filters
            };
            parsed.detectedIntent = {
                intent: "list",
                confidence: extracted.confidence,
                reasons: ["slot_extractor", "list_planner"].concat(extracted.reasons || [])
            };
            return;
        }
        if (extracted.intent === "lookup" && extracted.measures.length && extractedFilters.length) {
            applyAuthoritativeFilters();
            parsed.intent = "lookup";
            parsed.matrix = undefined;
            parsed.topBottom = undefined;
            parsed.breakdown = undefined;
            parsed.explicitMetricPhrase = extracted.measures[0];
            parsed.metricPhrases = extracted.measures;
            parsed.entityPhrases = extractedFilters.map((filter) => filter.phrase);
            parsed.requestedFields = {
                rows: [],
                columns: [],
                values: extracted.measures,
                metrics: extracted.measures,
                entities: extractedFilters.map((filter) => filter.phrase),
                filters: extractedFilters.map((filter) => filter.phrase)
            };
            parsed.detectedIntent = {
                intent: "lookup",
                confidence: extracted.confidence,
                reasons: ["slot_extractor"].concat(extracted.reasons || [])
            };
        }
    }

    private hasExplicitMatrixLanguage(question: string): boolean {
        return /\b(?:matrix|pivot|cross\s*tab|crosstab|rows?|columns?|cols?|as\s+rows?|as\s+columns?|by|across)\b/i.test(String(question || ""));
    }

    private explicitOutputTypeFromText(question: string): "" | "table" | "matrix" {
        const raw = String(question || "");
        if (/\b(?:show|display|change|switch|convert|view|as|in|to)\s+(?:it\s+)?(?:as\s+|to\s+|in\s+)?(?:a\s+)?(?:flat\s+)?table\b|\btable\s+view\b|\bas\s+(?:a\s+)?table\b/i.test(raw)) return "table";
        if (/\b(?:show|display|change|switch|convert|view|as|in|to)\s+(?:it\s+)?(?:as\s+|to\s+|in\s+)?(?:a\s+)?matrix\b|\bmatrix\s+view\b|\bas\s+(?:a\s+)?matrix\b|\bpivot\b/i.test(raw)) return "matrix";
        return "";
    }

    private hasRankLanguage(question: string): boolean {
        return /\b(?:top|bottom|highest|lowest|largest|smallest|best|worst|rank|ranking)\b/i.test(String(question || ""));
    }

    private forceMetricEntityLookup(parsed: ParsedAssistantQuestion, extracted?: ExtractedQuestion | null): void {
        const raw = String(parsed.raw || parsed.normalized || "");
        if (this.hasExplicitMatrixLanguage(raw)) return;
        const normalizedRaw = ` ${this.normalizeOverrideText(raw)} `;
        const hasRequestedField = this.knownMatrixFields().some((field) =>
            [field.name].concat(field.aliases || []).some((label) => {
                const clean = this.normalizeOverrideText(label || "");
                return clean.length >= 3 && normalizedRaw.indexOf(` ${clean} `) >= 0;
            })
        );
        if (hasRequestedField) return;
        if (parsed.matrix || parsed.topBottom || parsed.crossMetric || parsed.intent === "rank" || parsed.intent === "compare" || parsed.intent === "list") return;
        const questionMentionMetrics = this.resolveMetricsMentionedInQuestionText(raw, 8).map((metric) => metric.name);
        const measures = Array.from(new Set((extracted?.measures || [])
            .concat(parsed.explicitMetricPhrase ? [parsed.explicitMetricPhrase] : [])
            .concat(parsed.metricPhrases || [])
            .concat(questionMentionMetrics)
            .map((phrase) => String(phrase || "").trim())
            .filter(Boolean)
            .filter((phrase) => this.isKnownMetricLabel(phrase))));
        if (!measures.length) return;
        const trailingSubject = raw
            .replace(/\b(area|rent|sales|ocr|units?|sqm|m2)of\b/ig, "$1 of")
            .match(/\b(?:of|for)\s+(.+?)\s*$/i)?.[1]
            ?.replace(/[?!.;]+$/g, " ")
            .replace(/\s+/g, " ")
            .trim() || "";
        const entityLabels = Array.from(new Set((extracted?.entities || [])
            .filter((entity) => entity.kind !== "filterValue")
            .map((entity) => String(entity.label || "").trim())
            .concat((extracted?.filters || [])
                .filter((filter) => !!filter.value && !this.isKnownMatrixFieldLabel(filter.value))
                .map((filter) => String(filter.value || "").trim()))
            .concat(parsed.explicitEntityPhrases || [])
            .concat(parsed.entityPhrases || [])
            .concat((parsed.filters?.includeFilters || []).map((filter) => filter.phrase))
            .concat(trailingSubject ? [trailingSubject] : [])
            .filter(Boolean)
            .filter((label) => !this.isKnownMatrixFieldLabel(label))
            .filter((label) => !this.isKnownMetricLabel(label))));
        if (!entityLabels.length) return;
        parsed.intent = "lookup";
        parsed.matrix = undefined;
        parsed.topBottom = undefined;
        parsed.breakdown = undefined;
        parsed.explicitMetricPhrase = measures[0];
        parsed.metricPhrases = measures;
        parsed.entityPhrases = entityLabels;
        parsed.explicitEntityPhrases = entityLabels;
        parsed.requestedFields = {
            rows: [],
            columns: [],
            values: measures,
            metrics: measures,
            entities: entityLabels,
            filters: entityLabels
        };
        parsed.detectedIntent = {
            intent: "lookup",
            confidence: Math.max(0.92, parsed.detectedIntent?.confidence || extracted?.confidence || 0),
            reasons: ["slot_extractor", "metric_entity_lookup"].concat(parsed.detectedIntent?.reasons || extracted?.reasons || [])
        };
    }

    private forceRawFieldMetricMatrix(parsed: ParsedAssistantQuestion, extracted?: ExtractedQuestion | null): void {
        if (parsed.matrix || parsed.topBottom || parsed.crossMetric) return;
        if (parsed.intent === "rank" || parsed.intent === "compare" || parsed.intent === "list") return;
        const raw = String(parsed.raw || parsed.normalized || "");
        if (this.hasRankLanguage(raw)) return;
        const normalizedRaw = ` ${this.normalizeOverrideText(raw)} `;
        if (!normalizedRaw.trim()) return;
        const containsPhrase = (phrase: string): boolean => {
            const clean = this.normalizeOverrideText(phrase);
            if (!clean || clean.length < 3) return false;
            return normalizedRaw.indexOf(` ${clean} `) >= 0;
        };
        const metrics = this.resolveMetricsMentionedInQuestionText(raw, 30)
            .concat(this.resolveMetricsInPhraseOrder(extracted?.measures || [], 30))
            .filter((metric) => !isDimensionMetric(metric))
            .filter((metric, index, arr) => arr.findIndex((item) => item.key === metric.key) === index);
        if (!metrics.length) return;
        const metricLabels = new Set<string>();
        metrics.forEach((metric) => [metric.name].concat(metric.aliases || []).forEach((label) => {
            const clean = this.normalizeOverrideText(label || "");
            if (clean) metricLabels.add(clean);
        }));
        const fields = this.knownMatrixFields()
            .filter((field) => {
                const labels = [field.name].concat(field.aliases || []);
                return labels.some((label) => containsPhrase(label));
            })
            .map((field) => field.name)
            .filter((field) => !metricLabels.has(this.normalizeOverrideText(field)))
            .filter((field, index, arr) => arr.findIndex((candidate) => this.normalizeOverrideText(candidate) === this.normalizeOverrideText(field)) === index);
        if (!fields.length) return;
        const metricNames = metrics.map((metric) => metric.name).filter(Boolean);
        const planned = this.planMatrixSlots({
            intent: "matrix",
            confidence: Math.max(0.95, extracted?.confidence || parsed.detectedIntent?.confidence || 0),
            reasons: ["raw_field_metric_matrix"].concat(extracted?.reasons || []),
            measures: metricNames,
            fields,
            entities: [],
            axes: { rows: [], columns: [] },
            axesExplicit: { rows: false, columns: false },
            filters: [],
            chartType: undefined,
            rank: undefined
        });
        if (!planned) {
            this.promoteMeasureWithFieldsToBreakdown(parsed, metricNames, fields, [], ["raw_field_metric_matrix", "cardinality_table_fallback"].concat(extracted?.reasons || []));
            parsed.entityPhrases = [];
            parsed.explicitEntityPhrases = [];
            parsed.compareEntityPhrases = [];
            return;
        }
        const { rows, columns, values, filterTexts } = planned;
        parsed.intent = "matrix";
        parsed.matrix = {
            intent: "matrix",
            rows,
            columns,
            values,
            filters: filterTexts,
            query: planned.query,
            defaultValue: false,
            autoAxes: false,
            hideZeros: planned.query.hideZeros,
            totalsMode: planned.totalsMode,
            metricPhrase: values[0],
            metricPhrases: values.length > 1 ? values : undefined,
            rowPhrases: rows,
            columnPhrases: columns
        };
        parsed.topBottom = undefined;
        parsed.breakdown = undefined;
        parsed.explicitMetricPhrase = values[0];
        parsed.metricPhrases = values;
        parsed.entityPhrases = [];
        parsed.explicitEntityPhrases = [];
        parsed.compareEntityPhrases = [];
        parsed.filters = undefined;
        parsed.requestedFields = {
            rows,
            columns,
            values,
            metrics: values,
            entities: [],
            filters: filterTexts
        };
        parsed.detectedIntent = {
            intent: "matrix",
            confidence: Math.max(0.95, extracted?.confidence || parsed.detectedIntent?.confidence || 0),
            reasons: ["raw_field_metric_matrix"].concat(parsed.detectedIntent?.reasons || extracted?.reasons || [])
        };
    }

    private promoteMeasureWithFieldsToMatrix(parsed: ParsedAssistantQuestion, extracted?: ExtractedQuestion | null): void {
        if (parsed.matrix || parsed.topBottom || parsed.crossMetric) return;
        if (parsed.intent === "rank" || parsed.intent === "compare" || parsed.intent === "list") return;
        const raw = String(parsed.raw || parsed.normalized || "");
        if (this.hasRankLanguage(raw)) return;
        const metrics = this.resolveMetricsMentionedInQuestionText(raw, 8)
            .concat(this.resolveMetricsInPhraseOrder(this.getMatrixMetricPhrases(parsed), 8))
            .filter((metric, index, arr) => arr.findIndex((item) => item.key === metric.key) === index)
            .filter((metric) => !isDimensionMetric(metric));
        if (!metrics.length) return;
        const fields = this.mergeMatrixFieldsFromQuestion(raw, extracted?.fields || []);
        const cardinalityFallback = this.context.matrixConfig?.cardinalityFallbackEnabled !== false;
        if (fields.length < 2 && !this.hasExplicitMatrixLanguage(raw) && !cardinalityFallback) return;
        if (fields.length < 1) return;
        const measures = metrics.map((metric) => metric.name).filter(Boolean);
        const filters = (extracted?.filters || [])
            .filter((filter) => !!filter.value && !this.isKnownMatrixFieldLabel(filter.value))
            .map((filter) => String(filter.value || "").trim())
            .filter(Boolean);
        const planned = this.planMatrixSlots({
            intent: "matrix",
            measures,
            fields,
            entities: [],
            axes: { rows: [], columns: [] },
            filters: filters.map((value) => ({ value })),
            chartType: undefined,
            rank: undefined,
            confidence: Math.max(0.9, parsed.detectedIntent?.confidence || extracted?.confidence || 0),
            reasons: ["measure_field_matrix"].concat(extracted?.reasons || [])
        });
        if (!planned) {
            this.promoteMeasureWithFieldsToBreakdown(parsed, measures, fields, filters, ["cardinality_table_fallback"].concat(extracted?.reasons || []));
            return;
        }
        const { rows, columns, values, filterTexts } = planned;
        parsed.intent = "matrix";
        parsed.topBottom = undefined;
        parsed.breakdown = undefined;
        parsed.matrix = {
            intent: "matrix",
            rows,
            columns,
            values,
            filters: filterTexts,
            query: planned.query,
            defaultValue: false,
            autoAxes: false,
            hideZeros: planned.query.hideZeros,
            totalsMode: planned.totalsMode,
            metricPhrase: values[0],
            metricPhrases: values.length > 1 ? values : undefined,
            rowPhrases: rows,
            columnPhrases: columns
        };
        parsed.explicitMetricPhrase = values[0];
        parsed.metricPhrases = values;
        parsed.requestedFields = {
            rows,
            columns,
            values,
            metrics: values,
            entities: [],
            filters: filterTexts
        };
        parsed.detectedIntent = {
            intent: "matrix",
            confidence: Math.max(0.9, parsed.detectedIntent?.confidence || extracted?.confidence || 0),
            reasons: ["measure_field_matrix"].concat(parsed.detectedIntent?.reasons || extracted?.reasons || [])
        };
    }

    private promoteMeasureWithFieldsToBreakdown(parsed: ParsedAssistantQuestion, measures: string[], fields: string[], filters: string[], reasons: string[] = []): void {
        const dimensions = fields
            .map((field) => this.assistantKindForField(field))
            .filter((kind): kind is NonNullable<ParsedAssistantQuestion["breakdown"]>["dimensions"][number] =>
                kind === "tenant" || kind === "unit" || kind === "category" || kind === "group" || kind === "zone" || kind === "floor" || kind === "layer"
            )
            .filter((kind, index, arr) => arr.indexOf(kind) === index)
            .slice(0, 4);
        if (!dimensions.length || !measures.length) return;
        parsed.intent = "lookup";
        parsed.matrix = undefined;
        parsed.topBottom = undefined;
        parsed.breakdown = { dimensions };
        parsed.explicitMetricPhrase = measures[0];
        parsed.metricPhrases = measures;
        parsed.requestedFields = {
            rows: fields,
            columns: [],
            values: measures,
            metrics: measures,
            entities: [],
            filters
        };
        parsed.detectedIntent = {
            intent: "lookup",
            confidence: Math.max(0.9, parsed.detectedIntent?.confidence || 0),
            reasons: ["cardinality_table_fallback"].concat(reasons)
        };
    }

    private extractMatrixFieldsFromQuestion(question: string): string[] {
        const normalized = ` ${this.normalizeOverrideText(question)} `;
        if (!normalized.trim()) return [];
        const fields: string[] = [];
        this.knownMatrixFields().forEach((field) => {
            const labels = [field.name].concat(field.aliases || [])
                .map((label) => this.normalizeOverrideText(label))
                .filter((label) => label.length >= 3)
                .sort((a, b) => b.length - a.length);
            if (labels.some((label) => normalized.indexOf(` ${label} `) >= 0)) fields.push(field.name);
        });
        return fields.filter((field, index, arr) =>
            arr.findIndex((candidate) => this.normalizeOverrideText(candidate) === this.normalizeOverrideText(field)) === index
        );
    }

    private mergeMatrixFieldsFromQuestion(question: string, fields: string[]): string[] {
        return this.explicitMatrixFieldMentions(question)
            .concat(this.extractMatrixFieldsFromQuestion(question))
            .concat(fields || [])
            .map((field) => String(field || "").trim())
            .filter(Boolean)
            .filter((field) => !this.isKnownMetricLabel(field))
            .filter((field, index, arr) =>
                arr.findIndex((candidate) => this.normalizeOverrideText(candidate) === this.normalizeOverrideText(field)) === index
            );
    }

    private replanMatrixWithCardinality(parsed: ParsedAssistantQuestion, extracted?: ExtractedQuestion | null): void {
        if (!parsed.matrix) return;
        const raw = String(parsed.raw || parsed.normalized || "");
        if (/\bas\s+(?:rows?|columns?|cols?)\b|\b(?:rows?|columns?|cols?)\s*:/i.test(raw)) return;
        const fields = this.mergeMatrixFieldsFromQuestion(
            raw,
            (extracted?.fields || [])
                .concat(parsed.matrix.rows || [])
                .concat(parsed.matrix.columns || [])
        );
        if (fields.length < 2) return;
        const values = (extracted?.measures || [])
            .concat(parsed.matrix.values || [])
            .concat(parsed.matrix.metricPhrases || [])
            .concat(parsed.matrix.metricPhrase ? [parsed.matrix.metricPhrase] : [])
            .map((value) => String(value || "").trim())
            .filter(Boolean)
            .filter((value, index, arr) =>
                arr.findIndex((candidate) => this.normalizeOverrideText(candidate) === this.normalizeOverrideText(value)) === index
            );
        const planned = this.planMatrixSlots({
            intent: "matrix",
            measures: values,
            fields,
            entities: extracted?.entities || [],
            axes: { rows: [], columns: [] },
            axesExplicit: { rows: false, columns: false },
            filters: extracted?.filters || [],
            chartType: extracted?.chartType,
            rank: undefined,
            confidence: Math.max(0.9, extracted?.confidence || parsed.detectedIntent?.confidence || 0),
            reasons: ["cardinality_matrix_replan"].concat(extracted?.reasons || [])
        });
        if (!planned) return;
        const cleanField = (value: string) => this.normalizeOverrideText(value);
        const plannedRows = planned.rows.slice();
        fields.forEach((field) => {
            if (planned.columns.some((column) => cleanField(column) === cleanField(field))) return;
            if (plannedRows.some((row) => cleanField(row) === cleanField(field))) return;
            plannedRows.push(field);
        });
        const plannedColumns = planned.columns.filter((column) =>
            !plannedRows.some((row) => cleanField(row) === cleanField(column))
        );
        const finalQuery = normalizeMatrixQuery({
            ...planned.query,
            rows: plannedRows,
            columns: plannedColumns,
            values: planned.values,
            filters: planned.filterTexts
        });
        parsed.matrix.rows = finalQuery.rows;
        parsed.matrix.rowPhrases = finalQuery.rows;
        parsed.matrix.columns = finalQuery.columns;
        parsed.matrix.columnPhrases = finalQuery.columns;
        parsed.matrix.values = planned.values;
        parsed.matrix.metricPhrase = planned.values[0] || parsed.matrix.metricPhrase;
        parsed.matrix.metricPhrases = planned.values.length > 1 ? planned.values : undefined;
        parsed.matrix.filters = planned.filterTexts;
        parsed.matrix.query = finalQuery;
        parsed.matrix.totalsMode = planned.totalsMode;
        parsed.matrix.autoAxes = false;
        parsed.requestedFields = {
            rows: finalQuery.rows,
            columns: finalQuery.columns,
            values: planned.values,
            metrics: planned.values,
            entities: parsed.requestedFields?.entities || [],
            filters: planned.filterTexts
        };
        parsed.detectedIntent = {
            intent: "matrix",
            confidence: Math.max(0.9, parsed.detectedIntent?.confidence || extracted?.confidence || 0),
            reasons: ["cardinality_matrix_replan"].concat(parsed.detectedIntent?.reasons || extracted?.reasons || [])
        };
    }

    private correctRankDimensionAndMetric(parsed: ParsedAssistantQuestion, extracted?: ExtractedQuestion | null): void {
        if (!parsed.topBottom || parsed.intent === "matrix") return;
        const raw = String(parsed.raw || parsed.normalized || "");
        const normalized = this.normalizeOverrideText(raw);
        if (!/\b(?:top|bottom|highest|lowest|largest|smallest|best|worst|rank)\b/i.test(raw)) return;
        const fieldMentions = this.extractMatrixFieldsFromQuestion(raw);
        const connectorIndex = ` ${normalized} `.search(/\s(?:by|with|using|for|in|under|within|inside)\s/);
        const hasSpecificZoneFilter = /\bzone\s*\d+\b/i.test(raw) || (extracted?.filters || []).some((filter) => filter.kind === "zone");
        const wordRankedField =
            /\b(?:sales\s+)?categor(?:y|ies)\b/i.test(raw) ? "Assigned Sales Category" :
            /\b(?:tenant|tenants|tenant\s+name|brand|brands|shop|shops|store|stores)\b/i.test(raw) ? "Assigned Tenant Name" :
            /\b(?:group|groups|department|departments)\b/i.test(raw) ? "Assigned Group" :
            /\b(?:unit|units|unit\s+id|space|spaces)\b/i.test(raw) ? "Unit" :
            undefined;
        const rankedField = fieldMentions.find((field) => {
            const idx = ` ${normalized} `.indexOf(` ${this.normalizeOverrideText(field)} `);
            if (hasSpecificZoneFilter && this.assistantKindForField(field) === "zone") return false;
            return idx >= 0 && (connectorIndex < 0 || idx <= connectorIndex);
        }) || wordRankedField
            || (hasSpecificZoneFilter && extracted?.rank?.dimensionField && this.assistantKindForField(extracted.rank.dimensionField) === "zone"
            ? undefined
            : extracted?.rank?.dimensionField);
        if (rankedField) {
            const kind = this.assistantKindForField(rankedField);
            parsed.topBottom.dimensionType = kind;
            parsed.topBottom.dimensionField = kind === "filter" ? rankedField : undefined;
            parsed.requestedFields = {
                ...(parsed.requestedFields || { rows: [], columns: [], values: [], metrics: [], entities: [], filters: [] }),
                entities: [rankedField]
            };
        }
        const exactMetrics = this.resolveMetricsMentionedInQuestionText(raw, 8);
        const metric = exactMetrics[0];
        if (metric) {
            parsed.topBottom.metricPhrase = metric.name;
            parsed.explicitMetricPhrase = metric.name;
            parsed.metricPhrases = [metric.name];
            parsed.requestedFields = {
                ...(parsed.requestedFields || { rows: [], columns: [], values: [], metrics: [], entities: [], filters: [] }),
                values: [metric.name],
                metrics: [metric.name]
            };
        }
    }

    private isKnownMatrixFieldLabel(value: string): boolean {
        const clean = this.normalizeOverrideText(value);
        if (!clean) return false;
        return this.knownMatrixFields().some((field) =>
            [field.name].concat(field.aliases || []).some((label) => this.normalizeOverrideText(label || "") === clean)
        );
    }

    private canonicalMatrixFieldLabel(value: string): string | null {
        const clean = this.normalizeOverrideText(value);
        if (!clean) return null;
        const match = this.knownMatrixFields().find((field) =>
            [field.name].concat(field.aliases || []).some((label) => this.normalizeOverrideText(label || "") === clean)
        );
        return match?.name || null;
    }

    private shouldUseRawExtractedQuestion(extracted: ExtractedQuestion | null | undefined): boolean {
        return !!extracted
            && extracted.confidence >= 0.82
            && extracted.intent !== "unknown"
            && (extracted.measures.length > 0 || extracted.fields.length > 0 || extracted.filters.length > 0);
    }

    private shouldUseSemanticFallback(extracted: ExtractedQuestion | null | undefined): boolean {
        if (!extracted) return true;
        if (this.shouldUseRawExtractedQuestion(extracted)) return false;
        return extracted.confidence < 0.62;
    }

    private forceExplicitListIntent(parsed: ParsedAssistantQuestion, extracted?: ExtractedQuestion | null): void {
        const raw = String(parsed.raw || parsed.normalized || "").trim();
        if (!/^\s*(?:list|show\s+list\s+of|show\s+all|display\s+all)\b/i.test(raw)) return;
        if (/\b(?:matrix|pivot|cross\s*tab|crosstab|rows?|columns?|cols?)\b/i.test(raw)) return;

        const requestedFields = (extracted?.fields || [])
            .concat(parsed.requestedFields?.rows || [])
            .concat(parsed.requestedFields?.columns || [])
            .concat(parsed.requestedFields?.entities || [])
            .filter(Boolean);
        const target = requestedFields.find((field) => /\btenant|brand|shop|store\b/i.test(field))
            || requestedFields.find((field) => /\bunit\b/i.test(field))
            || requestedFields[0]
            || "Assigned Tenant Name";
        const filters = (parsed.filters?.includeFilters || [])
            .map((filter) => filter.phrase)
            .filter(Boolean);

        parsed.intent = "list";
        parsed.matrix = undefined;
        parsed.topBottom = undefined;
        parsed.breakdown = undefined;
        parsed.crossMetric = undefined;
        parsed.explicitMetricPhrase = undefined;
        parsed.metricPhrases = [];
        parsed.requestedFields = {
            rows: [],
            columns: [],
            values: [],
            metrics: [],
            entities: [target],
            filters
        };
        parsed.detectedIntent = {
            intent: "list",
            confidence: Math.max(0.95, parsed.detectedIntent?.confidence || 0),
            reasons: ["explicit_list_command"].concat(parsed.detectedIntent?.reasons || [])
        };
        parsed.plannerSource = "slot";
    }

    private answerFieldOnlyScopedList(parsed: ParsedAssistantQuestion, extracted?: ExtractedQuestion | null): AssistantResponse | null {
        const raw = String(parsed.raw || parsed.normalized || "").trim();
        if (!/\b(?:show|display|list|what|which)\b/i.test(raw)) return null;
        if (/\b(?:select|highlight|zoom|focus)\b/i.test(raw)) return null;
        if (/\b(?:matrix|pivot|cross\s*tab|crosstab|chart|graph|top|bottom|rank|compare|how\s+many|count)\b/i.test(raw)) return null;
        const fields = (extracted?.fields || [])
            .concat(parsed.requestedFields?.entities || [])
            .concat(parsed.requestedFields?.rows || [])
            .concat(parsed.requestedFields?.columns || [])
            .map((field) => String(field || "").trim())
            .filter(Boolean);
        const target = fields.find((field) => this.assistantKindForField(field) === "tenant")
            || fields.find((field) => this.assistantKindForField(field) === "unit");
        if (!target) return null;
        const filters = (extracted?.filters || [])
            .map((filter) => ({
                phrase: String(filter.value || "").trim(),
                type: filter.kind || (filter.field ? this.assistantKindForField(filter.field) : undefined),
                matchedIndices: filter.indices || []
            } as ParsedAssistantFilter))
            .filter((filter) => filter.phrase && (filter.matchedIndices || []).length);
        if (!filters.length) return null;
        const scoped = this.getCountScopeEntities({
            ...parsed,
            intent: "list",
            matrix: undefined,
            metricPhrases: [],
            explicitMetricPhrase: undefined,
            filters: { ...(parsed.filters || {}), includeFilters: filters },
            requestedFields: {
                rows: [],
                columns: [],
                values: [],
                metrics: [],
                entities: [target],
                filters: filters.map((filter) => filter.phrase)
            }
        });
        if (!scoped.length) return null;
        return answerList(this.context, {
            ...parsed,
            intent: "list",
            matrix: undefined,
            topBottom: undefined,
            breakdown: undefined,
            metricPhrases: [],
            explicitMetricPhrase: undefined,
            filters: { ...(parsed.filters || {}), includeFilters: filters },
            requestedFields: {
                rows: [],
                columns: [],
                values: [],
                metrics: [],
                entities: [target],
                filters: filters.map((filter) => filter.phrase)
            }
        }, scoped);
    }

    private buildFieldValueListAnswer(fields: string[], indices: number[], reason: string): AssistantResponse | null {
        const cleanFields = (fields || [])
            .map((field) => this.canonicalMatrixFieldLabel(field) || String(field || "").trim())
            .filter((field) => !!field && this.isAssistantFieldAllowed(field))
            .filter((field, index, arr) => arr.findIndex((candidate) => this.normalizeOverrideText(candidate) === this.normalizeOverrideText(field)) === index);
        if (!cleanFields.length) return null;
        const scopedIndices = (indices || []).length ? indices : (this.context.rows || []).map((row) => row.idx);
        const allRows = this.distinctRowsForFields(cleanFields, scopedIndices);
        const rows = allRows.slice(0, 500);
        const label = cleanFields.length === 1 ? cleanFields[0] : cleanFields.join(" / ");
        const valueWord = cleanFields.length === 1 ? "values" : "combinations";
        return {
            handled: true,
            text: `${label} ${valueWord}. Showing ${rows.length} of ${allRows.length}.`,
            table: {
                columns: cleanFields,
                rows,
                editableQuery: {
                    fields: cleanFields,
                    measures: [],
                    filters: [],
                    fieldOptions: this.knownMatrixFields().map((field) => field.name),
                    measureOptions: (this.context.metrics || []).map((metric) => metric.name)
                }
            },
            confidence: {
                intentConfidence: 1,
                metricConfidence: 1,
                entityConfidence: 1,
                overallConfidence: 1,
                intent: "list",
                reasons: [reason, "field_values_only", "no_default_metric"]
            }
        };
    }

    private answerFieldValueListQuestion(parsed: ParsedAssistantQuestion, extracted?: ExtractedQuestion | null): AssistantResponse | null {
        const raw = String(parsed.raw || parsed.normalized || "").trim();
        if (!raw) return null;
        if (/\b(?:select|highlight|zoom|focus|matrix|pivot|cross\s*tab|crosstab|chart|graph|top|bottom|rank|compare|cardinality|how\s+many|count)\b/i.test(raw)) return null;
        const metricLikeLabels = ([] as string[])
            .concat(extracted?.measures || [])
            .concat(parsed.metricPhrases || [])
            .concat(parsed.explicitMetricPhrase ? [parsed.explicitMetricPhrase] : [])
            .concat(parsed.matrix?.values || [])
            .concat(parsed.requestedFields?.metrics || [])
            .concat(parsed.requestedFields?.values || []);
        const fields = (extracted?.fields || [])
            .concat(parsed.requestedFields?.entities || [])
            .concat(parsed.requestedFields?.rows || [])
            .concat(parsed.requestedFields?.columns || [])
            .concat(metricLikeLabels.filter((label) => this.isKnownMatrixFieldLabel(label)))
            .map((field) => this.canonicalMatrixFieldLabel(field) || String(field || "").trim())
            .filter((field) => !!field && this.isAssistantFieldAllowed(field))
            .filter((field, index, arr) => arr.findIndex((candidate) => this.normalizeOverrideText(candidate) === this.normalizeOverrideText(field)) === index);
        if (!fields.length) return null;
        const rawClean = this.normalizeOverrideText(raw);
        const isPlainFieldQuestion = fields.some((field) => {
            const known = this.knownMatrixFields().find((item) => this.normalizeOverrideText(item.name) === this.normalizeOverrideText(field));
            return [field].concat(known?.aliases || []).some((label) => this.normalizeOverrideText(label) === rawClean);
        });
        const realMetricLabels = metricLikeLabels
            .map((label) => String(label || "").trim())
            .filter((label) => !!label && !this.isKnownMatrixFieldLabel(label));
        const hasMetric = isPlainFieldQuestion
            ? realMetricLabels.some((label) => {
                const clean = this.normalizeOverrideText(label);
                return !!clean && rawClean.indexOf(clean) >= 0;
            })
            : realMetricLabels.length > 0;
        if (hasMetric) return null;
        const hasListVerb = /\b(?:show|display|list|what|which|available|values?)\b/i.test(raw);
        if (!isPlainFieldQuestion && !hasListVerb && !extracted?.filters?.length) return null;
        const scopedIndices = this.indicesForExtractedFilters(extracted);
        const indices = scopedIndices.length ? scopedIndices : (this.context.rows || []).map((row) => row.idx);
        return this.buildFieldValueListAnswer(fields, indices, "field_only_value_list");
    }

    private indicesForExtractedFilters(extracted?: ExtractedQuestion | null): number[] {
        const filterGroups = (extracted?.filters || [])
            .map((filter) => Array.from(new Set((filter.indices || []).map(Number).filter((idx) => Number.isFinite(idx) && idx >= 0))))
            .filter((indices) => indices.length);
        if (!filterGroups.length) return [];
        return filterGroups.slice(1).reduce((out, indices) => {
            const set = new Set(indices);
            return out.filter((idx) => set.has(idx));
        }, filterGroups[0]);
    }

    private distinctRowsForFields(fields: string[], indices: number[]): string[][] {
        const seen = new Set<string>();
        const rows: string[][] = [];
        const invalid = /^(?:n\/a|na|none|null|undefined|-|\(blank\)|blank)$/i;
        (indices || []).forEach((idx) => {
            const values = fields.map((field) => this.strictRowFieldValue(idx, field).trim());
            if (values.some((value) => !value || invalid.test(value))) return;
            const key = values.map((value) => this.normalizeOverrideText(value)).join("\u0001");
            if (!key || seen.has(key)) return;
            seen.add(key);
            rows.push(values);
        });
        return rows.sort((a, b) => a.join(" ").localeCompare(b.join(" "), undefined, { sensitivity: "base", numeric: true }));
    }

    private answerRawScopedTenantOrUnitList(parsed: ParsedAssistantQuestion): AssistantResponse | null {
        const raw = String(parsed.raw || parsed.normalized || "").trim();
        if (!/\b(?:show|display|list|which|what)\b/i.test(raw)) return null;
        const targetKind = /\b(?:units?|unit\s+names?|unit\s+ids?|spaces?)\b/i.test(raw)
            ? "unit"
            : /\b(?:assigned\s+tenant\s+name|assigned\s+tenant|tenant\s+names?|tenants?|brands?|shops?|stores?)\b/i.test(raw)
            ? "tenant"
            : null;
        if (!targetKind) return null;
        const metrics = this.resolveMetricsMentionedInQuestionText(raw, 6);
        const match = raw.match(/\b(?:in|inside|within|under|for)\s+(.+?)\s*$/i);
        const rawScope = String(match?.[1] || "")
            .replace(/\b(?:with|by|using)\s+.+$/i, " ")
            .replace(/\b(?:group|category|zone|floor|layer)\b/ig, " ")
            .replace(/[?!.;]+$/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        if (!rawScope) return null;
        const scope = this.rowBackedScopeEntity("group", rawScope)
            || this.rowBackedScopeEntity("category", rawScope)
            || this.getExactEntities(rawScope, [rawScope]).find((entity) =>
                entity.kind === "group"
                || entity.kind === "category"
                || entity.kind === "zone"
                || entity.kind === "floor"
                || entity.kind === "layer"
                || entity.kind === "filter"
            );
        if (!scope) return null;
        if (metrics.length) {
            const rows = this.tenantOrUnitRowsForIndices(scope.indices || [], targetKind, metrics);
            const limit = Math.min(100, rows.length);
            return {
                handled: true,
                text: `Found ${this.context.formatNumber(rows.length, { maximumFractionDigits: 0 })} ${targetKind === "tenant" ? "tenants" : "units"} in ${scope.label}. Showing ${limit}.`,
                actions: [this.selectScopedCountAction(scope, scope.indices || [])],
                table: {
                    columns: [targetKind === "tenant" ? "Tenant" : "Unit"].concat(metrics.map((metric) => metric.name)),
                    rows: rows.slice(0, limit).map((row) => row.slice(0, 1 + metrics.length))
                },
                autoSelectIndices: scope.indices || []
            };
        }
        const target = targetKind === "tenant" ? "Assigned Tenant Name" : "Unit";
        return answerList(this.context, {
            ...parsed,
            intent: "list",
            matrix: undefined,
            topBottom: undefined,
            breakdown: undefined,
            explicitMetricPhrase: undefined,
            metricPhrases: [],
            requestedFields: {
                rows: [],
                columns: [],
                values: [],
                metrics: [],
                entities: [target],
                filters: [scope.label]
            },
            filters: {
                ...(parsed.filters || {}),
                includeFilters: [{
                    phrase: scope.label,
                    type: scope.kind === "filter" || scope.kind === "context" || scope.kind === "bookmark" ? undefined : scope.kind,
                    matchedIndices: scope.indices || []
                }]
            }
        }, [scope]);
    }

    private createParsedFromExtractedQuestion(question: string, extracted: ExtractedQuestion): ParsedAssistantQuestion {
        const normalized = normalizeAssistantText(question || "");
        const extractedChartType = (extracted.chartType as string) === "pie" ? "donut" : extracted.chartType;
        const chartType = extractedChartType === "bar"
            || extractedChartType === "column"
            || extractedChartType === "line"
            || extractedChartType === "donut"
            || extractedChartType === "area"
            ? extractedChartType
            : undefined;
        const intent = extracted.intent === "percentile"
            ? "rank"
            : extracted.intent === "count"
            ? "list"
            : extracted.intent === "chart"
            ? "lookup"
            : extracted.intent === "unknown"
            ? "unknown"
            : extracted.intent;
        return {
            raw: question,
            normalized,
            tokens: normalized.split(/\s+/g).filter(Boolean),
            intent,
            detectedIntent: {
                intent,
                confidence: extracted.confidence,
                reasons: ["slot_extractor_primary"].concat(extracted.reasons || [])
            },
            plannerSource: "slot",
            requestedFields: {
                rows: [],
                columns: [],
                values: [],
                metrics: [],
                entities: [],
                filters: []
            },
            metricPhrases: extracted.measures.slice(),
            entityPhrases: extracted.entities.map((entity) => entity.label).filter(Boolean),
            explicitMetricPhrase: extracted.measures[0],
            explicitEntityPhrases: extracted.entities.map((entity) => entity.label).filter(Boolean),
            chartType,
            limit: extracted.rank?.limit,
            direction: extracted.rank?.direction
        };
    }

    private isSlotAuthoritative(parsed: ParsedAssistantQuestion): boolean {
        return parsed.plannerSource === "slot"
            || (parsed.detectedIntent?.confidence || 0) >= 0.82
            && (parsed.detectedIntent?.reasons || []).some((reason) => /slot_extractor|matrix_planner|chart_planner|list_planner|count_planner/i.test(reason));
    }

    private validateSlotPlannedQuestion(parsed: ParsedAssistantQuestion): AssistantResponse | null {
        if (!this.isSlotAuthoritative(parsed)) return null;
        const metricSuggestions = this.getMetricSuggestions(5);
        if (parsed.matrix) {
            const values = (parsed.matrix.values || []).concat(parsed.matrix.metricPhrase ? [parsed.matrix.metricPhrase] : []);
            if (!values.some((value) => String(value || "").trim())) {
                return {
                    handled: true,
                    text: "Which metric should I use for this matrix?",
                    suggestions: metricSuggestions
                };
            }
            if (!(parsed.matrix.rows || []).length && !(parsed.matrix.columns || []).length) {
                return {
                    handled: true,
                    text: "Which row or column field should I use for this matrix?",
                    suggestions: this.knownMatrixFields().slice(0, 5).map((field) => field.name)
                };
            }
        }
        if (parsed.chartType && !(parsed.metricPhrases || []).length && !parsed.explicitMetricPhrase) {
            return {
                handled: true,
                text: "Which metric should I use for this chart?",
                suggestions: metricSuggestions
            };
        }
        if (parsed.intent === "rank" && !parsed.explicitMetricPhrase && !(parsed.metricPhrases || []).length && !parsed.topBottom?.metricPhrase) {
            return {
                handled: true,
                text: "Which metric should I rank by?",
                suggestions: metricSuggestions
            };
        }
        return null;
    }

    private buildCanonicalQuery(parsed: ParsedAssistantQuestion, extracted?: ExtractedQuestion | null): CanonicalAssistantQuery | null {
        const confidence = Math.max(extracted?.confidence || 0, parsed.detectedIntent?.confidence || 0);
        if (confidence < 0.82 && !this.isSlotAuthoritative(parsed)) return null;
        const extractedIntent = extracted?.intent === "percentile" ? "rank" : extracted?.intent === "count" ? "count" : extracted?.intent;
        const intent = parsed.matrix
            ? "matrix"
            : parsed.topBottom
            ? "rank"
            : extractedIntent === "chart"
            ? "chart"
            : extractedIntent === "compare"
            ? "compare"
            : extractedIntent === "list"
            ? "list"
            : extractedIntent === "count"
            ? "count"
            : parsed.intent === "compare"
            ? "compare"
            : parsed.intent === "list"
            ? "list"
            : parsed.intent === "lookup"
            ? "lookup"
            : parsed.intent === "matrix"
            ? "matrix"
            : null;
        if (!intent) return null;
        const fields = Array.from(new Set(([] as string[])
            .concat(extracted?.fields || [])
            .concat(parsed.requestedFields?.rows || [])
            .concat(parsed.requestedFields?.columns || [])
            .concat(parsed.requestedFields?.entities || [])
            .map((field) => String(field || "").trim())
            .filter(Boolean)));
        const measures = Array.from(new Set(([] as string[])
            .concat(extracted?.measures || [])
            .concat(parsed.requestedFields?.metrics || [])
            .concat(parsed.requestedFields?.values || [])
            .concat(parsed.explicitMetricPhrase ? [parsed.explicitMetricPhrase] : [])
            .concat(parsed.metricPhrases || [])
            .map((measure) => String(measure || "").trim())
            .filter(Boolean)));
        const filters = (parsed.filters?.includeFilters || []).slice();
        const output = parsed.chartType || (parsed.matrix ? "matrix" : undefined);
        return { intent, measures, fields, filters, output, confidence };
    }

    private validateCanonicalQuery(query: CanonicalAssistantQuery, parsed: ParsedAssistantQuestion): AssistantResponse | null {
        const metricSuggestions = this.getMetricSuggestions(5);
        if ((query.intent === "matrix" || query.intent === "rank" || query.intent === "chart") && !query.measures.length && !parsed.matrix?.defaultValue) {
            return { handled: true, text: `Which metric should I use for this ${query.intent}?`, suggestions: metricSuggestions };
        }
        if (query.intent === "matrix" && !((parsed.matrix?.rows || []).length || (parsed.matrix?.columns || []).length)) {
            return { handled: true, text: "Which row or column field should I use for this matrix?", suggestions: this.knownMatrixFields().slice(0, 5).map((field) => field.name) };
        }
        if ((query.intent === "list" || query.intent === "count") && !query.fields.length) {
            return { handled: true, text: query.intent === "count" ? "What should I count?" : "What field should I list?", suggestions: ["Assigned Tenant Name", "Unit", "Assigned Group", "Assigned Sales Category", "Zone"] };
        }
        const unresolvedFilters = query.filters.filter((filter) => filter.phrase && !(filter.matchedIndices || []).length);
        if (unresolvedFilters.length) {
            return {
                handled: true,
                text: `I could not match ${unresolvedFilters.map((filter) => filter.phrase).join(", ")} to loaded rows. Please choose the correct filter value.`,
                suggestions: this.getEntitySuggestions(5)
            };
        }
        return null;
    }

    private getEntitySuggestions(limit: number = 5): string[] {
        return Array.from(new Set((this.context.entities || [])
            .filter((entity) => entity.kind !== "context" && (entity.indices || []).length)
            .map((entity) => String(entity.label || "").trim())
            .filter(Boolean)))
            .slice(0, limit);
    }

    private answerExactFieldMetricMatrixQuestion(question: string, baseConfidence: AssistantConfidence): AssistantResponse | null {
        if (this.hasRankLanguage(question)) return null;
        const norm = (value: string): string => this.normalizeOverrideText(value).trim();
        const normalized = ` ${norm(question)} `;
        if (!normalized.trim()) return null;
        const contains = (value: string): boolean => {
            const clean = norm(value);
            return !!clean && clean.length >= 3 && normalized.indexOf(` ${clean} `) >= 0;
        };
        const matchedMetrics = (this.context.metrics || [])
            .filter((metric) => !isDimensionMetric(metric) && metric.formatHint !== "text")
            .map((metric) => {
                const labels = [metric.name].concat(metric.aliases || [])
                    .map((label) => String(label || "").trim())
                    .filter(Boolean)
                    .filter((label) => contains(label))
                    .sort((a, b) => norm(b).length - norm(a).length);
                return labels[0] ? { metric, label: labels[0], cleanLabel: norm(labels[0]) } : null;
            })
            .filter((item): item is { metric: AssistantMetric; label: string; cleanLabel: string } => !!item)
            .sort((a, b) => b.cleanLabel.length - a.cleanLabel.length);
        const metrics: AssistantMetric[] = [];
        const selectedMetricLabels: string[] = [];
        matchedMetrics.forEach((item) => {
            if (selectedMetricLabels.some((label) => label.indexOf(item.cleanLabel) >= 0 || item.cleanLabel.indexOf(label) >= 0)) return;
            if (metrics.some((metric) => metric.key === item.metric.key)) return;
            selectedMetricLabels.push(item.cleanLabel);
            metrics.push(item.metric);
        });
        if (!metrics.length) return null;
        const fields = this.knownMatrixFields()
            .filter((field) => [field.name].concat(field.aliases || []).some((label) => contains(label)))
            .map((field) => field.name)
            .filter((field) => !selectedMetricLabels.some((label) => label === norm(field)))
            .filter((field, index, arr) => arr.findIndex((candidate) => norm(candidate) === norm(field)) === index);
        if (!fields.length) return null;
        const metricNames = metrics.map((metric) => metric.name).filter(Boolean);
        const planned = this.planMatrixSlots({
            intent: "matrix",
            confidence: 1,
            reasons: ["exact_field_metric_matrix"],
            measures: metricNames,
            fields,
            entities: [],
            axes: { rows: [], columns: [] },
            axesExplicit: { rows: false, columns: false },
            filters: [],
            chartType: undefined,
            rank: undefined
        });
        if (!planned && fields.length >= 2) {
            const parsed = parseAssistantQuestion(question);
            parsed.intent = "lookup";
            parsed.topBottom = undefined;
            parsed.matrix = undefined;
            parsed.breakdown = undefined;
            parsed.entityPhrases = [];
            parsed.explicitEntityPhrases = [];
            parsed.compareEntityPhrases = [];
            parsed.filters = undefined;
            parsed.explicitMetricPhrase = metricNames[0];
            parsed.metricPhrases = metricNames;
            parsed.requestedFields = {
                rows: fields,
                columns: [],
                values: metricNames,
                metrics: metricNames,
                entities: [],
                filters: []
            };
            parsed.detectedIntent = {
                intent: "lookup",
                confidence: 1,
                reasons: ["exact_field_metric_table", "cardinality_table_fallback"]
            };
            return this.withSuggestions(answerFilterFieldBreakdown(this.context, parsed, metrics[0], fields, metrics.slice(1, 30)), [], undefined, {
                ...baseConfidence,
                intent: "lookup",
                intentConfidence: 1,
                metricConfidence: 1,
                entityConfidence: 1,
                overallConfidence: 1,
                reasons: ["exact_field_metric_table", "cardinality_table_fallback"]
            });
        }
        const rows = planned?.rows?.length
            ? planned.rows
            : fields.filter((field) => this.assistantFieldRoleAllowed(field, "row")).slice(0, 5);
        const columns = planned?.columns || [];
        const values = planned?.values?.length ? planned.values : metricNames;
        if (!rows.length && !columns.length) return null;
        const parsed = parseAssistantQuestion(question);
        parsed.intent = "matrix";
        parsed.topBottom = undefined;
        parsed.breakdown = undefined;
        parsed.entityPhrases = [];
        parsed.explicitEntityPhrases = [];
        parsed.compareEntityPhrases = [];
        parsed.filters = undefined;
        parsed.explicitMetricPhrase = values[0];
        parsed.metricPhrases = values;
        parsed.matrix = {
            intent: "matrix",
            rows,
            columns,
            values,
            filters: planned?.filterTexts || [],
            query: planned?.query || normalizeMatrixQuery({ rows, columns, values, filters: [] }),
            defaultValue: false,
            autoAxes: false,
            hideZeros: planned?.query.hideZeros,
            totalsMode: planned?.totalsMode,
            metricPhrase: values[0],
            metricPhrases: values.length > 1 ? values : undefined,
            rowPhrases: rows,
            columnPhrases: columns
        };
        parsed.requestedFields = {
            rows,
            columns,
            values,
            metrics: values,
            entities: [],
            filters: planned?.filterTexts || []
        };
        return this.withSuggestions(answerMatrix(this.context, parsed, metrics, []), [], undefined, {
            ...baseConfidence,
            intent: "matrix",
            intentConfidence: 1,
            metricConfidence: 1,
            entityConfidence: 1,
            overallConfidence: 1,
            reasons: ["exact_field_metric_matrix"]
        });
    }

    private answerDirectFieldMetricQuestion(question: string, extracted: ExtractedQuestion | undefined, baseConfidence: AssistantConfidence): AssistantResponse | null {
        if (this.hasRankLanguage(question)) return null;
        if (/\b(?:list|count|how\s+many|compare|versus|vs|select|highlight|zoom)\b/i.test(question)) return null;
        const fields = this.mergeMatrixFieldsFromQuestion(question, extracted?.fields || [])
            .filter((field) => !this.isKnownMetricLabel(field))
            .filter((field, index, arr) => arr.findIndex((candidate) => this.normalizeOverrideText(candidate) === this.normalizeOverrideText(field)) === index);
        if (!fields.length) return null;
        const metrics = this.pruneUnaskedResolvedMetrics(question, this.resolveExactMetricsInText(question)
            .concat(this.resolveMetricsInPhraseOrder(extracted?.measures || [], 30))
            .filter((metric) => !isDimensionMetric(metric))
            .filter((metric, index, arr) => arr.findIndex((candidate) => candidate.key === metric.key) === index));
        if (!metrics.length) return null;
        const metricNames = metrics.map((metric) => metric.name).filter(Boolean);
        const planned = this.planMatrixSlots({
            intent: "matrix",
            confidence: 1,
            reasons: ["direct_field_metric_question"],
            measures: metricNames,
            fields,
            entities: [],
            axes: { rows: [], columns: [] },
            axesExplicit: { rows: false, columns: false },
            filters: [],
            chartType: undefined,
            rank: undefined
        });
        const parsed = parseAssistantQuestion(question);
        parsed.entityPhrases = [];
        parsed.explicitEntityPhrases = [];
        parsed.compareEntityPhrases = [];
        parsed.filters = undefined;
        parsed.explicitMetricPhrase = metricNames[0];
        parsed.metricPhrases = metricNames;
        if (!planned) {
            this.promoteMeasureWithFieldsToBreakdown(parsed, metricNames, fields, [], ["direct_field_metric_question", "cardinality_table_fallback"]);
            return this.withSuggestions(answerFilterFieldBreakdown(this.context, parsed, metrics[0], fields, metrics.slice(1, 30)), [], undefined, {
                ...baseConfidence,
                intent: "lookup",
                intentConfidence: 1,
                metricConfidence: 1,
                entityConfidence: 1,
                overallConfidence: 1,
                reasons: ["direct_field_metric_question", "cardinality_table_fallback"]
            });
        }
        const { rows, columns, values, filterTexts } = planned;
        parsed.intent = "matrix";
        parsed.matrix = {
            intent: "matrix",
            rows,
            columns,
            values,
            filters: filterTexts,
            query: planned.query,
            defaultValue: false,
            autoAxes: false,
            hideZeros: planned.query.hideZeros,
            totalsMode: planned.totalsMode,
            metricPhrase: values[0],
            metricPhrases: values.length > 1 ? values : undefined,
            rowPhrases: rows,
            columnPhrases: columns
        };
        parsed.requestedFields = {
            rows,
            columns,
            values,
            metrics: values,
            entities: [],
            filters: filterTexts
        };
        return this.withSuggestions(answerMatrix(this.context, parsed, metrics, []), [], undefined, {
            ...baseConfidence,
            intent: "matrix",
            intentConfidence: 1,
            metricConfidence: 1,
            entityConfidence: 1,
            overallConfidence: 1,
            reasons: ["direct_field_metric_question"]
        });
    }

    private canonicalTargetField(query: CanonicalAssistantQuery, fallback: string = "Assigned Tenant Name"): string {
        return query.fields.find((field) => this.assistantKindForField(field) === "tenant")
            || query.fields.find((field) => this.assistantKindForField(field) === "unit")
            || query.fields[0]
            || fallback;
    }

    private canonicalMetrics(query: CanonicalAssistantQuery, parsed: ParsedAssistantQuestion, limit: number = 8): AssistantMetric[] {
        const phrases = query.measures.length ? query.measures : (parsed.matrix ? this.getMatrixMetricPhrases(parsed) : parsed.metricPhrases || []);
        const metrics = this.resolveMetricsInPhraseOrder(phrases, limit);
        if (metrics.length) return metrics;
        const fallback = this.getDefaultRankMetric() || this.getDefaultMatrixMetric();
        return fallback ? [fallback] : [];
    }

    private resolveMatrixValueMetrics(parsed: ParsedAssistantQuestion, query?: CanonicalAssistantQuery, limit: number = 8): AssistantMetric[] {
        const phrases = Array.from(new Set(([] as string[])
            .concat(parsed.matrix?.values || [])
            .concat(parsed.matrix?.metricPhrases || [])
            .concat(parsed.matrix?.metricPhrase ? [parsed.matrix.metricPhrase] : [])
            .concat(parsed.requestedFields?.values || [])
            .concat(parsed.requestedFields?.metrics || [])
            .concat(query?.measures || [])
            .map((phrase) => String(phrase || "").trim())
            .filter(Boolean)));
        const exactDynamic = this.resolveExactDynamicMetricLabels(phrases);
        const resolved = this.resolveMetricsInPhraseOrder(phrases.length ? phrases : this.getMatrixMetricPhrases(parsed), limit);
        const merged = this.mergeMetricPriorityLists(exactDynamic, resolved);
        return merged.length ? merged.slice(0, limit) : resolved.slice(0, limit);
    }

    private resolveExactDynamicMetricLabels(labels: string[]): AssistantMetric[] {
        const wanted = (labels || [])
            .map((label) => this.normalizeOverrideText(label))
            .filter(Boolean);
        if (!wanted.length) return [];
        return this.mergeMetricPriorityLists((this.context.metrics || [])
            .filter((metric) => metric.kind === "dynamic" && !isDimensionMetric(metric))
            .filter((metric) => {
                const name = this.normalizeOverrideText(metric.name || "");
                return wanted.some((label) => label === name);
            })
            .sort((a, b) => this.normalizeOverrideText(b.name || "").length - this.normalizeOverrideText(a.name || "").length));
    }

    private answerCanonicalQuery(query: CanonicalAssistantQuery, parsed: ParsedAssistantQuestion, baseConfidence: AssistantConfidence): AssistantResponse | null {
        const validation = this.validateCanonicalQuery(query, parsed);
        if (validation) return this.withSuggestions(validation, validation.suggestions || [], undefined, baseConfidence);

        if (query.intent === "list") {
            const target = this.canonicalTargetField(query);
            const scopes = this.getCountScopeEntities({
                ...parsed,
                intent: "list",
                matrix: undefined,
                requestedFields: {
                    rows: [],
                    columns: [],
                    values: [],
                    metrics: [],
                    entities: [target],
                    filters: query.filters.map((filter) => filter.phrase)
                }
            });
            return this.withSuggestions(answerList(this.context, {
                ...parsed,
                intent: "list",
                matrix: undefined,
                topBottom: undefined,
                breakdown: undefined,
                explicitMetricPhrase: undefined,
                metricPhrases: [],
                requestedFields: {
                    rows: [],
                    columns: [],
                    values: [],
                    metrics: [],
                    entities: [target],
                    filters: query.filters.map((filter) => filter.phrase)
                }
            }, scopes), [], undefined, baseConfidence);
        }

        if (query.intent === "count") {
            const targetKind = this.assistantKindForField(this.canonicalTargetField(query, "Unit"));
            const request = targetKind === "tenant"
                ? { kind: "tenant" as AssistantEntity["kind"], label: "tenant" }
                : targetKind === "unit"
                ? { kind: "unit" as AssistantEntity["kind"], label: "unit" }
                : targetKind === "category" || targetKind === "group" || targetKind === "zone" || targetKind === "floor" || targetKind === "layer"
                ? { kind: targetKind as AssistantEntity["kind"], label: targetKind }
                : { kind: "unit" as AssistantEntity["kind"], label: "unit" };
            const scopes = this.getCountScopeEntities(parsed);
            const scoped = this.answerScopedEntityCount(request, scopes);
            if (scoped) return this.withSuggestions(scoped, [], undefined, baseConfidence);
            const global = this.answerGlobalRowBackedCount(request);
            if (global) return this.withSuggestions(global, [], undefined, baseConfidence);
            return this.withSuggestions(answerEntityCount(this.context, request.kind, request.label), [], undefined, baseConfidence);
        }

        if (query.intent === "matrix" && parsed.matrix) {
            const metrics = parsed.matrix.defaultValue ? [this.getDefaultMatrixMetric()].filter(Boolean) as AssistantMetric[] : this.resolveMatrixValueMetrics(parsed, query, 8);
            if (!metrics.length) {
                const suggestions = this.getMetricSuggestions(5);
                return this.withSuggestions({ handled: true, text: "Which metric should I use for this matrix?", suggestions }, suggestions, undefined, baseConfidence);
            }
            return this.withSuggestions(answerMatrix(this.context, parsed, metrics, []), [], undefined, baseConfidence);
        }

        if (query.intent === "rank" && parsed.topBottom) {
            const metrics = this.canonicalMetrics(query, parsed, 8);
            if (!metrics.length) {
                const suggestions = this.getMetricSuggestions(5);
                return this.withSuggestions({ handled: true, text: "Which metric should I rank by?", suggestions }, suggestions, undefined, baseConfidence);
            }
            return this.withSuggestions(answerRank(this.context, parsed, this.getCountScopeEntities(parsed), metrics), [], undefined, baseConfidence);
        }

        if (query.intent === "chart") {
            const metrics = this.canonicalMetrics(query, parsed, 8);
            if (!metrics.length) {
                const suggestions = this.getMetricSuggestions(5);
                return this.withSuggestions({ handled: true, text: "Which metric should I use for this chart?", suggestions }, suggestions, undefined, baseConfidence);
            }
            const chartFields = this.getChartBreakdownFields(parsed);
            if (chartFields.length) {
                return this.withSuggestions(answerFilterFieldBreakdown(this.context, parsed, metrics[0], chartFields), [], undefined, baseConfidence);
            }
            const scopes = this.getCountScopeEntities(parsed);
            if (scopes.length) {
                return this.withSuggestions(answerLookup(this.context, {
                    ...parsed,
                    intent: "lookup",
                    matrix: undefined,
                    topBottom: undefined
                }, scopes, metrics), [], undefined, baseConfidence);
            }
            return null;
        }

        if (query.intent === "compare") {
            const entities = this.getCompareEntities(parsed);
            if (entities.length < 2) return null;
            const metrics = this.canonicalMetrics(query, parsed, 8);
            return this.withSuggestions(answerCompare(this.context, entities, metrics, parsed), [], undefined, baseConfidence);
        }

        return null;
    }

    private getAutocompleteExamples(limit: number = 8): AssistantAutocompleteItem[] {
        const examples = [
            "top tenants by [measure]",
            "top groups by [measure]",
            "top zones by [measure]",
            "list tenants in [group] group",
            "list tenants in [category] category",
            "compare [tenant] with [tenant] by [measure]",
            "show [measure] for [tenant]",
            "show [measure] by category and group",
            "show [measure] by tenants in [zone]",
            "show vacant units by floor"
        ];
        return Array.from(new Set(examples.map((label) => String(label || "").trim()).filter(Boolean)))
            .slice(0, limit)
            .map((label, index) => ({
                type: "example" as const,
                id: `example:${index}`,
                label,
                subtitle: "Example question"
            }));
    }

    async answerAsync(question: string, overrides?: { entities?: AssistantEntity[]; metrics?: AssistantMetric[]; parsed?: ParsedAssistantQuestion }): Promise<AssistantResponse> {
        const profileOwner = this.beginPerformanceProfile("answer");
        try {
            if (overrides?.parsed) {
                return this.finishPerformanceProfile(this.answer(question, overrides, { question, changed: false }), profileOwner);
            }
            const rawExtracted = this.profileStep("slotExtraction", () => this.slotExtractor.extract(question));
            if (this.shouldUseRawExtractedQuestion(rawExtracted)) {
                return this.finishPerformanceProfile(this.answer(question, overrides, { question, changed: false, reason: "slot_extractor" }, rawExtracted), profileOwner);
            }
            if (this.shouldUseSemanticFallback(rawExtracted)) {
                const semanticRewrite = await this.profileStepAsync("semanticRewrite", () => this.semanticLayer.rewriteQuestionAsync(question));
                return this.finishPerformanceProfile(this.answer(question, overrides, semanticRewrite, rawExtracted), profileOwner);
            }
            return this.finishPerformanceProfile(this.answer(question, overrides, { question, changed: false, reason: "slot_extractor_no_rewrite" }, rawExtracted), profileOwner);
        } catch (err) {
            this.clearPerformanceProfile(profileOwner);
            throw err;
        }
    }

    answer(
        question: string,
        overrides?: { entities?: AssistantEntity[]; metrics?: AssistantMetric[]; parsed?: ParsedAssistantQuestion },
        semanticRewriteOverride?: { question: string; changed: boolean; reason?: string },
        extractedOverride?: ExtractedQuestion | null
    ): AssistantResponse {
        const profileOwner = this.beginPerformanceProfile("answer");
        try {
            return this.finishPerformanceProfile(this.answerCore(question, overrides, semanticRewriteOverride, extractedOverride), profileOwner);
        } catch (err) {
            this.clearPerformanceProfile(profileOwner);
            throw err;
        }
    }

    private answerCore(
        question: string,
        overrides?: { entities?: AssistantEntity[]; metrics?: AssistantMetric[]; parsed?: ParsedAssistantQuestion },
        semanticRewriteOverride?: { question: string; changed: boolean; reason?: string },
        extractedOverride?: ExtractedQuestion | null
    ): AssistantResponse {
        const rawExtracted = overrides?.parsed ? null : (extractedOverride || this.profileStep("slotExtraction", () => this.slotExtractor.extract(question)));
        const useRawExtracted = this.shouldUseRawExtractedQuestion(rawExtracted);
        const useSemanticFallback = !overrides?.parsed && !useRawExtracted && this.shouldUseSemanticFallback(rawExtracted);
        const semanticRewrite = semanticRewriteOverride
            || (overrides?.parsed || useRawExtracted
                ? { question, changed: false, reason: useRawExtracted ? "slot_extractor" : undefined }
                : useSemanticFallback
                ? this.semanticLayer.rewriteQuestion(question)
                : { question, changed: false, reason: "slot_extractor_no_rewrite" });
        const parsed = overrides?.parsed
            || (useRawExtracted && rawExtracted
                ? this.createParsedFromExtractedQuestion(question, rawExtracted)
                : parseAssistantQuestion(semanticRewrite.question));
        if (!overrides?.parsed) {
            this.profileStep("slotApply", () => {
                this.applyExtractedQuestionSlots(parsed, useRawExtracted ? rawExtracted! : this.slotExtractor.extract(semanticRewrite.question));
            });
        }
        this.profileStep("answerPlanning", () => {
            this.forceRawFieldMetricMatrix(parsed, rawExtracted || undefined);
            this.promoteMeasureWithFieldsToMatrix(parsed, rawExtracted || undefined);
            this.forceMetricEntityLookup(parsed, rawExtracted || undefined);
            this.forceExplicitListIntent(parsed, rawExtracted || undefined);
            this.correctRankDimensionAndMetric(parsed, rawExtracted || undefined);
            this.replanMatrixWithCardinality(parsed, rawExtracted || undefined);
            this.enforceExplicitMatrixFields(parsed);
            this.applyAutoMatrixAxes(parsed);
            parsed.fieldResolutions = this.resolveRequestedFields(parsed);
        });
        const baseConfidence = this.makeConfidence(parsed, {
            intentConfidence: this.intentConfidence(parsed, semanticRewrite.changed ? semanticRewrite.reason : undefined),
            metricConfidence: 1,
            entityConfidence: 1,
            fieldResolutions: parsed.fieldResolutions,
            reasons: semanticRewrite.changed && semanticRewrite.reason ? [semanticRewrite.reason] : []
        });
        if (parsed.intent === "help" || !parsed.normalized) {
            return { ...answerHelp(this.context), confidence: baseConfidence };
        }
        const accessBlocked = this.bookmarkMeasureAccessBlockedResponse();
        if (accessBlocked) return this.withSuggestions(accessBlocked, [], undefined, baseConfidence);
        const cardinalityAnswer = this.answerCardinalityQuestion(parsed.raw || question);
        if (cardinalityAnswer) return this.withSuggestions(cardinalityAnswer, cardinalityAnswer.suggestions || [], undefined, baseConfidence);
        const disabledDictionaryGate = this.buildDisabledDictionaryGate(parsed, baseConfidence);
        if (disabledDictionaryGate) {
            return this.withSuggestions(disabledDictionaryGate, disabledDictionaryGate.suggestions || [], undefined, disabledDictionaryGate.confidence || baseConfidence);
        }
        const directFieldValueList = !overrides?.metrics?.length
            ? this.answerFieldValueListQuestion(parsed, rawExtracted || undefined)
            : null;
        if (directFieldValueList) return this.withSuggestions(directFieldValueList, directFieldValueList.suggestions || [], undefined, baseConfidence);
        const directFieldMetricAnswer = this.answerDirectFieldMetricQuestion(question, rawExtracted || undefined, baseConfidence);
        if (directFieldMetricAnswer) return directFieldMetricAnswer;
        const exactFieldMetricMatrix = !overrides?.entities?.length && !overrides?.metrics?.length
            ? this.answerExactFieldMetricMatrixQuestion(question, baseConfidence)
            : null;
        if (exactFieldMetricMatrix) return exactFieldMetricMatrix;
        const unzonedAnswer = !overrides?.entities?.length && !overrides?.metrics?.length
            ? this.answerRawZonedQuestion(question)
            : null;
        if (unzonedAnswer) return this.withSuggestions(unzonedAnswer, [], undefined, baseConfidence);
        if (!overrides?.entities?.length && parsed.matrix) {
            const matrixMetrics = overrides?.metrics?.length
                ? overrides!.metrics || []
                : parsed.matrix.defaultValue
                ? [this.getDefaultMatrixMetric()].filter((metric): metric is AssistantMetric => !!metric)
                : this.resolveMatrixValueMetrics(parsed, undefined, 8);
            if (!matrixMetrics.length) {
                const metricSuggestions = this.getMetricSuggestions(5);
                return this.withSuggestions({
                    handled: true,
                    text: `I couldn't identify the matrix metric "${parsed.matrix.metricPhrase}". Which metric did you mean?`,
                    suggestions: metricSuggestions
                }, metricSuggestions, undefined, baseConfidence);
            }
            return this.withSuggestions(answerMatrix(this.context, parsed, matrixMetrics, []), [], undefined, baseConfidence);
        }
        const canonicalQuery = !overrides?.entities?.length && !overrides?.metrics?.length
            ? this.buildCanonicalQuery(parsed, rawExtracted || undefined)
            : null;
        const canonicalAnswer = canonicalQuery ? this.answerCanonicalQuery(canonicalQuery, parsed, baseConfidence) : null;
        if (canonicalAnswer) return canonicalAnswer;
        const fieldOnlyScopedList = !overrides?.entities?.length && !overrides?.metrics?.length
            ? this.answerFieldOnlyScopedList(parsed, rawExtracted || undefined)
            : null;
        if (fieldOnlyScopedList) return this.withSuggestions(fieldOnlyScopedList, fieldOnlyScopedList.suggestions || [], undefined, baseConfidence);
        const rawScopedList = !overrides?.entities?.length && !overrides?.metrics?.length
            ? this.answerRawScopedTenantOrUnitList(parsed)
            : null;
        if (rawScopedList) return this.withSuggestions(rawScopedList, rawScopedList.suggestions || [], undefined, baseConfidence);
        const rawSelect = !overrides?.entities?.length && !overrides?.metrics?.length
            ? this.answerRawEntitySelect(parsed) || this.answerBareEntitySelect(parsed)
            : null;
        if (rawSelect) return this.withSuggestions(rawSelect, rawSelect.suggestions || [], undefined, baseConfidence);
        const slotAuthoritative = this.isSlotAuthoritative(parsed);
        const slotValidation = this.validateSlotPlannedQuestion(parsed);
        if (slotValidation) return this.withSuggestions(slotValidation, slotValidation.suggestions || [], undefined, baseConfidence);
        const allowLegacyEarlyRoutes = !slotAuthoritative && !overrides?.entities?.length && !overrides?.metrics?.length;
        const earlyScopedCount = allowLegacyEarlyRoutes
            ? this.answerRawScopedCount(question)
            : null;
        if (earlyScopedCount) {
            return this.withSuggestions(earlyScopedCount, [], undefined, baseConfidence);
        }
        const earlyCountRank = allowLegacyEarlyRoutes
            ? this.answerRawCountRank(question)
            : null;
        if (earlyCountRank) {
            return this.withSuggestions(earlyCountRank, [], undefined, baseConfidence);
        }
        const earlyFieldResolutionGate = this.buildFieldResolutionGate(parsed, baseConfidence);
        if (earlyFieldResolutionGate) return this.withSuggestions(earlyFieldResolutionGate, earlyFieldResolutionGate.suggestions || [], undefined, earlyFieldResolutionGate.confidence || baseConfidence);
        const earlyRawAttributeLookup = !slotAuthoritative && !overrides?.entities?.length
            ? this.getEarlyAttributeLookup(parsed, [], question)
            : null;
        if (earlyRawAttributeLookup) {
            return this.withSuggestions(earlyRawAttributeLookup, earlyRawAttributeLookup.suggestions || [], undefined, earlyRawAttributeLookup.confidence || baseConfidence);
        }
        if (!overrides?.entities?.length && parsed.matrix) {
            const matrixMetrics = overrides?.metrics?.length
                ? overrides!.metrics || []
                : parsed.matrix.defaultValue
                ? [this.getDefaultMatrixMetric()].filter((metric): metric is AssistantMetric => !!metric)
                : this.resolveMatrixValueMetrics(parsed, undefined, 8);
            if (!matrixMetrics.length) {
                const metricSuggestions = this.getMetricSuggestions(5);
                return this.withSuggestions({
                    handled: true,
                    text: `I couldn't identify the matrix metric "${parsed.matrix.metricPhrase}". Which metric did you mean?`,
                    suggestions: metricSuggestions
                }, metricSuggestions, undefined, baseConfidence);
            }
            return this.withSuggestions(answerMatrix(this.context, parsed, matrixMetrics, []), [], undefined, baseConfidence);
        }
        if (allowLegacyEarlyRoutes) {
            const inferred = this.inferPasteOverrides(parsed);
            if (inferred.filterFields.length && inferred.metrics.length && !parsed.matrix && !parsed.topBottom) {
                const metric = this.resolveBuiltinMetricFromText(String(parsed.raw || parsed.normalized || "")) || inferred.metrics[0];
                return this.withSuggestions(answerFilterFieldBreakdown(this.context, parsed, metric, inferred.filterFields), [], undefined, baseConfidence);
            }
            if ((inferred.entities.length || inferred.metrics.length) && !parsed.matrix && !parsed.topBottom) {
                overrides = {
                    entities: inferred.entities.length ? inferred.entities : undefined,
                    metrics: inferred.metrics.length ? inferred.metrics : undefined
                };
            }
        }

        const hasEntityOverride = !!(overrides?.entities?.length);
        const hasMetricOverride = !!(overrides?.metrics?.length);

        const earlyCompareClarification = (!hasEntityOverride && parsed.intent === "compare")
            ? this.getEarlyCompareClarification(parsed)
            : null;
        if (earlyCompareClarification) return this.withSuggestions(earlyCompareClarification, earlyCompareClarification.suggestions || [], undefined, baseConfidence);

        const inlineMetricPhrases = Array.from(new Set((String(parsed.normalized || "").match(/\b(area|sqm|m2|size|rent|rental|lease|sales|revenue|turnover|ocr|occupancy|vacancy|vacant|occupied|units|unit|amount|value|gla)\b/gi) || [])
            .map((item) => String(item || "").toLowerCase())));
        const metricPhrases = parsed.crossMetric
            ? [parsed.crossMetric.firstMetricPhrase, parsed.crossMetric.secondMetricPhrase].concat(parsed.metricPhrases)
            : parsed.matrix
            ? this.getMatrixMetricPhrases(parsed)
            : parsed.breakdown
            ? inlineMetricPhrases.concat(parsed.explicitMetricPhrase ? [parsed.explicitMetricPhrase] : [], parsed.metricPhrases)
            : parsed.explicitMetricPhrase
            ? [parsed.explicitMetricPhrase].concat(parsed.metricPhrases)
            : (parsed.intent === "compare" ? [] : parsed.metricPhrases);
        const entityPhrases = this.getEntityPhrasesForIntent(parsed);

        const earlyAttributeLookup = !hasEntityOverride ? this.getEarlyAttributeLookup(parsed, entityPhrases, question) : null;
        if (earlyAttributeLookup) return this.withSuggestions(earlyAttributeLookup, earlyAttributeLookup.suggestions || [], undefined, earlyAttributeLookup.confidence || baseConfidence);

        const earlyFieldBreakdown = !hasMetricOverride && !hasEntityOverride ? this.getEarlyFilterFieldBreakdown(parsed, baseConfidence) : null;
        if (earlyFieldBreakdown) return earlyFieldBreakdown;

        // Hard rule: if user explicitly selected tokens, DO NOT apply fuzzy matching for metrics either
        const initialMetricMatches = hasMetricOverride || parsed.hasExplicitSelections
            ? []
            : this.profileStep("metricMatching", () => this.matcher.matchMetrics(metricPhrases, 8));
        const exactQuestionMetrics = !hasMetricOverride
            ? this.resolveMetricsMentionedInQuestionText(String(parsed.raw || parsed.normalized || ""), 30)
            : [];
        const forcedBuiltinMetric = !slotAuthoritative && !hasMetricOverride && !parsed.matrix && !exactQuestionMetrics.length
            ? this.resolveBuiltinMetricFromText(String(parsed.raw || parsed.normalized || ""))
            : null;
        const metricGate = !hasMetricOverride
            ? this.buildMetricConfidenceGate(parsed, metricPhrases, initialMetricMatches)
            : null;
        if (metricGate) return this.withSuggestions(metricGate, metricGate.suggestions || [], undefined, metricGate.confidence);

        let metrics = hasMetricOverride
            ? overrides!.metrics!
            : exactQuestionMetrics.length
            ? exactQuestionMetrics
            : slotAuthoritative && metricPhrases.length
            ? this.resolveMetricsInPhraseOrder(metricPhrases, 30)
            : forcedBuiltinMetric
            ? [forcedBuiltinMetric].concat(initialMetricMatches.slice(0, 4).map((match) => match.item).filter((metric) => metric.key !== forcedBuiltinMetric.key))
            : this.preferBuiltinAreaMetric(parsed.tokens, parsed.normalized, initialMetricMatches.slice(0, 4).map((match) => match.item));
        if (!hasMetricOverride && parsed.intent === "lookup") {
            const lookupMetrics = this.resolveMetricsInPhraseOrder(this.getLookupMetricPhrases(parsed), 30);
            if (lookupMetrics.length) metrics = lookupMetrics;
        }
        if (!hasMetricOverride && parsed.intent === "compare") {
            const compareMetrics = this.resolveMetricsInPhraseOrder(this.getCompareMetricPhrases(parsed), 30);
            if (compareMetrics.length) metrics = compareMetrics;
        }
        if (!hasMetricOverride && parsed.matrix) {
            if (parsed.matrix.defaultValue) {
                const defaultMatrixMetric = this.getDefaultMatrixMetric();
                if (defaultMatrixMetric) metrics = [defaultMatrixMetric];
            } else {
                const matrixMetricPhrases = this.getMatrixMetricPhrases(parsed);
                // Hard rule: if user explicitly selected tokens, skip fuzzy matching
                const matrixMetricMatches = parsed.hasExplicitSelections
                    ? []
                    : this.profileStep("metricMatching", () => this.matcher.matchMetrics(matrixMetricPhrases, 12));
                const matrixMetricGate = this.buildMetricConfidenceGate(parsed, matrixMetricPhrases, matrixMetricMatches);
                if (matrixMetricGate) return this.withSuggestions(matrixMetricGate, matrixMetricGate.suggestions || [], undefined, matrixMetricGate.confidence);
                const matrixMetrics = this.pruneUnaskedResolvedMetrics(String(parsed.raw || parsed.normalized || ""), this.resolveMatrixValueMetrics(parsed, undefined, 8));
                metrics = matrixMetrics;
            }
        }
        if (!hasMetricOverride) {
            metrics = this.pruneUnaskedResolvedMetrics(String(parsed.raw || parsed.normalized || ""), metrics);
        }
        const metricAmbiguityGate = !hasMetricOverride
            ? this.buildExactMetricAmbiguityGate(parsed, metrics, baseConfidence)
            : null;
        if (metricAmbiguityGate) {
            return this.withSuggestions(metricAmbiguityGate, metricAmbiguityGate.suggestions || [], undefined, metricAmbiguityGate.confidence || baseConfidence);
        }

        if (/\b(benchmark|benchmarks|percentile|percentiles|statistics|statistic|statics|tenant concentration|concentration)\b/i.test(`${parsed.raw || ""} ${parsed.normalized || ""}`)) {
            const rankMetrics = parsed.topBottom
                ? this.pruneUnaskedResolvedMetrics(String(parsed.raw || parsed.normalized || ""), this.resolveMetricsInPhraseOrder(this.getTopBottomMetricPhrases(parsed), 30))
                : metrics;
            const effectiveMetrics = rankMetrics.length ? rankMetrics : (metrics.length ? metrics : [this.getDefaultRankMetric()].filter(Boolean) as AssistantMetric[]);
            const benchmarkResponse = answerBenchmarkRankFallback(this.context, parsed, effectiveMetrics);
            if (benchmarkResponse) return this.withSuggestions(benchmarkResponse, benchmarkResponse.suggestions || [], undefined, baseConfidence);
        }

        if (parsed.topBottom && parsed.intent !== "matrix") {
            const rankMetricPhrases = this.getTopBottomMetricPhrases(parsed);
            if (!hasMetricOverride) {
                // Hard rule: if user explicitly selected tokens, skip fuzzy matching
                const rankMetricMatches = parsed.hasExplicitSelections
                    ? []
                    : this.profileStep("metricMatching", () => this.matcher.matchMetrics(rankMetricPhrases, 8));
                const rankMetricGate = this.buildMetricConfidenceGate(parsed, rankMetricPhrases, rankMetricMatches);
                if (rankMetricGate) return this.withSuggestions(rankMetricGate, rankMetricGate.suggestions || [], undefined, rankMetricGate.confidence);
            }
            const rankMetrics = hasMetricOverride
                ? metrics
                : this.pruneUnaskedResolvedMetrics(String(parsed.raw || parsed.normalized || ""), this.resolveMetricsMentionedInQuestionText(String(parsed.raw || parsed.normalized || ""), 30)
                    .concat(this.resolveMetricsInPhraseOrder(rankMetricPhrases, 30))
                    .filter((metric, index, arr) => arr.findIndex((item) => item.key === metric.key) === index));
            const effectiveMetrics = rankMetrics.length ? rankMetrics : (metrics.length ? metrics : [this.getDefaultRankMetric()].filter(Boolean) as AssistantMetric[]);
            if (!effectiveMetrics.length) {
                const metricSuggestions = this.getMetricSuggestions(5);
                return this.withSuggestions({
                    handled: true,
                    text: `I couldn't identify the metric "${parsed.topBottom.metricPhrase}". Which metric did you mean?`,
                    suggestions: metricSuggestions
                }, metricSuggestions, undefined);
            }
            return this.withSuggestions(answerRank(this.context, parsed, this.getExplicitScopeEntities(parsed), effectiveMetrics), [], undefined);
        }

        let exactEntities: AssistantEntity[];
        let fuzzyEntityMatches: Array<AssistantMatch<AssistantEntity>>;
        let confidentFuzzyEntityMatches: Array<AssistantMatch<AssistantEntity>>;

        if (hasEntityOverride) {
            const extra = (parsed.intent === "compare" && overrides!.entities!.length < 2 && !parsed.hasExplicitSelections)
                ? this.getExactEntities(parsed.normalized, entityPhrases)
                    .filter((e) => !overrides!.entities!.some((oe) => oe.id === e.id && oe.kind === e.kind))
                : [];
            exactEntities = overrides!.entities!.concat(extra);
            fuzzyEntityMatches = [];
            confidentFuzzyEntityMatches = [];
        } else {
            const compareEntities = parsed.intent === "compare" ? this.getCompareEntities(parsed) : [];
            const scopeEntities = this.getExplicitScopeEntities(parsed);
            const explicitEntityMatches = compareEntities.length ? compareEntities : this.getExactEntitiesForExplicitPhrases(parsed, entityPhrases);
            exactEntities = explicitEntityMatches.concat(scopeEntities);
            // Hard rule: if user explicitly selected tokens, DO NOT apply fuzzy matching - only show exact matches
            fuzzyEntityMatches = (compareEntities.length || parsed.hasExplicitSelections) ? [] : this.profileStep("entityMatching", () => this.matcher.matchEntities(entityPhrases, 8));
            confidentFuzzyEntityMatches = this.getConfidentEntityMatches(parsed.intent, exactEntities, fuzzyEntityMatches);
        }

        let entities = this.mergeEntities(
            exactEntities,
            confidentFuzzyEntityMatches.map((match) => match.item),
            parsed.intent === "compare" && !exactEntities.length
        );
        entities = this.filterEntityNoise(entities, metrics);
        entities = this.prioritizeEntityKinds(parsed, entities);
        entities = this.filterNearReferenceEntity(parsed, entities);
        const suggestions = (hasEntityOverride || exactEntities.length || confidentFuzzyEntityMatches.length)
            ? []
            : fuzzyEntityMatches.slice(0, 5).map((match) => match.item.label);
        const didYouMean = hasEntityOverride ? undefined : this.getDidYouMean(exactEntities, fuzzyEntityMatches);
        const answerConfidence = this.buildAnswerConfidence(
            parsed,
            semanticRewrite.changed ? semanticRewrite.reason : undefined,
            hasMetricOverride,
            hasEntityOverride,
            metricPhrases,
            initialMetricMatches,
            metrics,
            exactEntities,
            fuzzyEntityMatches,
            confidentFuzzyEntityMatches,
            entities
        );
        const respond = (response: AssistantResponse, responseSuggestions: string[] = suggestions, responseDidYouMean: string | undefined = didYouMean): AssistantResponse =>
            this.withSuggestions(response, responseSuggestions, responseDidYouMean, response.confidence || answerConfidence);

        const entityKindAmbiguityGate = !hasEntityOverride
            ? this.buildExactEntityKindAmbiguityGate(parsed, exactEntities, answerConfidence)
            : null;
        if (entityKindAmbiguityGate) return respond(entityKindAmbiguityGate, entityKindAmbiguityGate.suggestions || [], undefined);

        const entityGate = !hasEntityOverride
            ? this.buildEntityConfidenceGate(parsed, exactEntities, fuzzyEntityMatches, confidentFuzzyEntityMatches.length)
            : null;
        if (entityGate) return respond(entityGate, entityGate.suggestions || suggestions, undefined);

        if (this.isBookmarkCountQuestion(parsed)) {
            return respond(answerBookmarkCount(this.context), [], undefined);
        }

        const entityCount = this.getEntityCountRequest(parsed);
        if (entityCount) {
            const scopesForCount = this.getCountScopeEntities(parsed);
            const scopedCount = this.answerScopedEntityCount(entityCount, scopesForCount);
            if (scopedCount) return respond(scopedCount, [], undefined);
            if (entityCount.kind === "tenant" && scopesForCount.length) {
                return respond(answerList(this.context, parsed, scopesForCount), [], undefined);
            }
            const globalCount = this.answerGlobalRowBackedCount(entityCount);
            if (globalCount) return respond(globalCount, [], undefined);
            return respond(answerEntityCount(this.context, entityCount.kind, entityCount.label), [], undefined);
        }

        const fieldOnlyTenantList = this.getFieldOnlyTenantListClarification(parsed);
        if (fieldOnlyTenantList) {
            return respond(fieldOnlyTenantList, fieldOnlyTenantList.suggestions || [], undefined);
        }

        if (parsed.intent === "compare" && metrics.length > 0 && entities.length >= 2) {
            return respond(answerCompare(this.context, entities, metrics, parsed));
        }

        const chartBreakdownFields = parsed.intent === "compare" ? [] : this.getChartBreakdownFields(parsed);
        if (chartBreakdownFields.length && metrics.length > 0) {
            return respond(answerFilterFieldBreakdown(this.context, parsed, metrics[0], chartBreakdownFields), [], undefined);
        }

        if (parsed.intent === "list") {
            return respond(answerList(this.context, parsed, entities), [], undefined);
        }

        if (parsed.matrix) {
            if (!metrics.length) {
                const metricSuggestions = this.getMetricSuggestions(5);
                return respond({ handled: true, text: `I couldn't identify the matrix metric "${parsed.matrix.metricPhrase}". Which metric did you mean?`, suggestions: metricSuggestions }, metricSuggestions, undefined);
            }
            return respond(answerMatrix(this.context, parsed, metrics, entities), [], undefined);
        }
        if (parsed.intent === "matrix") {
            return respond({ handled: true, text: "I could not identify the matrix rows and columns. Try: show Sum of Area of Assigned Group as rows and Assigned Sales Category as columns." }, [], undefined);
        }

        if (parsed.averageComparison && entities.length > 0 && metrics.length > 0) {
            return respond(answerAverageComparison(this.context, entities[0], metrics[0], parsed.averageComparison.operator));
        }

        const attribute = this.getRequestedAttribute(parsed.tokens);
        if (parsed.intent === "formula") {
            return respond(answerFormula(this.context, parsed, metrics));
        }

        const exactNameClarification = !hasEntityOverride && (parsed.intent === "lookup" || parsed.intent === "summary")
            ? this.getExactNameClarification(parsed)
            : null;
        if (exactNameClarification) return respond(exactNameClarification, [], undefined);

        if (attribute && !parsed.chartType && !parsed.matrix && !metrics.length && (parsed.intent === "lookup" || parsed.intent === "summary")) {
            const entity = this.getPrimaryEntityForAttribute(entities, attribute);
            if (entity) return respond(answerAttributeLookup(this.context, entity, attribute, parsed));
        }

        const tenantSplitClarification = !hasEntityOverride && (parsed.intent === "lookup" || parsed.intent === "summary")
            ? this.getTenantSplitClarification(parsed, entities, metrics)
            : null;
        if (tenantSplitClarification) return respond(tenantSplitClarification, tenantSplitClarification.suggestions || [], undefined);

        if (!hasEntityOverride && (parsed.intent === "lookup" || parsed.intent === "summary") && this.shouldAskToClarify(exactEntities, fuzzyEntityMatches)) {
            return respond({
                handled: true,
                text: `I found multiple close matches. Which one did you mean?`,
                suggestions: fuzzyEntityMatches.slice(0, 5).map((match) => match.item.label)
            }, [], undefined);
        }

        const weakSuggestion = hasEntityOverride ? undefined : this.getWeakDidYouMean(exactEntities, fuzzyEntityMatches, confidentFuzzyEntityMatches.length);
        if (weakSuggestion && (parsed.intent === "lookup" || parsed.intent === "summary")) {
            return respond({
                handled: true,
                text: `Did you mean ${weakSuggestion}?`,
                suggestions: fuzzyEntityMatches.slice(0, 5).map((match) => match.item.label)
            }, [], undefined);
        }

        const skipCompareClarification = hasEntityOverride && exactEntities.length >= 2;
        const compareClarification = (!skipCompareClarification && parsed.intent === "compare")
            ? this.getCompareClarification(parsed, entities)
            : null;
        if (compareClarification) return respond(compareClarification, [], undefined);

        if (this.isEntityOnlyQuery(parsed, metrics, entities)) {
            return respond(this.answerEntitySelect(parsed, entities));
        }

        if ((parsed.intent === "rank" || parsed.intent === "lookup") && metrics.length === 0 && parsed.explicitMetricPhrase) {
            const metricSuggestions = this.getMetricSuggestions(5);
            return respond({
                handled: true,
                text: `I couldn't identify the metric "${parsed.explicitMetricPhrase}". Which metric did you mean?`,
                suggestions: metricSuggestions
            }, metricSuggestions, undefined);
        }

        if (parsed.crossMetric) {
            if (metrics.length < 2) {
                const metricSuggestions = this.getMetricSuggestions(5);
                return respond({ handled: true, text: `I couldn't identify both metrics "${parsed.crossMetric.firstMetricPhrase}" and "${parsed.crossMetric.secondMetricPhrase}".`, suggestions: metricSuggestions }, metricSuggestions, undefined);
            }
            return respond(answerCrossMetric(this.context, parsed, entities, metrics));
        }

        if (parsed.metricThreshold) {
            if (metrics.length === 0) {
                const metricSuggestions = this.getMetricSuggestions(5);
                return respond({ handled: true, text: `I couldn't identify the metric "${parsed.metricThreshold.metricPhrase}".`, suggestions: metricSuggestions }, metricSuggestions, undefined);
            }
            return respond(answerMetricThreshold(this.context, parsed, metrics[0], entities));
        }
        if (parsed.breakdown && metrics.length > 0) return respond(answerBreakdown(this.context, parsed, entities, metrics[0], metrics.slice(1, 4)));
        const typedFilterBreakdownFields = (parsed.intent === "lookup" || parsed.intent === "summary" || parsed.intent === "rank")
            ? this.getTypedFilterBreakdownFields(parsed)
            : [];
        if (typedFilterBreakdownFields.length && metrics.length > 0) {
            return respond(answerFilterFieldBreakdown(this.context, parsed, metrics[0], typedFilterBreakdownFields), [], undefined);
        }
        if (parsed.intent === "trend") return respond(answerTrend(this.context, parsed, entities, metrics));
        if (parsed.intent === "filter") return respond(answerFilter(this.context, parsed, entities));
        if (parsed.intent === "explain") return respond(answerExplain(this.context, parsed, entities, metrics));
        if (parsed.intent === "lookup" && metrics.length > 0 && entities.length > 1) {
            return respond(answerCompare(this.context, entities, metrics, parsed));
        }
        if (parsed.intent === "lookup" && parsed.chartType && entities.filter((entity) => entity.kind === "tenant" || entity.kind === "unit").length > 1) {
            return respond(answerCompare(this.context, entities, metrics, parsed));
        }
        if (parsed.intent === "compare") return respond(answerCompare(this.context, entities, metrics, parsed));
        if (parsed.intent === "rank") {
            const effectiveMetrics = metrics.length ? metrics : [this.getDefaultRankMetric()].filter(Boolean) as AssistantMetric[];
            if (!effectiveMetrics.length) {
                const metricSuggestions = this.getMetricSuggestions(5);
                return respond({ handled: true, text: "Which metric would you like to rank by?", suggestions: metricSuggestions }, metricSuggestions, undefined);
            }
            return respond(answerRank(this.context, parsed, entities, effectiveMetrics));
        }
        if (parsed.filters && !metrics.length) return respond(answerList(this.context, parsed, entities));
        if (parsed.intent === "summary") {
            const entity = entities[0];
            return entity ? respond(answerSummary(this.context, entity, metrics)) : answerHelp(this.context);
        }
        const primaryLookup = answerLookup(this.context, parsed, entities, metrics);
        if (primaryLookup.handled) return respond(primaryLookup);
        if (!slotAuthoritative) {
            const fallbackIntents: Array<"rank" | "list" | "summary"> = ["rank", "list", "summary"];
            for (const fallbackIntent of fallbackIntents) {
                const fallback = this.tryFallbackIntent({ ...parsed, intent: fallbackIntent }, entities, metrics);
                if (fallback && fallback.handled) return respond(fallback);
            }
        }
        const failure = this.buildContextualFailureResponse(parsed, suggestions);
        return respond(failure, failure.suggestions || suggestions, didYouMean);
    }

    answerBenchmarkFollowup(baseQuestion: string, percentile?: 90 | 75 | 50 | 25): AssistantResponse {
        const parsed = parseAssistantQuestion(baseQuestion);
        const metricPhrases = parsed.topBottom
            ? this.getTopBottomMetricPhrases(parsed)
            : parsed.matrix
            ? this.getMatrixMetricPhrases(parsed)
            : parsed.explicitMetricPhrase
            ? [parsed.explicitMetricPhrase].concat(parsed.metricPhrases)
            : parsed.metricPhrases;
        const exactQuestionMetrics = this.resolveMetricsMentionedInQuestionText(String(parsed.raw || parsed.normalized || ""), 30);
        const forcedBuiltinMetric = exactQuestionMetrics.length ? null : this.resolveBuiltinMetricFromText(String(parsed.raw || parsed.normalized || ""));
        const resolved = parsed.topBottom
            ? this.resolveMetricsInPhraseOrder(metricPhrases, 30)
            : exactQuestionMetrics.length
            ? exactQuestionMetrics
            : forcedBuiltinMetric
            ? [forcedBuiltinMetric].concat(this.matcher.matchMetrics(metricPhrases, 30).map((match) => match.item).filter((metric) => metric.key !== forcedBuiltinMetric.key))
            : this.preferBuiltinAreaMetric(parsed.tokens, parsed.normalized, this.matcher.matchMetrics(metricPhrases, 30).map((match) => match.item));
        const metrics = resolved.length ? resolved : [this.getDefaultRankMetric()].filter(Boolean) as AssistantMetric[];
        const marker = percentile ? `percentile ${percentile}` : "benchmark statistics";
        const followupParsed: ParsedAssistantQuestion = {
            ...parsed,
            raw: `${marker}: ${parsed.raw || baseQuestion}`,
            normalized: `${marker}: ${parsed.normalized || baseQuestion}`,
            intent: "rank"
        };
        const response = answerRank(this.context, followupParsed, [], metrics);
        return response || {
            handled: true,
            text: "I could not calculate benchmark statistics for the previous ranking."
        };
    }

    private getEarlyCompareClarification(parsed: ParsedAssistantQuestion): AssistantResponse | null {
        // Hard rule: if user explicitly selected tokens, skip clarification - they already confirmed their choice
        if (parsed.hasExplicitSelections) return null;
        if (this.wantsAllCompareUnits(parsed)) return null;
        const phrases = (parsed.compareEntityPhrases || []).filter(Boolean);
        for (const phrase of phrases) {
            const candidates = this.getComparePhraseCandidates(phrase);
            if (candidates.length > 1) {
                const remaining = phrases.filter((item) => item !== phrase);
                const remainingText = remaining.length ? remaining.join(" and ") : "the other selected tenant";

                // Collect tokens for ALL entities: both clarification choices AND remaining unresolved entities
                const allChoiceTokens: SelectedAssistantToken[] = candidates.map((entity): SelectedAssistantToken => ({
                    type: entity.kind as SelectedAssistantToken["type"],
                    id: entity.id,
                    label: entity.label,
                    indices: entity.indices || []
                }));

                // Also add tokens for remaining unresolved entities
                for (const remainingPhrase of remaining) {
                    const exactRemaining = this.getComparePhraseCandidates(remainingPhrase);
                    exactRemaining.forEach((entity) => {
                        const key = `${entity.kind}:${entity.id}`;
                        if (!allChoiceTokens.some((t) => `${t.type}:${t.id}` === key)) {
                            allChoiceTokens.push({
                                type: entity.kind as SelectedAssistantToken["type"],
                                id: entity.id,
                                label: entity.label,
                                indices: entity.indices || []
                            });
                        }
                    });
                }

                return {
                    handled: true,
                    text: `I found multiple matches for ${phrase}. Please select which one you want to compare with ${remainingText}.`,
                    suggestions: candidates.map((item) => item.label),
                    clarification: {
                        kind: "compare",
                        unresolvedEntityPhrase: phrase,
                        remainingEntityPhrases: remaining,
                        resolvedEntityLabels: [],
                        choices: candidates.map((item) => item.label),
                        choiceTokens: allChoiceTokens
                    }
                };
            }
        }
        return null;
    }

    private getEntityPhrasesForIntent(parsed: ParsedAssistantQuestion): string[] {
        const explicit = parsed.intent === "compare"
            ? (parsed.compareEntityPhrases || parsed.explicitEntityPhrases || [])
            : (parsed.explicitEntityPhrases || []);
        const scopePhrases = (parsed.explicitScopes || []).map((scope) => scope.phrase);
        const phrases = explicit.length ? explicit.concat(scopePhrases, parsed.entityPhrases || []) : scopePhrases.concat(parsed.entityPhrases || []);
        return Array.from(new Set(phrases.map((phrase) => String(phrase || "").trim()).filter(Boolean)));
    }

    private getExactEntitiesForExplicitPhrases(parsed: ParsedAssistantQuestion, entityPhrases: string[]): AssistantEntity[] {
        const explicit = (parsed.explicitEntityPhrases || []).map((phrase) => String(phrase || "").trim()).filter(Boolean);
        if (!explicit.length) return this.getExactEntities(parsed.normalized, entityPhrases);
        const out: AssistantEntity[] = [];
        const push = (entity: AssistantEntity) => {
            if (!out.some((item) => item.kind === entity.kind && item.id === entity.id)) out.push(entity);
        };
        const normalize = (value: string): string => String(value || "").toLowerCase().replace(/[?!.:,;()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
        explicit.forEach((phrase) => {
            const clean = normalize(phrase);
            const compact = clean.replace(/\s+/g, "");
            const primary = this.context.entities.filter((entity) => {
                const label = normalize(entity.label);
                return label === clean || label.replace(/\s+/g, "") === compact;
            });
            const matches = primary.length ? primary : this.getExactEntities(phrase, [phrase]);
            matches.forEach(push);
        });
        return out.length ? out : this.getExactEntities(parsed.normalized, entityPhrases);
    }

    private getExplicitScopeEntities(parsed: ParsedAssistantQuestion): AssistantEntity[] {
        const scopes = parsed.explicitScopes || [];
        const out: AssistantEntity[] = [];
        const push = (entity: AssistantEntity) => {
            if (!out.some((item) => item.kind === entity.kind && item.id === entity.id)) out.push(entity);
        };
        const normalize = (value: string): string => String(value || "").toLowerCase().replace(/[?!.:,;()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
        const kindRank = (kind: string): number => {
            if (kind === "group") return 0;
            if (kind === "category") return 1;
            if (kind === "filter") return 2;
            if (kind === "zone") return 3;
            if (kind === "floor") return 4;
            if (kind === "layer") return 5;
            return 9;
        };
        scopes.forEach((scope) => {
            const allowedKinds = scope.kind
                ? new Set<string>([scope.kind])
                : new Set<string>(["category", "group", "filter", "zone", "floor", "layer", "context"]);
            const phrase = String(scope.phrase || "").trim();
            if (!phrase) return;
            if (scope.kind === "category" || scope.kind === "group") {
                const rowBacked = this.rowBackedScopeEntity(scope.kind, phrase);
                if (rowBacked) {
                    push(rowBacked);
                    return;
                }
            } else if (!scope.kind) {
                const rowBacked = this.rowBackedScopeEntity("group", phrase)
                    || this.rowBackedScopeEntity("category", phrase);
                if (rowBacked) {
                    push(rowBacked);
                    return;
                }
            }
            const cleanPhrase = normalize(phrase);
            const primary = this.context.entities
                .filter((entity) => allowedKinds.has(entity.kind))
                .filter((entity) => {
                    const label = normalize(entity.label);
                    return label === cleanPhrase || label.indexOf(cleanPhrase) >= 0 || cleanPhrase.indexOf(label) >= 0;
                });
            const preferredPrimary = !scope.kind && primary.length
                ? primary.filter((entity) => entity.kind === primary.slice().sort((a, b) => kindRank(a.kind) - kindRank(b.kind))[0].kind)
                : primary;
            const exact = preferredPrimary.length
                ? preferredPrimary
                : this.getExactEntities(phrase, [phrase]).filter((entity) => allowedKinds.has(entity.kind));
            const matches = exact.length
                ? exact
                : this.matcher.matchEntities([phrase], 8)
                    .filter((match) => match.score <= 0.18 && allowedKinds.has(match.item.kind) && match.item.kind !== "filter")
                    .map((match) => match.item);
            matches.forEach(push);
        });
        this.extractInlineOrdinalScopes(parsed).forEach(push);
        return out;
    }

    private getCountScopeEntities(parsed: ParsedAssistantQuestion): AssistantEntity[] {
        const out = this.getExplicitScopeEntities(parsed).slice();
        const push = (entity: AssistantEntity) => {
            if (!out.some((item) => item.kind === entity.kind && item.id === entity.id)) out.push(entity);
        };
        (parsed.filters?.includeFilters || []).forEach((filter) => {
            const phrase = String(filter.phrase || "").trim();
            const indices = Array.from(new Set((filter.matchedIndices || [])
                .map(Number)
                .filter((idx) => Number.isFinite(idx) && idx >= 0)));
            if (!phrase || !indices.length) return;
            const kind = filter.type === "unit"
                || filter.type === "group"
                || filter.type === "tenant"
                || filter.type === "category"
                || filter.type === "zone"
                || filter.type === "layer"
                || filter.type === "floor"
                ? filter.type
                : "filter";
            push({
                id: `filter-scope:${kind}:${this.normalizeScopeValue(phrase) || phrase.toLowerCase()}`,
                kind,
                label: phrase,
                aliases: [phrase],
                indices
            });
        });
        return out;
    }

    private extractInlineOrdinalScopes(parsed: ParsedAssistantQuestion): AssistantEntity[] {
        const q = String(parsed.raw || parsed.normalized || "").toLowerCase();
        if (!/\b(zone|layer)s?\s*\d/.test(q)) return [];
        const expanded = q
            .replace(/\b(zone|layer)s?\s+((?:\d+\s*(?:,|and)?\s*){1,12})/g, (_m, kind, nums) => {
                const singular = /^layer/i.test(String(kind)) ? "layer" : "zone";
                return String(nums || "").replace(/\d+/g, (n) => ` ${singular} ${n} `);
            })
            .replace(/\b(zone|layer)\s*(\d+)/g, "$1 $2");
        const wanted = new Set<string>();
        Array.from(expanded.matchAll(/\b(zone|layer)\s*(\d+)\b/g)).forEach((match) => {
            const kind = String(match[1] || "").toLowerCase();
            const n = Number(match[2]);
            if (Number.isFinite(n)) wanted.add(`${kind} ${n}`);
        });
        if (!wanted.size) return [];
        return (this.context.entities || [])
            .filter((entity) => entity.kind === "zone" || entity.kind === "layer")
            .filter((entity) => {
                const labels = [entity.label].concat(entity.aliases || [])
                    .map((label) => String(label || "").toLowerCase().replace(/\s+/g, " ").trim());
                return labels.some((label) => wanted.has(label));
            });
    }

    private getCompareEntities(parsed: ParsedAssistantQuestion): AssistantEntity[] {
        const phrases = Array.from(new Set((parsed.compareEntityPhrases || [])
            .map((phrase) => String(phrase || "").trim())
            .filter(Boolean)));
        if (phrases.length < 2) return [];
        const out: AssistantEntity[] = [];
        const pushUnique = (entity: AssistantEntity) => {
            if (!out.some((item) => item.kind === entity.kind && item.id === entity.id)) out.push(entity);
        };
        const phrasePosition = (entity: AssistantEntity, phrase: string): number => {
            const haystack = String(phrase || "").toLowerCase().replace(/[?!.:,;()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
            const compactHaystack = haystack.replace(/\s+/g, "");
            const labels = [entity.label].concat(entity.aliases || []);
            let best = Number.POSITIVE_INFINITY;
            labels.forEach((label) => {
                const clean = String(label || "").toLowerCase().replace(/[?!.:,;()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
                if (!clean) return;
                const direct = haystack.indexOf(clean);
                if (direct >= 0) best = Math.min(best, direct);
                const compact = clean.replace(/\s+/g, "");
                const compactPos = compact.length >= 2 ? compactHaystack.indexOf(compact) : -1;
                if (compactPos >= 0) best = Math.min(best, compactPos);
            });
            return Number.isFinite(best) ? best : Number.MAX_SAFE_INTEGER;
        };
        const phraseExactlyMatches = (entity: AssistantEntity, phrase: string): boolean => {
            const haystack = String(phrase || "").toLowerCase().replace(/[?!.:,;()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
            const compactHaystack = haystack.replace(/\s+/g, "");
            return [entity.label].concat(entity.aliases || []).some((label) => {
                const clean = String(label || "").toLowerCase().replace(/[?!.:,;()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
                const compact = clean.replace(/\s+/g, "");
                return clean === haystack || compact === compactHaystack;
            });
        };
        const exactComparePhraseEntities = (phrase: string): AssistantEntity[] => {
            const cleanPhrase = String(phrase || "").toLowerCase().replace(/[?!.:,;()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
            const compactPhrase = cleanPhrase.replace(/\s+/g, "");
            if (!cleanPhrase) return [];
            const primaryLabelMatches = this.context.entities.filter((entity) => {
                if (entity.kind !== "tenant" && entity.kind !== "unit") return false;
                const label = String(entity.label || "").toLowerCase().replace(/[?!.:,;()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
                return label === cleanPhrase || label.replace(/\s+/g, "") === compactPhrase;
            });
            if (primaryLabelMatches.length === 1) return primaryLabelMatches;
            return this.context.entities
                .filter((entity) => entity.kind === "tenant" || entity.kind === "unit")
                .filter((entity) => phraseExactlyMatches(entity, phrase));
        };
        phrases.forEach((phrase) => {
            const unitChoice = this.getExactUnitChoiceForPhrase(phrase);
            if (unitChoice) {
                pushUnique(unitChoice);
                return;
            }
            const exact = this.prioritizeEntityKinds(parsed, parsed.hasExplicitSelections
                ? exactComparePhraseEntities(phrase)
                : this.getExactEntities(phrase, [phrase]));
            const exactSubjects = exact
                .filter((entity) => entity.kind === "tenant" || entity.kind === "unit")
                .sort((a, b) => phrasePosition(a, phrase) - phrasePosition(b, phrase));
            if (exactSubjects.length > 1) {
                const pq = phrase.toLowerCase().replace(/[?!.:,;()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
                const primaryLabelOnly = exactSubjects.filter((entity) => {
                    const lbl = String(entity.label || "").toLowerCase().replace(/[?!.:,;()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
                    return lbl === pq || lbl.replace(/\s+/g, "") === pq.replace(/\s+/g, "");
                });
                if (primaryLabelOnly.length === 1) {
                    pushUnique(primaryLabelOnly[0]);
                    return;
                }
                const tenantExact = exactSubjects.filter((entity) => entity.kind === "tenant" && phraseExactlyMatches(entity, phrase));
                const filteredSubjects = tenantExact.length
                    ? tenantExact
                    : exactSubjects.filter((entity) => {
                        if (entity.kind !== "unit") return true;
                        return !exactSubjects.some((tenant) => tenant.kind === "tenant" && phrasePosition(tenant, phrase) === phrasePosition(entity, phrase));
                    });
                filteredSubjects.forEach(pushUnique);
                return;
            }
            const exactPick = exact.find((entity) => entity.kind === "tenant" || entity.kind === "unit") || exact[0];
            if (exactPick) {
                pushUnique(exactPick);
                return;
            }
            // Hard rule: if user explicitly selected, do NOT apply fuzzy matching
            if (parsed.hasExplicitSelections) {
                return;
            }
            const fuzzy = this.matcher.matchEntities([phrase], 3)
                .filter((match) => match.score <= 0.24)
                .map((match) => match.item);
            const fuzzyPick = this.prioritizeEntityKinds(parsed, fuzzy)[0];
            if (fuzzyPick) pushUnique(fuzzyPick);
        });
        return out;
    }

    private getExactUnitChoiceForPhrase(phrase: string): AssistantEntity | null {
        const q = String(phrase || "").toLowerCase().replace(/[?!.:,;()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
        if (!q) return null;
        const compactQ = q.replace(/\s+/g, "");
        const exactTenant = this.context.entities.some((entity) => {
            if (entity.kind !== "tenant") return false;
            return [entity.label].concat(entity.aliases || []).some((label) => {
                const clean = String(label || "").toLowerCase().replace(/[?!.:,;()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
                const compact = clean.replace(/\s+/g, "");
                return clean === q || compact === compactQ;
            });
        });
        if (exactTenant) return null;
        for (const entity of this.context.entities) {
            if (entity.kind !== "tenant") continue;
            const choices = this.unitChoicesForEntity(entity);
            for (const choice of choices) {
                const labels = [choice.label].concat(choice.aliases || []);
                const matched = labels.some((label) => {
                    const clean = String(label || "").toLowerCase().replace(/[?!.:,;()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
                    const compact = clean.replace(/\s+/g, "");
                    return clean === q || compact === compactQ;
                });
                if (matched) return choice;
            }
        }
        return null;
    }

    private wantsAllCompareUnits(parsed: ParsedAssistantQuestion): boolean {
        const set = new Set((parsed.tokens || []).map((token) => String(token || "").toLowerCase()));
        const normalized = String(parsed.normalized || "").toLowerCase();
        const phrases = (parsed.compareEntityPhrases || []).join(" ").toLowerCase();
        return set.has("all")
            || set.has("both")
            || set.has("each")
            || set.has("every")
            || set.has("total")
            || set.has("combined")
            || set.has("overall")
            || /\b(?:total|combined|overall)\b/.test(normalized)
            || /\b(?:total|combined|overall)\b/.test(phrases)
            || /\bcompare\s+(?:all|both|each|every|total|combined|overall)\b/i.test(parsed.normalized || "")
            || /\b(?:all|total|combined|overall)\s+(?:branches|shops|units|stores)\b/i.test(parsed.normalized || "");
    }

    private unitChoicesForEntity(entity: AssistantEntity): AssistantEntity[] {
        if (!entity || entity.kind !== "tenant") return [];
        const byUnit = new Map<string, number[]>();
        (entity.indices || []).forEach((idx) => {
            const row = this.context.rows[idx];
            if (!row) return;
            const key = row.combinedUnit || row.unitId || row.shapeKey || `row-${idx}`;
            if (!byUnit.has(key)) byUnit.set(key, []);
            byUnit.get(key)!.push(idx);
        });
        if (byUnit.size <= 1) return [];
        return Array.from(byUnit.entries()).map(([key, indices], index) => {
            const first = this.context.rows[indices[0]];
            const unit = first?.unitId || first?.shapeKey || key || String(index + 1);
            const floor = (first?.floors || []).filter(Boolean)[0] || "";
            const area = indices.reduce((sum, idx) => {
                const value = Number(this.context.rows[idx]?.area);
                return Number.isFinite(value) ? sum + value : sum;
            }, 0);
            const areaText = area > 0 ? `${this.context.formatNumber(area, { maximumFractionDigits: 0 })} sqm` : "";
            const category = String(first?.category || "").trim();
            const detailBits = [unit, floor, category].filter(Boolean);
            const label = detailBits.length ? `${entity.label} (${detailBits.join(", ")})` : entity.label;
            const aliases = [
                label,
                entity.label,
                unit,
                floor,
                category,
                areaText,
                first?.combinedUnit || "",
                first?.shapeKey || "",
                [entity.label, category].filter(Boolean).join(" "),
                [entity.label, unit].filter(Boolean).join(" "),
                [entity.label, floor].filter(Boolean).join(" "),
                [entity.label, category, unit].filter(Boolean).join(" "),
                [entity.label, floor, unit].filter(Boolean).join(" ")
            ].filter(Boolean);
            return {
                id: `${entity.id}:unit:${key || index}`,
                kind: "unit",
                label,
                aliases: Array.from(new Set(aliases)),
                indices
            } as AssistantEntity;
        });
    }

    private autocompleteEntityLabel(entity: AssistantEntity): string {
        if (!entity || entity.kind !== "tenant") return entity?.label || "";
        return entity.label;
    }

    private autocompleteEntityDetail(entity: AssistantEntity): string {
        if (!entity || (entity.kind !== "tenant" && entity.kind !== "unit")) return "";
        const first = (entity.indices || []).map((idx) => this.context.rows[idx]).filter(Boolean)[0];
        const unit = first?.unitId || first?.shapeKey || "";
        const floor = (first?.floors || []).filter(Boolean)[0] || "";
        return [floor, unit].filter(Boolean).join(" · ");
    }

    private entityMatchesPhrase(entity: AssistantEntity, phrase: string): boolean {
        const q = String(phrase || "").toLowerCase().replace(/\s+/g, " ").trim();
        const compactQ = q.replace(/\s+/g, "");
        const sortedQ = this.sortedPhraseKey(q);
        const sortedCompactQ = this.sortedCompactPhraseKey(q);
        if (!q) return false;
        return [entity.label].concat(entity.aliases || []).some((label) => {
            const clean = String(label || "").toLowerCase().replace(/\s+/g, " ").trim();
            const compact = clean.replace(/\s+/g, "");
            const sorted = this.sortedPhraseKey(clean);
            const sortedCompact = this.sortedCompactPhraseKey(clean);
            return clean === q || compact === compactQ || sorted === sortedQ || sortedCompact === sortedCompactQ || clean.indexOf(q) >= 0 || q.indexOf(clean) >= 0;
        });
    }

    private normalizeCompareToken(value: string): string {
        const token = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
        if (!token) return "";
        if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
        if (token.endsWith("es") && token.length > 4) return token.slice(0, -2);
        if (token.endsWith("s") && token.length > 3) return token.slice(0, -1);
        return token;
    }

    private strongEntityMatchesPhrase(entity: AssistantEntity, phrase: string): boolean {
        const normalize = (value: string): string => String(value || "")
            .toLowerCase()
            .replace(/[?!.:,;()[\]{}]/g, " ")
            .replace(/&/g, " and ")
            .replace(/\s+/g, " ")
            .trim();
        const collapse = (value: string): string => normalize(value).replace(/\band\b/g, " ").replace(/\s+/g, " ").trim();
        const tokenList = (value: string): string[] => collapse(value)
            .split(/\s+/g)
            .map((token) => this.normalizeCompareToken(token))
            .filter(Boolean);

        const q = normalize(phrase);
        const qCollapsed = collapse(phrase);
        const qTokens = tokenList(phrase);
        if (!qTokens.length) return false;

        return [entity.label].concat(entity.aliases || []).some((label) => {
            const clean = normalize(label);
            const collapsed = collapse(label);
            const tokens = tokenList(label);
            if (!clean || !tokens.length) return false;
            if (clean === q || collapsed === qCollapsed) return true;
            if (qTokens.length === 1) {
                const token = qTokens[0];
                return tokens[0] === token || tokens.includes(token);
            }
            return qTokens.every((token) => tokens.includes(token));
        });
    }

    private getExactNameClarification(parsed: ParsedAssistantQuestion): AssistantResponse | null {
        const phrases = this.lookupSubjectPhrases(parsed);
        for (const phrase of phrases) {
            const candidates = this.exactNameClarificationCandidates(phrase);
            if (candidates.length < 2) continue;
            return {
                handled: true,
                text: `Which ${phrase} did you mean?`,
                suggestions: candidates.slice(0, 6).map((entity) => this.entityClarificationLabel(entity)),
                clarification: {
                    kind: "entity",
                    originalQuestion: parsed.raw || parsed.normalized,
                    originalEngineQuestion: parsed.raw || parsed.normalized,
                    unresolvedEntityPhrase: phrase,
                    remainingEntityPhrases: [],
                    choices: candidates.slice(0, 6).map((entity) => this.entityClarificationLabel(entity)),
                    choiceTokens: candidates.slice(0, 6).map((entity): SelectedAssistantToken => ({
                        type: entity.kind as SelectedAssistantToken["type"],
                        id: entity.id,
                        label: this.entityClarificationLabel(entity),
                        indices: entity.indices || []
                    }))
                }
            };
        }
        return null;
    }

    private lookupSubjectPhrases(parsed: ParsedAssistantQuestion): string[] {
        const explicit = (parsed.explicitEntityPhrases || [])
            .map((phrase) => String(phrase || "").trim())
            .filter(Boolean);
        const source = explicit.length ? explicit : (parsed.entityPhrases || []);
        const metricWords = new Set(["area", "sqm", "m2", "size", "rent", "sales", "revenue", "turnover", "ocr", "occupancy", "vacancy", "vacant", "units", "unit"]);
        return Array.from(new Set(source
            .map((phrase) => String(phrase || "").toLowerCase().replace(/[?!.:,;()[\]{}]/g, " ").replace(/\s+/g, " ").trim())
            .filter((phrase) => phrase.length >= 3)
            .filter((phrase) => !metricWords.has(phrase))
            .filter((phrase) => !/^(what|which|who|show|tell|find|give|please|for|of|by|in|on|at|the|tenant|tenants|brand|brands)$/.test(phrase))));
    }

    private exactNameClarificationCandidates(phrase: string): AssistantEntity[] {
        const cleanPhrase = String(phrase || "").toLowerCase().replace(/[?!.:,;()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
        if (!cleanPhrase || cleanPhrase.length < 3) return [];
        const compactPhrase = cleanPhrase.replace(/\s+/g, "");
        const scored: Array<{ entity: AssistantEntity; rank: number; label: string }> = [];
        (this.context.entities || []).forEach((entity) => {
            if (entity.kind !== "tenant" && entity.kind !== "unit") return;
            const labels = [entity.label].concat(entity.aliases || []);
            let bestRank: number | null = null;
            labels.forEach((label) => {
                const clean = String(label || "").toLowerCase().replace(/[?!.:,;()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
                if (!clean) return;
                const compact = clean.replace(/\s+/g, "");
                let rank: number | null = null;
                if (clean === cleanPhrase || compact === compactPhrase) rank = 0;
                else if (clean.startsWith(`${cleanPhrase} `) || compact.startsWith(compactPhrase)) rank = 1;
                if (rank === null) return;
                if (bestRank === null || rank < bestRank) bestRank = rank;
            });
            if (bestRank !== null) scored.push({ entity, rank: bestRank, label: entity.label });
        });
        if (scored.length < 2) return [];
        const hasPrimaryExact = scored.some((item) => item.rank === 0 && this.entityPrimaryLabelEquals(item.entity, cleanPhrase));
        const allowed = scored
            .filter((item) => item.rank <= (hasPrimaryExact ? 1 : 0))
            .sort((a, b) => {
                const primaryDelta = Number(!this.entityPrimaryLabelEquals(a.entity, cleanPhrase)) - Number(!this.entityPrimaryLabelEquals(b.entity, cleanPhrase));
                if (primaryDelta) return primaryDelta;
                const kindDelta = (a.entity.kind === "tenant" ? 0 : 1) - (b.entity.kind === "tenant" ? 0 : 1);
                return kindDelta || a.rank - b.rank || a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true });
            });
        const unique = new Map<string, AssistantEntity>();
        allowed.forEach((item) => {
            const key = `${item.entity.kind}:${item.entity.id}`;
            if (!unique.has(key)) unique.set(key, item.entity);
        });
        return Array.from(unique.values());
    }

    private entityClarificationLabel(entity: AssistantEntity): string {
        if (!entity) return "";
        const first = (entity.indices || []).map((idx) => this.context.rows[idx]).filter(Boolean)[0];
        if (!first) return entity.label;
        if (entity.kind === "unit") {
            const unit = first.unitId || first.combinedUnit || first.shapeKey || "";
            const floor = (first.floors || []).filter(Boolean)[0] || "";
            return [entity.label, unit, floor].filter(Boolean).join(" ");
        }
        if (entity.kind === "tenant") {
            const units = Array.from(new Set((entity.indices || [])
                .map((idx) => this.context.rows[idx])
                .filter(Boolean)
                .map((row) => row.unitId || row.combinedUnit || row.shapeKey || "")
                .filter(Boolean)));
            if (units.length === 1) return `${entity.label} ${units[0]}`;
            if (units.length > 1) return `${entity.label} total`;
        }
        return entity.label;
    }

    private entityPrimaryLabelEquals(entity: AssistantEntity, phrase: string): boolean {
        const label = String(entity.label || "").toLowerCase().replace(/[?!.:,;()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
        const compactLabel = label.replace(/\s+/g, "");
        const clean = String(phrase || "").toLowerCase().replace(/[?!.:,;()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
        const compact = clean.replace(/\s+/g, "");
        return !!label && (label === clean || compactLabel === compact);
    }

    private getTenantSplitClarification(
        parsed: ParsedAssistantQuestion,
        entities: AssistantEntity[],
        metrics: AssistantMetric[]
    ): AssistantResponse | null {
        if (!entities.length || !metrics.length) return null;
        if (entities.length !== 1) return null;
        if (this.wantsTenantTotal(parsed) || this.wantsTenantUnitSplit(parsed)) return null;
        const entity = entities.find((item) => item.kind === "tenant");
        if (!entity) return null;
        const choices = this.unitChoicesForEntity(entity);
        if (choices.length < 2) return null;
        const metric = metrics[0];
        const metricName = metric?.name || parsed.explicitMetricPhrase || "metric";
        return {
            handled: true,
            text: `${entity.label} has ${choices.length} units. Do you want ${entity.label} total ${metricName}, or a unit-level split?`,
            suggestions: [
                `total ${metricName} of ${entity.label}`,
                `show all units for ${entity.label}`,
                `${metricName} by unit for ${entity.label}`
            ]
        };
    }

    private wantsTenantTotal(parsed: ParsedAssistantQuestion): boolean {
        const text = String(parsed.normalized || parsed.raw || "").toLowerCase();
        const tokens = new Set((parsed.tokens || []).map((token) => String(token || "").toLowerCase()));
        return tokens.has("total")
            || tokens.has("sum")
            || tokens.has("overall")
            || tokens.has("combined")
            || /\b(?:total|overall|combined|aggregate|aggregated)\b/i.test(text);
    }

    private wantsTenantUnitSplit(parsed: ParsedAssistantQuestion): boolean {
        const text = String(parsed.normalized || parsed.raw || "").toLowerCase();
        const tokens = new Set((parsed.tokens || []).map((token) => String(token || "").toLowerCase()));
        return tokens.has("all")
            || tokens.has("both")
            || tokens.has("each")
            || tokens.has("every")
            || tokens.has("list")
            || tokens.has("table")
            || /\b(?:unit\s*level|unit\s+split|split\s+by\s+unit|by\s+unit|each\s+unit|all\s+units|unit\s+wise|unitwise)\b/i.test(text);
    }

    private sortedPhraseKey(value: string): string {
        return String(value || "").toLowerCase().replace(/[?!.:,;()[\]{}]/g, " ").replace(/\s+/g, " ").trim()
            .split(/\s+/g).filter(Boolean).sort().join(" ");
    }

    private sortedCompactPhraseKey(value: string): string {
        return String(value || "").toLowerCase().replace(/[?!.:,;()[\]{}]/g, " ").replace(/&/g, " ").replace(/\band\b/g, " ").replace(/\s+/g, " ").trim()
            .split(/\s+/g).filter(Boolean).sort().join(" ");
    }

    private phraseExactlyMatchesEntity(entity: AssistantEntity, phrase: string): boolean {
        const haystack = String(phrase || "").toLowerCase().replace(/[?!.:,;()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
        const compactHaystack = haystack.replace(/\s+/g, "");
        if (!haystack) return false;
        return [entity.label].concat(entity.aliases || []).some((label) => {
            const clean = String(label || "").toLowerCase().replace(/[?!.:,;()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
            const compact = clean.replace(/\s+/g, "");
            return clean === haystack || compact === compactHaystack;
        });
    }

    private getCompareClarification(parsed: ParsedAssistantQuestion, entities: AssistantEntity[]): AssistantResponse | null {
        // Hard rule: if user explicitly selected tokens, skip clarification - they already confirmed their choice
        if (parsed.hasExplicitSelections) return null;
        if (this.wantsAllCompareUnits(parsed)) return null;
        const phrases = (parsed.compareEntityPhrases || []).filter(Boolean);
        for (const phrase of phrases) {
            const candidates = this.getComparePhraseCandidates(phrase);
            if (candidates.length > 1) {
                const remaining = phrases.filter((item) => item !== phrase);
                const remainingText = remaining.length ? remaining.join(" and ") : "the other selected tenant";
                return {
                    handled: true,
                    text: `I found multiple matches for ${phrase}. Please select which one you want to compare with ${remainingText}.`,
                    suggestions: candidates.map((item) => item.label),
                    clarification: {
                        kind: "compare",
                        unresolvedEntityPhrase: phrase,
                        remainingEntityPhrases: remaining,
                        resolvedEntityLabels: entities
                            .filter((item) => !this.entityMatchesPhrase(item, phrase))
                            .map((item) => item.label),
                        choices: candidates.map((item) => item.label),
                        choiceTokens: candidates.map((item): SelectedAssistantToken => ({
                            type: item.kind === "unit" ? "unit" : item.kind === "group" ? "group" : item.kind === "category" ? "category" : item.kind === "zone" ? "zone" : item.kind === "floor" ? "floor" : item.kind === "layer" ? "layer" : "tenant",
                            id: item.id,
                            label: item.label,
                            indices: item.indices || []
                        }))
                    }
                };
            }
        }
        for (const entity of entities || []) {
            const choices = this.unitChoicesForEntity(entity);
            if (choices.length < 2 || choices.length > 6) continue;
            const labels = choices.map((choice) => choice.label);
            const unresolved = phrases.find((phrase) => this.entityMatchesPhrase(entity, phrase)) || entity.label;
            const remaining = phrases.filter((phrase) => phrase !== unresolved);
            const remainingText = remaining.length ? remaining.join(" and ") : "the other selected tenant";
            return {
                handled: true,
                text: `I found ${choices.length} ${entity.label} units. Please select which ${entity.label} unit to compare with ${remainingText}.`,
                suggestions: labels,
                    clarification: {
                        kind: "compare",
                        unresolvedEntityPhrase: unresolved,
                        remainingEntityPhrases: remaining,
                        resolvedEntityLabels: entities.filter((item) => item.id !== entity.id || item.kind !== entity.kind).map((item) => item.label),
                        choices: labels,
                        choiceTokens: choices.map((choice): SelectedAssistantToken => ({
                            type: choice.kind === "unit" ? "unit" : "tenant",
                            id: choice.id,
                            label: choice.label,
                            indices: choice.indices || []
                        }))
                    }
                };
            }
        return null;
    }

    private getComparePhraseCandidates(phrase: string): AssistantEntity[] {
        const clean = String(phrase || "").trim();
        if (!clean) return [];
        const normalizeLabel = (value: string): string =>
            String(value || "").toLowerCase().replace(/[?!.:,;()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
        const q = normalizeLabel(clean);
        const compactQ = q.replace(/\s+/g, "");
        // If exactly one entity's PRIMARY LABEL matches, return it immediately —
        // prevents alias conflicts (e.g. "Zara" is an alias of "Zara Home").
        const primaryLabelMatches = this.context.entities.filter((entity) => {
            if (entity.kind !== "tenant") return false;
            const label = normalizeLabel(entity.label);
            return label === q || label.replace(/\s+/g, "") === compactQ;
        });
        if (primaryLabelMatches.length === 1) return primaryLabelMatches;
        const exactPhraseMatches = this.context.entities
            .filter((entity) => entity.kind === "tenant")
            .filter((entity) => this.phraseExactlyMatchesEntity(entity, clean));
        if (exactPhraseMatches.length) {
            const unique = new Map<string, AssistantEntity>();
            exactPhraseMatches.forEach((entity) => {
                const key = `${entity.kind}:${entity.id}`;
                if (!unique.has(key)) unique.set(key, entity);
            });
            return Array.from(unique.values()).slice(0, 6);
        }
        const exact = this.getExactEntities(clean, [clean])
            .filter((entity) => entity.kind === "tenant")
            .filter((entity) => this.strongEntityMatchesPhrase(entity, clean));
        const matched = exact.length
            ? exact
            : this.context.entities
                .filter((entity) => entity.kind === "tenant")
                .filter((entity) => this.strongEntityMatchesPhrase(entity, clean));
        if (matched.length <= 1) return matched;
        const pool = exact.length > 1
            ? matched
            : (() => {
                const visible = matched.filter((entity) => (entity.indices || []).some((idx) => this.context.rows[idx]?.visibleOnMap));
                return visible.length > 0 ? visible : matched;
            })();
        const unique = new Map<string, AssistantEntity>();
        pool.forEach((entity) => {
            const key = `${entity.kind}:${entity.id}`;
            if (!unique.has(key)) unique.set(key, entity);
        });
        return Array.from(unique.values()).slice(0, 6);
    }

    private prioritizeEntityKinds(parsed: ParsedAssistantQuestion, entities: AssistantEntity[]): AssistantEntity[] {
        if (!entities.length) return entities;
        const hasTenantOrUnit = entities.some((entity) => entity.kind === "tenant" || entity.kind === "unit");
        const explicitCategory =
            parsed.tokens.indexOf("category") >= 0 ||
            parsed.tokens.indexOf("group") >= 0 ||
            parsed.tokens.indexOf("zone") >= 0 ||
            parsed.tokens.indexOf("floor") >= 0 ||
            parsed.tokens.indexOf("layer") >= 0;
        if ((parsed.intent === "compare" || parsed.intent === "lookup" || parsed.intent === "summary") && hasTenantOrUnit && !explicitCategory) {
            return entities.filter((entity) => entity.kind === "tenant" || entity.kind === "unit");
        }
        return entities;
    }

    private filterNearReferenceEntity(parsed: ParsedAssistantQuestion, entities: AssistantEntity[]): AssistantEntity[] {
        const near = String(parsed.filters?.nearPhrase || "").toLowerCase().trim();
        if (!near || !entities.length) return entities;
        const compactNear = near.replace(/\s+/g, "");
        const filtered = entities.filter((entity) => {
            const labels = [entity.label].concat(entity.aliases || []);
            return !labels.some((label) => {
                const clean = String(label || "").toLowerCase().trim();
                const compact = clean.replace(/\s+/g, "");
                return clean === near || compact === compactNear || clean.indexOf(near) >= 0 || near.indexOf(clean) >= 0;
            });
        });
        return filtered.length ? filtered : entities;
    }

    private filterEntityNoise(entities: AssistantEntity[], metrics: AssistantMetric[]): AssistantEntity[] {
        const metricNames = new Set<string>();
        metrics.forEach((metric) => {
            metricNames.add(String(metric.name || "").toLowerCase());
            (metric.aliases || []).forEach((alias) => metricNames.add(String(alias || "").toLowerCase()));
        });
        return entities.filter((entity) => {
            const label = String(entity.label || "").toLowerCase();
            return !metricNames.has(label);
        });
    }

    private preferBuiltinAreaMetric(tokens: string[], normalizedQuestion: string, metrics: AssistantMetric[]): AssistantMetric[] {
        const exactDynamicArea = this.findExactQuestionAreaMetric(normalizedQuestion, metrics.concat(this.context.metrics || []));
        if (exactDynamicArea) {
            return [exactDynamicArea].concat(metrics.filter((metric) => metric.key !== exactDynamicArea.key));
        }
        const tokenSet = new Set((tokens || []).map((token) => String(token || "").toLowerCase()));
        const asksPlainArea = tokenSet.has("area") || tokenSet.has("sqm") || tokenSet.has("m2") || /\bsq\.?m\b/i.test(normalizedQuestion || "");
        if (!metrics.length && !asksPlainArea) return metrics;
        if (!asksPlainArea) return metrics;
        const asksAggregatedArea = /\b(?:sum|total)\s+of\s+(?:area|sqm|sq\s*m|m2|size)\b/i.test(normalizedQuestion || "");
        const builtin = this.context.metrics.find((metric) => metric.key === "__builtin::area");
        const asksVariance = /\b(?:variance|var|floor\s+area\s+variance|area\s+variance)\b/i.test(normalizedQuestion || "");
        const dynamicArea = this.findDynamicAreaMetric(metrics.concat(this.context.metrics || []));
        if (asksAggregatedArea && dynamicArea && !asksVariance) {
            return [dynamicArea].concat(metrics.filter((metric) => metric.key !== dynamicArea.key));
        }
        if (asksAggregatedArea && builtin && !asksVariance) {
            return [builtin].concat(metrics.filter((metric) => metric.key !== builtin.key));
        }
        const asksSpecificAreaField = /\b(?:floor|fi|fl|external|seating)\s+(?:area|sqm|sq\s*m|m2|size)\b|\b(?:area|sqm|sq\s*m|m2|size)\s+(?:floor|fi|fl|external|seating)\b|\bvariance\b|\bva\b/i.test(normalizedQuestion || "");
        if (!asksAggregatedArea && !asksSpecificAreaField && builtin) {
            return [builtin].concat(metrics.filter((metric) => metric.key !== "__builtin::area"));
        }
        if (asksAggregatedArea) {
            if (builtin && !asksSpecificAreaField) {
                return [builtin].concat(metrics.filter((metric) => metric.key !== builtin.key));
            }
            return metrics;
        }
        if (asksSpecificAreaField) {
            const specificArea = this.findSpecificAreaMetric(normalizedQuestion, metrics);
            if (specificArea) return [specificArea].concat(metrics.filter((metric) => metric.key !== specificArea.key));
            return metrics;
        }
        if (!builtin) return metrics;
        return [builtin].concat(metrics.filter((metric) => metric.key !== "__builtin::area"));
    }

    private findExactQuestionAreaMetric(normalizedQuestion: string, metrics: AssistantMetric[]): AssistantMetric | null {
        const question = this.normalizeOverrideText(normalizedQuestion || "");
        if (!question) return null;
        const seen = new Set<string>();
        const candidates = (metrics || [])
            .filter((metric) => {
                const key = String(metric?.key || "");
                if (!key || seen.has(key)) return false;
                seen.add(key);
                return metric.kind === "dynamic";
            });
        const exactLabels = ["sum of area", "total area"];
        for (const exact of exactLabels) {
            if (question.indexOf(exact) < 0) continue;
            const match = candidates.find((metric) => {
                const labels = [metric.name].concat(metric.aliases || []);
                return labels.some((label) => this.normalizeOverrideText(label) === exact);
            });
            if (match) return match;
        }
        return null;
    }

    private findDynamicAreaMetric(metrics: AssistantMetric[]): AssistantMetric | null {
        const candidates = (metrics || []).filter((metric) => metric.kind === "dynamic");
        const cleanLabel = (metric: AssistantMetric): string =>
            [metric.name].concat(metric.aliases || []).join(" ").toLowerCase().replace(/[_./-]+/g, " ").replace(/\s+/g, " ").trim();
        const isBadArea = (label: string): boolean =>
            /\b(?:floor|variance|delta|erv|sales|rent|revenue|turnover|ocr|occupancy|percent|percentage|ratio|rate|per)\b/.test(label)
            || /\/\s*(?:sqm|sq\s*m|m2|area)\b/.test(label);
        const exactSum = candidates.find((metric) => {
            const labels = [metric.name].concat(metric.aliases || []);
            return labels.some((label) => {
                const clean = String(label || "").toLowerCase().replace(/[_./-]+/g, " ").replace(/\s+/g, " ").trim();
                return clean === "sum of area" || clean === "total area";
            }) && !isBadArea(cleanLabel(metric));
        });
        if (exactSum) return exactSum;
        const exact = candidates.find((metric) => {
            const labels = [metric.name].concat(metric.aliases || []);
            return labels.some((label) => {
                const clean = String(label || "").toLowerCase().replace(/[_./-]+/g, " ").replace(/\s+/g, " ").trim();
                return clean === "area";
            }) && !isBadArea(cleanLabel(metric));
        });
        if (exact) return exact;
        return candidates.find((metric) => {
            const label = cleanLabel(metric);
            return /\b(?:sum\s+of\s+)?area\b/.test(label) && !isBadArea(label);
        }) || null;
    }

    private findSpecificAreaMetric(normalizedQuestion: string, metrics: AssistantMetric[]): AssistantMetric | null {
        const question = String(normalizedQuestion || "").toLowerCase();
        const wantsFloorArea = /\b(?:fl|fi|floor)\s+area\b|\barea\s+(?:fl|fi|floor)\b/.test(question);
        if (!wantsFloorArea) return null;
        const candidates = metrics.concat(this.context.metrics || []);
        const seen = new Set<string>();
        for (const metric of candidates) {
            const key = String(metric.key || "");
            if (!key || seen.has(key)) continue;
            seen.add(key);
            const labels = [metric.name].concat(metric.aliases || []).join(" ").toLowerCase();
            if (/\b(?:fl|fi|floor)\s*area\b|\b(?:fl|fi|floor)area\b/.test(labels)) return metric;
        }
        return null;
    }

    private getRequestedAttribute(tokens: string[]): "group" | "category" | "unit" | "tenant" | "floor" | null {
        const set = new Set(tokens.map((token) => String(token || "").toLowerCase()));
        if (set.has("group") || set.has("groups")) return "group";
        if (
            set.has("category") ||
            set.has("categories") ||
            set.has("cat") ||
            set.has("catogery") ||
            set.has("catogory") ||
            set.has("catagory") ||
            set.has("categery") ||
            set.has("salescategory") ||
            (set.has("sales") && (set.has("category") || set.has("catogery") || set.has("catagory")))
        ) return "category";
        if (set.has("unit") || set.has("units") || set.has("unitid")) return "unit";
        if (set.has("tenant") || set.has("tenants") || set.has("brand")) return "tenant";
        if (set.has("floor") || set.has("floors") || set.has("level")) return "floor";
        return null;
    }

    private getEarlyFilterFieldBreakdown(parsed: ParsedAssistantQuestion, baseConfidence: AssistantConfidence): AssistantResponse | null {
        if (parsed.matrix) return null;
        const normalized = String(parsed.normalized || parsed.raw || "").toLowerCase();
        if (/\b(?:top|bottom|highest|lowest|largest|smallest|biggest|best|worst|maximum|minimum|max|min|rank|ranking)\b/i.test(normalized)) return null;
        if (/\b(?:sales?|revenue|turnover|rent|rental|lease|ocr|occupancy|area|sqm|sq\s*m|m2|units?)\b/i.test(normalized)
            && /\b(?:assigned\s+sales\s+category|sales\s+category|assigned\s+group|group|assigned\s+tenant\s+name|tenant\s+name|assigned\s+unit|unit)\b/i.test(normalized)) {
            return null;
        }
        if (!/\b(?:by|of)\s+(?:assigned\s+sales\s+category|sales\s+category|assigned\s+group|group|category|assigned\s+tenant\s+name|tenant\s+name|assigned\s+unit|unit)\b/i.test(normalized)) return null;
        const inferred = this.inferPasteOverrides(parsed);
        if (!inferred.filterFields.length) return null;
        const metric = inferred.metrics[0] || this.resolveBuiltinMetricFromText(normalized);
        if (!metric) return null;
        return this.withSuggestions(answerFilterFieldBreakdown(this.context, parsed, metric, inferred.filterFields), [], undefined, baseConfidence);
    }

    private resolveBuiltinMetricFromText(text: string): AssistantMetric | null {
        const normalized = String(text || "").toLowerCase();
        if (/\b(?:sum|total)?\s*(?:of\s+)?(?:area|sqm|sq\s*m|m2|size|gla)\b/i.test(normalized)) {
            return this.context.metrics.find((metric) => metric.key === "__builtin::area") || null;
        }
        if (/\b(?:count|number|total)\s+(?:of\s+)?(?:units?|stores?|shops?)\b|\bunits?\b/i.test(normalized)) {
            return this.context.metrics.find((metric) => metric.key === "__builtin::units") || null;
        }
        if (/\boccupancy\b/i.test(normalized)) {
            return this.context.metrics.find((metric) => metric.key === "__builtin::occupancy") || null;
        }
        if (/\bvacan(?:t|cy)|empty|available\b/i.test(normalized)) {
            return this.context.metrics.find((metric) => metric.key === "__builtin::vacant") || null;
        }
        return null;
    }

    private getEarlyAttributeLookup(parsed: ParsedAssistantQuestion, entityPhrases: string[], originalQuestion?: string): AssistantResponse | null {
        const rawParsed = originalQuestion && String(originalQuestion || "").trim() !== String(parsed.raw || "").trim()
            ? parseAssistantQuestion(originalQuestion)
            : null;
        const request = this.detectAttributeLookupRequest(parsed) || (rawParsed ? this.detectAttributeLookupRequest(rawParsed) : null);
        if (!request) return null;
        const confidenceParsed = rawParsed && this.detectAttributeLookupRequest(rawParsed) ? rawParsed : parsed;
        const subjectPhrase = request.subjectPhrase;
        const exactEntities = this.getExactEntities(subjectPhrase, [subjectPhrase]);
        const fuzzyMatches = exactEntities.length ? [] : this.matcher.matchEntities([subjectPhrase], 8);
        const candidates = exactEntities.length
            ? exactEntities
            : fuzzyMatches.filter((match) => match.score <= 0.24).map((match) => match.item);
        const subjectEntities = this.prioritizeEntityKinds(parsed, this.filterEntityNoise(candidates, []))
            .filter((entity) => entity.kind !== request.attribute && !(request.attribute === "category" && entity.kind === "filter"));
        const clarificationCandidates = this.exactNameClarificationCandidates(subjectPhrase);
        if (clarificationCandidates.length > 1) {
            return {
                handled: true,
                text: `Which ${subjectPhrase} did you mean?`,
                suggestions: clarificationCandidates.slice(0, 6).map((entity) => entity.label),
                confidence: this.makeConfidence(parsed, {
                    intentConfidence: 0.86,
                    metricConfidence: 1,
                    entityConfidence: 0.45,
                    reasons: ["attribute_lookup_ambiguous_entity"]
                })
            };
        }
        const entity = this.getPrimaryEntityForAttribute(subjectEntities, request.attribute);
        if (!entity) {
            const suggestions = fuzzyMatches.slice(0, 5).map((match) => match.item.label);
            return {
                handled: true,
                text: `I understood you want the ${this.attributeLabel(request.attribute)}, but I could not identify "${subjectPhrase}".`,
                suggestions,
                confidence: this.makeConfidence(confidenceParsed, {
                    intentConfidence: 0.86,
                    metricConfidence: 1,
                    entityConfidence: 0.25,
                    reasons: ["attribute_lookup_entity_missing"]
                })
            };
        }
        const response = answerAttributeLookup(this.context, entity, request.attribute, parsed);
        return {
            ...response,
                confidence: this.makeConfidence(confidenceParsed, {
                intentConfidence: 0.92,
                metricConfidence: 1,
                entityConfidence: 0.9,
                matchedEntity: entity.label,
                reasons: ["attribute_lookup"]
            })
        };
    }

    private detectAttributeLookupRequest(parsed: ParsedAssistantQuestion): { attribute: "group" | "category" | "unit" | "tenant" | "floor"; subjectPhrase: string } | null {
        const normalized = String(parsed.normalized || parsed.raw || "")
            .toLowerCase()
            .replace(/[\u2022\u00a0]/g, " ")
            .replace(/[?!.:,;()[\]{}]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        if (!normalized) return null;
        const attrPattern = "(assigned\\s+sales\\s+category|sales\\s+category|assigned\\s+category|category|assigned\\s+group|group|assigned\\s+tenant\\s+name|tenant\\s+name|tenant|assigned\\s+unit|unit\\s+id|unit|floor|level)";
        const attrOfSubject = normalized.match(new RegExp(`\\b(?:what|which|show|tell|get|give)\\b\\s*(?:is|are|the|me|please|can|you|show|tell|give|get|find|value|field|assigned)*\\s*(?:the\\s+)?${attrPattern}\\s+(?:of|for)\\s+(.+)$`, "i"));
        const subjectAttr = normalized.match(new RegExp(`\\b(?:what|which)\\s+${attrPattern}\\s+(?:is|are)\\s+(.+)$`, "i"));
        const match = attrOfSubject || subjectAttr;
        if (!match) return null;
        const attributeText = String(match[1] || "").toLowerCase();
        const subjectPhrase = String(match[2] || "")
            .replace(/\b(?:in|as|with)\s+(?:bar|column|line|pie|donut|doughnut|area)?\s*(?:chart|graph|visual|plot|table)\b.+$/i, " ")
            .replace(/\s+/g, " ")
            .trim();
        if (!subjectPhrase || /^(tenant|unit|category|group|zone|floor|layer)s?$/.test(subjectPhrase)) return null;
        const attribute = this.attributeFromPhrase(attributeText);
        return attribute ? { attribute, subjectPhrase } : null;
    }

    private attributeFromPhrase(value: string): "group" | "category" | "unit" | "tenant" | "floor" | null {
        const clean = String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
        if (/sales\s+category|category/.test(clean)) return "category";
        if (/group/.test(clean)) return "group";
        if (/tenant/.test(clean)) return "tenant";
        if (/unit/.test(clean)) return "unit";
        if (/floor|level/.test(clean)) return "floor";
        return null;
    }

    private attributeLabel(attribute: "group" | "category" | "unit" | "tenant" | "floor"): string {
        if (attribute === "category") return "Assigned Sales Category";
        if (attribute === "group") return "Assigned Group";
        if (attribute === "unit") return "Unit";
        if (attribute === "tenant") return "Tenant";
        return "Floor";
    }

    private isBookmarkCountQuestion(parsed: ParsedAssistantQuestion): boolean {
        const set = new Set((parsed.tokens || []).map((token) => String(token || "").toLowerCase()));
        const asksCount = set.has("how") || set.has("many") || set.has("count") || set.has("number") || set.has("total");
        const asksBookmark = set.has("bookmark") || set.has("bookmarks") || /\bbookmarks?\b/i.test(parsed.normalized || "");
        return asksCount && asksBookmark;
    }

    private getEntityCountRequest(parsed: ParsedAssistantQuestion): { kind: AssistantEntity["kind"]; label: string } | null {
        const q = String(parsed.normalized || "").toLowerCase();
        if (/\b(top|bottom|highest|lowest|largest|smallest|best|worst|rank|ranking)\b/.test(q)) return null;
        const asksCount = /\b(how\s+many|count|number\s+of|total\s+number)\b/.test(q)
            || /^\s*(?:units?|tenants?|stores?|shops?|brands?)\s+(?:in|inside|within|under|on|at|for)\b/.test(q)
            || /\b(?:units?|tenants?|stores?|shops?|brands?)\s+(?:are|is|was|were)\s+there\b/.test(q)
            || /\bthere\s+(?:are|is|was|were)\s+(?:units?|tenants?|stores?|shops?|brands?)\b/.test(q);
        if (!asksCount) return null;
        const checks: Array<{ kind: AssistantEntity["kind"]; label: string; re: RegExp }> = [
            { kind: "tenant", label: "tenant", re: /\btenants?\b|\bbrands?\b|\bstores?\b|\bshops?\b/ },
            { kind: "unit", label: "unit", re: /\bunits?\b/ },
            { kind: "category", label: "category", re: /\bcategories\b|\bcategory\b/ },
            { kind: "group", label: "group", re: /\bgroups?\b/ },
            { kind: "zone", label: "zone", re: /\bzones?\b/ },
            { kind: "layer", label: "layer", re: /\blayers?\b/ },
            { kind: "floor", label: "floor", re: /\bfloors?\b|\blevels?\b/ }
        ];
        const match = checks.find((item) => item.re.test(q));
        return match ? { kind: match.kind, label: match.label } : null;
    }

    private normalizeRawCountQuestion(question: string): string {
        return String(question || "")
            .toLowerCase()
            .replace(/[?!.:,;()[\]{}]/g, " ")
            .replace(/\bunit\s+sin\b/g, "units in")
            .replace(/\bunitsin\b/g, "units in")
            .replace(/\btenantsin\b/g, "tenants in")
            .replace(/\b(?:ther|thre|tere|threre)\b/g, "there")
            .replace(/\b(?:frist|fisrt|frst)\b/g, "first")
            .replace(/\b(?:secnd|seconf|scnd)\b/g, "second")
            .replace(/\b(?:thrid|thrd|thirt|thirst|thirsd)\b/g, "third")
            .replace(/\b(?:no\.?|num|nbr)\s+of\b/g, "number of")
            .replace(/\bhow\s+much\s+(units?|tenants?|stores?|shops?|brands?)\b/g, "how many $1")
            .replace(/\s+/g, " ")
            .trim();
    }

    private isRawCountQuestion(raw: string): boolean {
        if (/\b(top|bottom|highest|lowest|largest|smallest|best|worst|rank|ranking)\b/i.test(raw)) return false;
        return /\b(?:how\s+many|count|number\s+of|total\s+number)\b/.test(raw)
            || /^\s*(?:units?|tenants?|stores?|shops?|brands?)\s+(?:in|inside|within|under|on|at|for)\b/.test(raw)
            || /\b(?:units?|tenants?|stores?|shops?|brands?)\s+(?:are|is|was|were)\s+there\b/.test(raw)
            || /\bthere\s+(?:are|is|was|were)\s+(?:units?|tenants?|stores?|shops?|brands?)\b/.test(raw);
    }

    private answerRawScopedCount(question: string): AssistantResponse | null {
        const raw = this.normalizeRawCountQuestion(question);
        if (!this.isRawCountQuestion(raw)) return null;
        const target = /\b(?:units?|unit count|stores?|shops?)\b/.test(raw)
            ? { kind: "unit" as AssistantEntity["kind"], label: "unit", plural: "units" }
            : /\b(?:tenants?|brands?)\b/.test(raw)
            ? { kind: "tenant" as AssistantEntity["kind"], label: "tenant", plural: "tenants" }
            : null;
        if (!target) return null;
        const rowScopeRequest = this.rowBackedScopeRequestFromText(raw);
        const scope = (rowScopeRequest ? this.rowBackedScopeEntity(rowScopeRequest.kind, rowScopeRequest.phrase) : null) || this.findExactOrdinalScopeFromText(raw);
        if (!scope) {
            if (rowScopeRequest) {
                const suggestions = this.rowBackedScopeSuggestions(rowScopeRequest.kind, rowScopeRequest.phrase);
                if (suggestions.length) {
                    return {
                        handled: true,
                        text: `Which ${rowScopeRequest.kind} did you mean?`,
                        suggestions
                    };
                }
            }
            return null;
        }
        const indices = this.combineScopedCountIndices([scope]);
        const asksList = /\b(?:list|show|display|which|what)\b/.test(raw) && !/\b(?:how\s+many|count|number\s+of|total)\b/.test(raw);
        if (asksList) {
            const metrics = this.resolveMetricsMentionedInQuestionText(question, 6);
            const rows = this.tenantOrUnitRowsForIndices(indices, target.kind === "tenant" ? "tenant" : "unit", metrics);
            const limit = Math.min(100, rows.length);
            return {
                handled: true,
                text: `Found ${this.context.formatNumber(rows.length, { maximumFractionDigits: 0 })} ${target.label}${rows.length === 1 ? "" : "s"} in ${scope.label}. Showing ${limit}.`,
                actions: [this.selectScopedCountAction(scope, indices)],
                table: {
                    columns: [target.kind === "tenant" ? "Tenant" : "Unit"].concat(metrics.map((metric) => metric.name)),
                    rows: rows.slice(0, limit).map((row) => row.slice(0, 1 + metrics.length))
                },
                autoSelectIndices: indices
            };
        }
        const count = this.countDistinctUnits(indices);
        const countText = this.context.formatNumber(count, { maximumFractionDigits: 0 });
        const scopeText = scope.label;
        const column = target.kind === "unit" ? "Units" : "Tenants";
        return {
            handled: true,
            text: `There ${count === 1 ? "is" : "are"} ${countText} ${target.label}${count === 1 ? "" : "s"} in ${scopeText}.`,
            actions: [this.selectScopedCountAction(scope, indices)],
            table: {
                columns: ["Scope", column],
                rows: [[scopeText, countText]]
            }
        };
    }

    private answerRawZonedQuestion(question: string): AssistantResponse | null {
        const raw = this.normalizeRawCountQuestion(question);
        const asksUnzoned = /\b(?:unzoned|un\s+zoned|no\s+zone|without\s+zone|not\s+zoned)\b/.test(raw);
        const asksZoned = !asksUnzoned && /\bzoned\b|\bwith\s+zone\b|\bhas\s+zone\b/.test(raw);
        if (!asksUnzoned && !asksZoned) return null;
        const asksUnits = /\b(?:units?|unit count|stores?|shops?)\b/.test(raw);
        const asksTenants = /\b(?:tenants?|brands?)\b/.test(raw);
        const asksCount = this.isRawCountQuestion(raw);
        const asksList = /\b(?:list|show|which|what)\b/.test(raw) || !asksCount;
        if (!asksUnits && !asksTenants) return null;

        const floorPhrase = this.floorPhraseFromRawText(raw);
        const matched = (asksUnzoned ? this.unzonedRowIndices() : this.zonedRowIndices())
            .filter((idx) => !floorPhrase || this.rowMatchesFloorPhrase(idx, floorPhrase));
        const zoneStatusText = asksUnzoned ? "unzoned" : "zoned";
        const scopeText = `${floorPhrase ? `${this.floorDisplayName(floorPhrase)} floor ` : ""}${zoneStatusText}`;
        const unitCount = this.countDistinctUnits(matched);
        const count = unitCount;
        const countLabel = asksTenants ? "tenant" : "unit";
        const countText = this.context.formatNumber(count, { maximumFractionDigits: 0 });
        const unitCountText = this.context.formatNumber(unitCount, { maximumFractionDigits: 0 });

        if (asksCount && !asksList) {
            return {
                handled: true,
                text: `There ${count === 1 ? "is" : "are"} ${countText} ${scopeText} ${countLabel}${count === 1 ? "" : "s"}.`,
                table: {
                    columns: ["Scope", asksTenants ? "Tenants" : "Units"],
                    rows: [[scopeText, asksTenants ? countText : unitCountText]]
                }
            };
        }

        const rows = this.unzonedDetailRows(matched, "unit");
        const limit = Math.min(100, rows.length);
        return {
            handled: true,
            text: `Found ${countText} ${scopeText} ${countLabel}${count === 1 ? "" : "s"}. Showing ${Math.min(limit, rows.length)}${rows.length > limit ? ` of ${rows.length}` : ""}.`,
            table: {
                columns: ["Unit", "Tenant"],
                rows: rows.slice(0, limit).map((row) => [row[0] || "", row[1] || ""])
            },
            autoSelectIndices: matched
        };
    }

    private zonedRowIndices(): number[] {
        const zoned = new Set<number>();
        (this.context.entities || [])
            .filter((entity) => entity.kind === "zone")
            .forEach((entity) => (entity.indices || []).forEach((idx) => {
                const n = Number(idx);
                if (Number.isFinite(n)) zoned.add(n);
            }));
        return (this.context.rows || [])
            .map((row) => row.idx)
            .filter((idx) => zoned.has(idx));
    }

    private unzonedRowIndices(): number[] {
        const zoned = new Set<number>();
        (this.context.entities || [])
            .filter((entity) => entity.kind === "zone")
            .forEach((entity) => (entity.indices || []).forEach((idx) => {
                const n = Number(idx);
                if (Number.isFinite(n)) zoned.add(n);
            }));
        return (this.context.rows || [])
            .map((row) => row.idx)
            .filter((idx) => !zoned.has(idx));
    }

    private floorPhraseFromRawText(raw: string): string {
        const text = String(raw || "").toLowerCase();
        const match = text.match(/\b(?:in|on|at)\s+(ground|first|1st|second|2nd|third|3rd|floor\s*[123]|level\s*[123])\s+floor\b/i)
            || text.match(/\b(ground|first|1st|second|2nd|third|3rd)\s+floor\b/i)
            || text.match(/\b(?:floor|level)\s*([123])\b/i);
        if (!match?.[1]) return "";
        const value = String(match[1] || "").toLowerCase().replace(/\s+/g, " ").trim();
        if (value === "1") return "floor 1";
        if (value === "2") return "floor 2";
        if (value === "3") return "floor 3";
        return value;
    }

    private floorDisplayName(phrase: string): string {
        const clean = String(phrase || "").toLowerCase();
        if (/ground|floor 1|level 1/.test(clean)) return "ground";
        if (/first|1st|floor 2|level 2/.test(clean)) return "first";
        if (/second|2nd|floor 3|level 3/.test(clean)) return "second";
        if (/third|3rd/.test(clean)) return "third";
        return phrase;
    }

    private rowMatchesFloorPhrase(idx: number, phrase: string): boolean {
        const q = String(phrase || "").toLowerCase().replace(/\s+/g, " ").trim();
        const floors = (this.context.rows[idx]?.floors || []).map((floor) => String(floor || "").toLowerCase().replace(/\s+/g, " ").trim());
        return floors.some((floor) => {
            if (!floor) return false;
            if (floor === q || floor.indexOf(q) >= 0 || q.indexOf(floor) >= 0) return true;
            if ((q === "ground" || q === "floor 1" || q === "level 1") && /ground|floor 1|level 1|first|1st/.test(floor)) return true;
            if ((q === "first" || q === "1st" || q === "floor 2" || q === "level 2") && /first|1st|floor 2|level 2|second|2nd/.test(floor)) return true;
            if ((q === "second" || q === "2nd" || q === "floor 3" || q === "level 3") && /second|2nd|floor 3|level 3|third|3rd/.test(floor)) return true;
            return false;
        });
    }

    private unzonedDetailRows(indices: number[], mode: "unit" | "tenant"): string[][] {
        const seen = new Set<string>();
        return (indices || [])
            .map((idx) => this.context.rows[idx])
            .filter(Boolean)
            .map((row) => {
                const unit = row.unitId || row.combinedUnit || row.shapeKey || "";
                const tenant = row.tenant || "";
                const key = mode === "tenant"
                    ? String(tenant || unit || row.idx).toLowerCase()
                    : String(unit || row.shapeKey || row.idx).toLowerCase();
                if (!key || seen.has(key)) return null;
                seen.add(key);
                return [
                    unit || "N/A",
                    tenant || "N/A",
                    row.category || "N/A",
                    row.group || "N/A",
                    (row.floors || []).filter(Boolean).join(", ") || "N/A",
                    typeof row.area === "number" && Number.isFinite(row.area) ? this.context.formatNumber(row.area, { maximumFractionDigits: 0 }) : "N/A"
                ];
            })
            .filter((row): row is string[] => !!row)
            .sort((a, b) => a[4].localeCompare(b[4], undefined, { sensitivity: "base", numeric: true }) || a[0].localeCompare(b[0], undefined, { sensitivity: "base", numeric: true }));
    }

    private answerRawCountRank(question: string): AssistantResponse | null {
        const raw = this.normalizeRawCountQuestion(question);
        if (!/\b(?:which|what|show|top|bottom|highest|lowest|largest|smallest|most|least|max|maximum|min|minimum)\b/.test(raw)) return null;
        if (!/\b(?:number\s+of|count\s+of|how\s+many)\b/.test(raw)) return null;
        const counted = /\b(?:tenants?|brands?)\b/.test(raw)
            ? { kind: "tenant" as AssistantEntity["kind"], label: "Tenants", singular: "tenant" }
            : /\b(?:units?|stores?|shops?)\b/.test(raw)
            ? { kind: "unit" as AssistantEntity["kind"], label: "Units", singular: "unit" }
            : null;
        if (!counted) return null;
        const dimension = this.rankCountDimensionFromText(raw, counted.kind);
        if (!dimension) return null;
        const direction: "top" | "bottom" = /\b(?:bottom|lowest|smallest|least|min|minimum)\b/.test(raw) ? "bottom" : "top";
        const explicitLimit = Number(raw.match(/\b(?:top|bottom)\s+(\d{1,3})\b/)?.[1] || 0);
        const singleRank = /\b(?:highest|lowest|largest|smallest|most|least|max|maximum|min|minimum)\b/.test(raw);
        const limit = Math.max(1, Math.min(50, explicitLimit || (singleRank ? 1 : 5)));
        const entities = (this.context.entities || [])
            .filter((entity) => entity.kind === dimension.kind)
            .filter((entity) => String(entity.label || "").trim())
            .map((entity) => ({
                entity,
                count: this.countDistinctUnits(entity.indices || [])
            }))
            .filter((item) => item.count > 0)
            .sort((a, b) => direction === "bottom"
                ? a.count - b.count || a.entity.label.localeCompare(b.entity.label, undefined, { sensitivity: "base", numeric: true })
                : b.count - a.count || a.entity.label.localeCompare(b.entity.label, undefined, { sensitivity: "base", numeric: true }));
        const shown = entities.slice(0, limit);
        if (!shown.length) return { handled: true, text: `No ${dimension.label.toLowerCase()} ${counted.singular} counts found in the loaded data.` };
        const rows = shown.map((item, index) => [
            String(index + 1),
            item.entity.label,
            this.context.formatNumber(item.count, { maximumFractionDigits: 0 })
        ]);
        const best = shown[0];
        const countText = this.context.formatNumber(best.count, { maximumFractionDigits: 0 });
        const heading = `${direction === "bottom" ? "Lowest" : "Highest"} ${dimension.singular.toLowerCase()} by ${counted.singular} count`;
        return {
            handled: true,
            text: limit === 1
                ? `${best.entity.label} has the ${direction === "bottom" ? "lowest" : "highest"} number of ${counted.label.toLowerCase()}: ${countText}.`
                : `${direction === "bottom" ? "Bottom" : "Top"} ${shown.length} ${dimension.label.toLowerCase()} by ${counted.singular} count.`,
            actions: shown.slice(0, 5).map((item) => this.selectScopedCountAction(item.entity, item.entity.indices || [])),
            table: {
                columns: ["Rank", dimension.singular, counted.label],
                rows
            },
            chart: {
                type: "bar",
                title: heading,
                labels: shown.map((item) => item.entity.label),
                values: shown.map((item) => item.count),
                valueLabels: shown.map((item) => this.context.formatNumber(item.count, { maximumFractionDigits: 0 }))
            }
        };
    }

    private rankCountDimensionFromText(raw: string, countedKind: AssistantEntity["kind"]): { kind: AssistantEntity["kind"]; singular: string; label: string } | null {
        const options: Array<{ kind: AssistantEntity["kind"]; singular: string; label: string; re: RegExp }> = [
            { kind: "zone", singular: "Zone", label: "Zones", re: /\bzones?\b/ },
            { kind: "layer", singular: "Layer", label: "Layers", re: /\blayers?\b/ },
            { kind: "floor", singular: "Floor", label: "Floors", re: /\bfloors?\b|\blevels?\b/ },
            { kind: "category", singular: "Category", label: "Categories", re: /\bcategories\b|\bcategory\b|\bsales\s+categor(?:y|ies)\b/ },
            { kind: "group", singular: "Group", label: "Groups", re: /\bgroups?\b/ },
            { kind: "tenant", singular: "Tenant", label: "Tenants", re: /\btenants?\b|\bbrands?\b/ },
            { kind: "unit", singular: "Unit", label: "Units", re: /\bunits?\b/ }
        ];
        const match = options.find((item) => item.kind !== countedKind && item.re.test(raw));
        return match ? { kind: match.kind, singular: match.singular, label: match.label } : null;
    }

    private countDistinctTenants(indices: number[]): number {
        return this.distinctRowsByKey(indices, (idx) => {
            const row = this.context.rows[idx];
            const tenant = String(row?.tenant || "").trim();
            return tenant && !/^(n\/a|na|none|null|undefined|-|no tenant|\(no name\))$/i.test(tenant) ? tenant.toLowerCase() : "";
        }).length;
    }

    private countDistinctUnits(indices: number[]): number {
        return this.distinctRowsByKey(indices, (idx) => {
            const row = this.context.rows[idx];
            return row ? (row.combinedUnit || row.unitId || row.shapeKey || `row-${idx}`) : "";
        }).length;
    }

    private normalizeScopeValue(value: string): string {
        return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    }

    private fuzzyScopeLabelScore(phrase: string, label: string): number {
        const wanted = this.normalizeScopeValue(phrase);
        const candidate = this.normalizeScopeValue(label);
        if (!wanted || !candidate) return 0;
        if (candidate === wanted) return 1;
        const wantedCompact = wanted.replace(/\s+/g, "");
        const candidateCompact = candidate.replace(/\s+/g, "");
        if (wantedCompact === candidateCompact) return 0.98;
        if (wanted.length >= 4 && (candidate.indexOf(wanted) >= 0 || wanted.indexOf(candidate) >= 0)) return 0.9;

        const wantedTokens = wanted.split(/\s+/g).filter((token) => token.length >= 3);
        const candidateTokens = candidate.split(/\s+/g).filter((token) => token.length >= 3);
        if (!wantedTokens.length || !candidateTokens.length) return 0;

        const tokenScores = wantedTokens.map((token) => {
            const compactToken = token.replace(/\s+/g, "");
            let best = 0;
            candidateTokens.forEach((candidateToken) => {
                if (candidateToken === token) {
                    best = Math.max(best, 1);
                    return;
                }
                if (candidateToken.indexOf(token) >= 0 || token.indexOf(candidateToken) >= 0) {
                    best = Math.max(best, 0.88);
                    return;
                }
                const maxDistance = compactToken.length >= 8 ? 4 : compactToken.length >= 5 ? 4 : 1;
                const distance = this.fieldEditDistance(compactToken, candidateToken, maxDistance);
                if (distance <= maxDistance) best = Math.max(best, Math.max(0.62, 0.86 - distance * 0.06));
            });
            return best;
        });
        if (tokenScores.some((score) => score <= 0)) return 0;
        return tokenScores.reduce((sum, score) => sum + score, 0) / tokenScores.length;
    }

    private rowBackedScopeEntity(kind: "category" | "group", phrase: string): AssistantEntity | null {
        const wanted = this.normalizeScopeValue(phrase);
        if (!wanted) return null;
        let labelOverride = "";
        let matches = (this.context.rows || []).filter((row) => {
            const value = kind === "category" ? row?.category : row?.group;
            return this.normalizeScopeValue(value || "") === wanted;
        });
        if (!matches.length) {
            const values = new Map<string, string>();
            (this.context.rows || []).forEach((row) => {
                const value = String((kind === "category" ? row?.category : row?.group) || "").trim();
                const key = this.normalizeScopeValue(value);
                if (key && !values.has(key)) values.set(key, value);
            });
            const scored = Array.from(values.values())
                .map((label) => ({ label, score: this.fuzzyScopeLabelScore(phrase, label) }))
                .filter((item) => item.score >= 0.62)
                .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true }));
            const best = scored[0];
            const second = scored[1];
            if (best && (!second || best.score - second.score >= 0.08)) {
                labelOverride = best.label;
                const bestKey = this.normalizeScopeValue(best.label);
                matches = (this.context.rows || []).filter((row) => {
                    const value = kind === "category" ? row?.category : row?.group;
                    return this.normalizeScopeValue(value || "") === bestKey;
                });
            }
        }
        if (!matches.length) return null;
        const label = kind === "category"
            ? String(labelOverride || matches.find((row) => row?.category)?.category || phrase).trim()
            : String(labelOverride || matches.find((row) => row?.group)?.group || phrase).trim();
        return {
            id: `row-scope:${kind}:${wanted}`,
            kind,
            label,
            aliases: [label],
            indices: matches.map((row) => row.idx)
        };
    }

    private rowBackedScopeRequestFromText(raw: string): { kind: "category" | "group"; phrase: string } | null {
        const matches = Array.from(String(raw || "").matchAll(/\b(?:in|inside|within|under|from|for)\s+(.+?)\s+\b(category|categories|group|groups)\b/g));
        for (let i = matches.length - 1; i >= 0; i -= 1) {
            const phrase = String(matches[i]?.[1] || "").trim();
            const kindText = String(matches[i]?.[2] || "").toLowerCase();
            const kind = /^group/.test(kindText) ? "group" : "category";
            if (phrase) return { kind, phrase };
        }
        return null;
    }

    private findExactRowBackedScopeFromText(raw: string): AssistantEntity | null {
        const request = this.rowBackedScopeRequestFromText(raw);
        return request ? this.rowBackedScopeEntity(request.kind, request.phrase) : null;
    }

    private rowBackedScopeSuggestions(kind: "category" | "group", phrase: string, limit: number = 5): string[] {
        const values = new Map<string, string>();
        (this.context.rows || []).forEach((row) => {
            const value = String((kind === "category" ? row?.category : row?.group) || "").trim();
            const key = this.normalizeScopeValue(value);
            if (key && !values.has(key)) values.set(key, value);
        });
        return Array.from(values.values())
            .map((label) => ({ label, score: this.fuzzyScopeLabelScore(phrase, label) }))
            .filter((item) => item.score >= 0.45)
            .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true }))
            .slice(0, limit)
            .map((item) => item.label);
    }

    private selectedFieldValueQuestionSuggestions(field: string, limit: number = 8): { prompt: string; suggestions: string[] } | null {
        const kind = this.assistantKindForField(field);
        const values = new Map<string, { label: string; count: number }>();
        const add = (value: string) => {
            const label = String(value || "").trim();
            if (!label || /^n\/a$|^na$|none|null|undefined|-$/i.test(label)) return;
            const key = this.normalizeScopeValue(label);
            if (!key) return;
            const existing = values.get(key);
            if (existing) existing.count += 1;
            else values.set(key, { label, count: 1 });
        };
        if (kind === "category" || kind === "group") {
            (this.context.rows || []).forEach((row) => add(kind === "category" ? row?.category || "" : row?.group || ""));
        } else if (kind === "floor") {
            (this.context.rows || []).forEach((row) => (row?.floors || []).forEach(add));
        } else if (kind === "zone" || kind === "layer") {
            (this.context.entities || []).filter((entity) => entity.kind === kind).forEach((entity) => add(entity.label));
        } else {
            return null;
        }
        const labels = Array.from(values.values())
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true }))
            .slice(0, limit)
            .map((item) => item.label);
        if (!labels.length) return null;
        const noun = kind === "category" ? "category" : kind === "group" ? "group" : kind;
        const suggestions = labels.map((label) => kind === "category" || kind === "group"
            ? `list tenants in ${label} ${noun}`
            : `list tenants in ${label}`);
        return {
            prompt: `Which ${noun} should I list tenants for?`,
            suggestions
        };
    }

    private getFieldOnlyTenantListClarification(parsed: ParsedAssistantQuestion): AssistantResponse | null {
        if (parsed.intent !== "list") return null;
        const text = String(parsed.raw || parsed.normalized || "");
        if (!/\b(?:list|show|display)\b/i.test(text) || !/\b(?:tenant|tenants|brand|brands|shop|shops|store|stores)\b/i.test(text)) return null;
        const fields = (parsed.requestedFields?.entities || [])
            .concat(parsed.requestedFields?.rows || [])
            .concat(parsed.requestedFields?.columns || [])
            .map((field) => String(field || "").trim())
            .filter(Boolean);
        const field = fields.find((candidate) => {
            const kind = this.assistantKindForField(candidate);
            return kind === "category" || kind === "group" || kind === "zone" || kind === "floor" || kind === "layer";
        });
        if (!field) return null;
        const clarification = this.selectedFieldValueQuestionSuggestions(field);
        if (!clarification) return null;
        return {
            handled: true,
            text: clarification.prompt,
            suggestions: clarification.suggestions
        };
    }

    private tenantOrUnitRowsForIndices(indices: number[], targetKind: "tenant" | "unit", metrics: AssistantMetric[] = []): string[][] {
        const byKey = new Map<string, { indices: number[]; rowIndex: number }>();
        (indices || []).forEach((idx) => {
            const row = this.context.rows[idx];
            if (!row) return;
            const rawKey = targetKind === "tenant"
                ? String(row.tenant || "").trim()
                : String(row.combinedUnit || row.unitId || row.shapeKey || "").trim();
            if (!rawKey || /^(n\/a|na|none|null|undefined|-|no tenant|\(no name\))$/i.test(rawKey)) return;
            const key = rawKey.toLowerCase();
            const existing = byKey.get(key);
            if (existing) {
                existing.indices.push(idx);
                return;
            }
            byKey.set(key, { indices: [idx], rowIndex: idx });
        });
        return Array.from(byKey.values())
            .sort((a, b) => {
                const ar = this.context.rows[a.rowIndex];
                const br = this.context.rows[b.rowIndex];
                const al = targetKind === "tenant" ? ar?.tenant || "" : ar?.combinedUnit || ar?.unitId || ar?.shapeKey || "";
                const bl = targetKind === "tenant" ? br?.tenant || "" : br?.combinedUnit || br?.unitId || br?.shapeKey || "";
                return String(al).localeCompare(String(bl), undefined, { sensitivity: "base", numeric: true });
            })
            .map((item) => {
                const row = this.context.rows[item.rowIndex];
                const label = targetKind === "tenant" ? row?.tenant || "" : row?.combinedUnit || row?.unitId || row?.shapeKey || "";
                const area = item.indices.reduce((sum, idx) => sum + (Number(this.context.rows[idx]?.area) || 0), 0);
                return [
                    String(label || ""),
                    ...metrics.map((metric) => formatAssistantMetric(this.context, metric, resolveMetricValue(this.context, metric, item.indices))),
                    String(item.indices.length),
                    this.context.formatNumber(area, { maximumFractionDigits: 0 }),
                    row?.category || "N/A",
                    row?.group || "N/A",
                    (row?.floors || []).filter(Boolean).join(", ") || "N/A"
                ];
            });
    }

    private ordinalNumber(value: string): number | null {
        const clean = String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
        const numeric = Number(clean.match(/\d+/)?.[0] || NaN);
        if (Number.isFinite(numeric)) return numeric;
        if (/^(?:one|first|1st)$/.test(clean)) return 1;
        if (/^(?:two|second|2nd)$/.test(clean)) return 2;
        if (/^(?:three|third|3rd)$/.test(clean)) return 3;
        if (/^(?:four|fourth|4th)$/.test(clean)) return 4;
        if (/^(?:five|fifth|5th)$/.test(clean)) return 5;
        if (/^(?:six|sixth|6th)$/.test(clean)) return 6;
        if (/^(?:seven|seventh|7th)$/.test(clean)) return 7;
        if (/^(?:eight|eighth|8th)$/.test(clean)) return 8;
        if (/^(?:nine|ninth|9th)$/.test(clean)) return 9;
        if (/^(?:ten|tenth|10th)$/.test(clean)) return 10;
        return null;
    }

    private canonicalScopeLabel(value: string): string {
        const clean = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
        return clean.replace(/\b(zone|layer|floor|level)\s+0+(\d+)\b/g, (_m, kind, num) => `${kind === "level" ? "floor" : kind} ${Number(num)}`);
    }

    private findExactOrdinalScopeFromText(raw: string): AssistantEntity | null {
        const wanted = new Set<string>();
        Array.from(String(raw || "").matchAll(/\b(zone|layer|floor|level)\s*(?:no\.?|number)?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th)\b/g)).forEach((match) => {
            const kind = /^level|floor$/i.test(String(match[1] || "")) ? "floor" : String(match[1] || "").toLowerCase();
            const n = this.ordinalNumber(match[2]);
            if (Number.isFinite(n as number)) wanted.add(`${kind} ${n}`);
        });
        Array.from(String(raw || "").matchAll(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th)\s+(zone|layer|floor|level)\b/g)).forEach((match) => {
            const kind = /^level|floor$/i.test(String(match[2] || "")) ? "floor" : String(match[2] || "").toLowerCase();
            const n = this.ordinalNumber(match[1]);
            if (Number.isFinite(n as number)) wanted.add(`${kind} ${n}`);
        });
        if (!wanted.size) return null;
        return (this.context.entities || [])
            .filter((entity) => entity.kind === "zone" || entity.kind === "layer" || entity.kind === "floor")
            .find((entity) => [entity.label].concat(entity.aliases || []).some((label) => {
                const clean = this.canonicalScopeLabel(label);
                return wanted.has(clean);
            })) || null;
    }

    private selectScopedCountAction(scope: AssistantEntity, indices: number[]): AssistantAction {
        return {
            kind: "select",
            label: `Select ${scope.label} in report`,
            indices: Array.from(new Set((indices.length ? indices : scope.indices || []).map(Number).filter((idx) => Number.isFinite(idx))))
        };
    }

    private answerGlobalRowBackedCount(request: { kind: AssistantEntity["kind"]; label: string }): AssistantResponse | null {
        if (request.kind !== "unit" && request.kind !== "tenant") return null;
        const allIndices = (this.context.rows || []).map((row) => row.idx);
        const count = this.countDistinctUnits(allIndices);
        const countText = this.context.formatNumber(count, { maximumFractionDigits: 0 });
        const label = request.kind === "unit" ? "unit" : "tenant";
        return {
            handled: true,
            text: `There ${count === 1 ? "is" : "are"} ${countText} ${label}${count === 1 ? "" : "s"}.`,
            table: {
                columns: [label.charAt(0).toUpperCase() + label.slice(1) + (count === 1 ? "" : "s")],
                rows: [[countText]]
            }
        };
    }

    private answerScopedEntityCount(
        request: { kind: AssistantEntity["kind"]; label: string },
        scopes: AssistantEntity[]
    ): AssistantResponse | null {
        if (!scopes.length) return null;
        const uniqueScopes = this.uniqueScopedCountEntities(scopes);
        const scopedIndices = this.combineScopedCountIndices(scopes);
        if (!scopedIndices.length) return {
            handled: true,
            text: `There are 0 ${request.label}s in ${uniqueScopes.map((scope) => scope.label).join(", ")}.`
        };
        const scopeText = uniqueScopes.map((scope) => scope.label).join(", ");
        if (request.kind === "unit" || request.kind === "tenant") {
            const units = this.distinctRowsByKey(scopedIndices, (idx) => {
                const row = this.context.rows[idx];
                return row ? (row.combinedUnit || row.unitId || row.shapeKey || `row-${idx}`) : "";
            });
            const label = request.kind === "unit" ? "unit" : "tenant";
            const column = request.kind === "unit" ? "Units" : "Tenants";
            return {
                handled: true,
                text: `There ${units.length === 1 ? "is" : "are"} ${this.context.formatNumber(units.length, { maximumFractionDigits: 0 })} ${label}${units.length === 1 ? "" : "s"} in ${scopeText}.`,
                table: {
                    columns: ["Scope", column],
                    rows: [[scopeText, this.context.formatNumber(units.length, { maximumFractionDigits: 0 })]]
                }
            };
        }
        const matchingEntities = (this.context.entities || [])
            .filter((entity) => entity.kind === request.kind)
            .filter((entity) => (entity.indices || []).some((idx) => scopedIndices.indexOf(idx) >= 0))
            .filter((entity, index, arr) => arr.findIndex((item) => item.kind === entity.kind && item.id === entity.id) === index);
        return {
            handled: true,
            text: `There ${matchingEntities.length === 1 ? "is" : "are"} ${this.context.formatNumber(matchingEntities.length, { maximumFractionDigits: 0 })} ${request.label}${matchingEntities.length === 1 ? "" : "s"} in ${scopeText}.`,
            table: {
                columns: ["Scope", request.label.charAt(0).toUpperCase() + request.label.slice(1) + (matchingEntities.length === 1 ? "" : "s")],
                rows: [[scopeText, this.context.formatNumber(matchingEntities.length, { maximumFractionDigits: 0 })]]
            }
        };
    }

    private combineScopedCountIndices(scopes: AssistantEntity[]): number[] {
        const unique = (values: number[]): number[] => Array.from(new Set(values.map(Number).filter((value) => Number.isFinite(value) && value >= 0)));
        const groups = (scopes || []).map((scope) => unique(scope.indices || [])).filter((indices) => indices.length);
        if (!groups.length) return [];
        return groups.slice(1).reduce((out, indices) => {
            const set = new Set(indices);
            return out.filter((idx) => set.has(idx));
        }, groups[0]);
    }

    private uniqueScopedCountEntities(scopes: AssistantEntity[]): AssistantEntity[] {
        const out: AssistantEntity[] = [];
        const keyFor = (scope: AssistantEntity): string => {
            const field = String(scope.meta?.filterName || scope.meta?.field || scope.kind || "").toLowerCase();
            const label = String(scope.label || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
            return `${field}:${label}`;
        };
        (scopes || []).forEach((scope) => {
            const key = keyFor(scope);
            if (!key || out.some((item) => keyFor(item) === key)) return;
            out.push(scope);
        });
        return out;
    }

    private distinctRowsByKey(indices: number[], keyForIndex: (idx: number) => string): string[] {
        return Array.from(new Set((indices || []).map(keyForIndex).map((key) => String(key || "").trim()).filter(Boolean)));
    }

    private getPrimaryEntityForAttribute(
        entities: AssistantEntity[],
        attribute: "group" | "category" | "unit" | "tenant" | "floor"
    ): AssistantEntity | null {
        const skipKind = attribute === "category" ? "category" : attribute;
        return entities.find((entity) => entity.kind !== skipKind && entity.kind !== "filter") || entities[0] || null;
    }

    private getExactEntities(normalizedQuestion: string, phrases?: string[]): AssistantEntity[] {
        const queryText = (phrases && phrases.length) ? phrases.join(" ") : normalizedQuestion;
        const question = ` ${String(queryText || "").toLowerCase()} `;
        const compactQuestion = question.replace(/\s+/g, "");
        const candidates: Array<{ entity: AssistantEntity; phrase: string; length: number }> = [];
        const kindRank = (kind: string): number => {
            if (kind === "unit") return 0;
            if (kind === "tenant") return 1;
            if (kind === "zone") return 2;
            if (kind === "layer") return 3;
            if (kind === "bookmark") return 4;
            return 4;
        };
        this.context.entities.forEach((entity) => {
            const phrases = [entity.label].concat(entity.aliases || [])
                .map((phrase) => String(phrase || "").toLowerCase().replace(/[?!.:,;()[\]{}]/g, " ").replace(/\s+/g, " ").trim())
                .reduce((out: string[], phrase) => {
                    out.push(phrase);
                    if (phrase.indexOf("&") >= 0) {
                        out.push(phrase.replace(/\s*&\s*/g, " and ").replace(/\s+/g, " ").trim());
                        out.push(phrase.replace(/\s*&\s*/g, " ").replace(/\s+/g, " ").trim());
                    }
                    if (/\band\b/.test(phrase)) {
                        out.push(phrase.replace(/\s+and\s+/g, " & ").replace(/\s+/g, " ").trim());
                        out.push(phrase.replace(/\s+and\s+/g, " ").replace(/\s+/g, " ").trim());
                    }
                    return out;
                }, [])
                .filter((phrase) => phrase.length >= 2);
            phrases.forEach((phrase) => {
                const padded = ` ${phrase} `;
                const compactPhrase = phrase.replace(/\s+/g, "");
                const sortedPhrase = this.sortedPhraseKey(phrase);
                const sortedQuestion = this.sortedPhraseKey(queryText || "");
                const sortedCompactPhrase = this.sortedCompactPhraseKey(phrase);
                const sortedCompactQuestion = this.sortedCompactPhraseKey(queryText || "");
                if (entity.kind === "zone" && /^zone\s+\d+\b/.test(phrase) && question.indexOf(padded) < 0) return;
                if (entity.kind === "bookmark") {
                    if (question.indexOf(padded) >= 0) {
                        candidates.push({ entity, phrase, length: phrase.length });
                    }
                    return;
                }
                if (question.indexOf(padded) >= 0 || sortedPhrase === sortedQuestion || sortedCompactPhrase === sortedCompactQuestion || (compactPhrase.length >= 5 && compactQuestion.indexOf(compactPhrase) >= 0)) {
                    candidates.push({ entity, phrase, length: phrase.length });
                }
            });
        });
        candidates.sort((a, b) => b.length - a.length || kindRank(a.entity.kind) - kindRank(b.entity.kind) || a.entity.label.localeCompare(b.entity.label));
        const out: AssistantEntity[] = [];
        for (const candidate of candidates) {
            if (out.some((entity) => entity.id === candidate.entity.id && entity.kind === candidate.entity.kind)) continue;
            out.push(candidate.entity);
        }
        return out.slice(0, 8);
    }

    private mergeEntities(primary: AssistantEntity[], secondary: AssistantEntity[], includeSecondaryWhenPrimary: boolean = false): AssistantEntity[] {
        const out: AssistantEntity[] = [];
        const exactIds = new Set(primary.map((entity) => `${entity.kind}:${entity.id}`));
        primary.concat(secondary).forEach((entity) => {
            if (out.some((item) => item.id === entity.id && item.kind === entity.kind)) return;
            if (exactIds.size > 0 && !includeSecondaryWhenPrimary && !exactIds.has(`${entity.kind}:${entity.id}`)) return;
            const label = entity.label.toLowerCase();
            const shadowed = !includeSecondaryWhenPrimary && out.some((item) => {
                const existing = item.label.toLowerCase();
                return existing.length > label.length && existing.indexOf(label) >= 0;
            });
            if (!shadowed) out.push(entity);
        });
        return out;
    }

    private getDidYouMean(
        exactEntities: AssistantEntity[],
        fuzzyEntityMatches: Array<{ item: AssistantEntity; score: number }>
    ): string | undefined {
        if (exactEntities.length || !fuzzyEntityMatches.length) return undefined;
        const first = fuzzyEntityMatches[0];
        if (!first || first.score <= 0.02) return undefined;
        return first.item.label;
    }

    private normalizedQuestionContains(parsed: ParsedAssistantQuestion, phrase: string): boolean {
        const cleanPhrase = this.normalizeOverrideText(phrase);
        if (!cleanPhrase.trim()) return false;
        const question = this.normalizeOverrideText(`${parsed.raw || ""} ${parsed.normalized || ""}`);
        return question.indexOf(cleanPhrase) >= 0;
    }

    private buildDisabledDictionaryGate(parsed: ParsedAssistantQuestion, baseConfidence: AssistantConfidence): AssistantResponse | null {
        const dataDictionary = this.context.dataDictionary;
        if (!dataDictionary) return null;
        const disabledMeasures = (dataDictionary.measures || []).filter((item) => item.enabled === false);
        const disabledFields = (dataDictionary.fields || []).filter((item) => item.enabled === false);
        const findMention = (labels: string[]): string | null => {
            const ranked = labels
                .map((label) => String(label || "").trim())
                .filter(Boolean)
                .sort((a, b) => b.length - a.length);
            return ranked.find((label) => this.normalizedQuestionContains(parsed, label)) || null;
        };
        for (const measure of disabledMeasures) {
            const label = findMention([measure.displayName || "", measure.actualName || ""].concat(measure.synonyms || []));
            if (!label) continue;
            const suggestions = this.getMetricSuggestions(5);
            return {
                handled: true,
                text: `"${label}" is disabled for AI chat. Enable it in AI Data Dictionary or choose another metric.`,
                suggestions,
                confidence: {
                    ...baseConfidence,
                    overallConfidence: Math.min(baseConfidence.overallConfidence, 0.62),
                    metricConfidence: Math.min(baseConfidence.metricConfidence, 0.45),
                    reasons: (baseConfidence.reasons || []).concat(["disabled_dictionary_measure"])
                }
            };
        }
        for (const field of disabledFields) {
            const label = findMention([field.displayName || "", field.actualName || ""].concat(field.synonyms || []));
            if (!label) continue;
            const suggestions = this.knownMatrixFields().slice(0, 5).map((item) => item.name);
            return {
                handled: true,
                text: `"${label}" is disabled for AI chat. Enable it in AI Data Dictionary or choose another field.`,
                suggestions,
                confidence: {
                    ...baseConfidence,
                    overallConfidence: Math.min(baseConfidence.overallConfidence, 0.62),
                    entityConfidence: Math.min(baseConfidence.entityConfidence, 0.45),
                    reasons: (baseConfidence.reasons || []).concat(["disabled_dictionary_field"])
                }
            };
        }
        return null;
    }

    private buildExactMetricAmbiguityGate(
        parsed: ParsedAssistantQuestion,
        metrics: AssistantMetric[],
        baseConfidence: AssistantConfidence
    ): AssistantResponse | null {
        if (!metrics.length) return null;
        const rawQuestion = this.normalizeOverrideText(`${parsed.raw || ""} ${parsed.normalized || ""}`);
        const areaMentioned = rawQuestion.indexOf(this.normalizeOverrideText("area")) >= 0;
        const explicitSumOfArea = rawQuestion.indexOf(this.normalizeOverrideText("sum of area")) >= 0
            || rawQuestion.indexOf(this.normalizeOverrideText("total area")) >= 0;
        if (!areaMentioned || explicitSumOfArea) return null;
        const area = this.context.metrics.find((metric) => this.normalizeOverrideText(metric.name) === this.normalizeOverrideText("Area"));
        const sumOfArea = this.context.metrics.find((metric) => this.normalizeOverrideText(metric.name) === this.normalizeOverrideText("Sum of Area"));
        if (!area || !sumOfArea) return null;
        const resolvedKeys = new Set(metrics.map((metric) => metric.key));
        if (!resolvedKeys.has(area.key) || !resolvedKeys.has(sumOfArea.key)) return null;
        const suggestions = [sumOfArea.name, area.name];
        return {
            handled: true,
            text: "Which area metric should I use?",
            suggestions,
            confidence: {
                ...baseConfidence,
                overallConfidence: Math.min(baseConfidence.overallConfidence, 0.58),
                metricConfidence: Math.min(baseConfidence.metricConfidence, 0.4),
                matchedMetric: "Area / Sum of Area",
                reasons: (baseConfidence.reasons || []).concat(["metric_name_overlap"])
            }
        };
    }

    private buildExactEntityKindAmbiguityGate(
        parsed: ParsedAssistantQuestion,
        exactEntities: AssistantEntity[],
        baseConfidence: AssistantConfidence
    ): AssistantResponse | null {
        if (exactEntities.length < 2) return null;
        const question = this.normalizeOverrideText(`${parsed.raw || ""} ${parsed.normalized || ""}`);
        const kindWords = ["tenant", "tenants", "unit", "units", "category", "categories", "group", "groups", "zone", "zones", "floor", "floors", "layer", "layers"];
        const explicitlyNamedKind = kindWords.some((word) => question.indexOf(this.normalizeOverrideText(word)) >= 0);
        if (explicitlyNamedKind) return null;
        const byLabel = new Map<string, AssistantEntity[]>();
        exactEntities.forEach((entity) => {
            const key = this.normalizeOverrideText(entity.label);
            if (!key.trim()) return;
            const list = byLabel.get(key) || [];
            list.push(entity);
            byLabel.set(key, list);
        });
        for (const entities of Array.from(byLabel.values())) {
            const kinds = Array.from(new Set(entities.map((entity) => entity.kind)));
            if (kinds.length < 2) continue;
            const label = entities[0].label;
            const suggestions = kinds.slice(0, 5).map((kind) => `${label} ${kind}`);
            return {
                handled: true,
                text: `I found "${label}" as ${kinds.join(" and ")}. Which one should I use?`,
                suggestions,
                confidence: {
                    ...baseConfidence,
                    overallConfidence: Math.min(baseConfidence.overallConfidence, 0.55),
                    entityConfidence: Math.min(baseConfidence.entityConfidence, 0.38),
                    matchedEntity: label,
                    reasons: (baseConfidence.reasons || []).concat(["entity_kind_ambiguous"])
                }
            };
        }
        return null;
    }

    private buildMetricConfidenceGate(
        parsed: ParsedAssistantQuestion,
        phrases: string[],
        matches: Array<AssistantMatch<AssistantMetric>>
    ): AssistantResponse | null {
        const phrase = (phrases || [])
            .map((item) => String(item || "").trim())
            .find((item) => item && !/^(metric|measure|field|value|amount)$/i.test(item));
        if (!phrase) return null;
        if (/\b(area|sum of area|sqm|m2|units?|sales|revenue|turnover|rent|ocr|occupancy|vacancy|vacant|occupied)\b/i.test(phrase)
            && matches.length) return null;
        const first = matches[0];
        const second = matches[1];
        const weak = !first || first.score > 0.34;
        const ambiguous = !!first && !!second && first.score > 0.12 && Math.abs(first.score - second.score) <= 0.045;
        if (!weak && !ambiguous) return null;
        const suggestions = matches.length
            ? matches.slice(0, 5).map((match) => match.item.name)
            : this.getMetricSuggestions(5);
        const metricConfidence = this.matchScoreToConfidence(first?.score, 0.34, second?.score);
        const choiceText = suggestions.length >= 2 && suggestions.length <= 3
            ? `Did you mean ${suggestions.slice(0, -1).join(", ")} or ${suggestions[suggestions.length - 1]}?`
            : "Which metric did you mean?";
        return {
            handled: true,
            text: `I'm not fully sure what field you mean by "${phrase}". ${choiceText}`,
            suggestions,
            confidence: this.makeConfidence(parsed, {
                metricConfidence,
                entityConfidence: 1,
                reasons: [weak ? "metric_match_weak" : "metric_match_ambiguous"],
                matchedMetric: first?.item.name
            })
        };
    }

    private buildEntityConfidenceGate(
        parsed: ParsedAssistantQuestion,
        exactEntities: AssistantEntity[],
        fuzzyEntityMatches: Array<AssistantMatch<AssistantEntity>>,
        confidentCount: number
    ): AssistantResponse | null {
        if (exactEntities.length || confidentCount > 0) return null;
        const expectsEntity = parsed.intent === "lookup"
            || parsed.intent === "compare"
            || parsed.intent === "summary"
            || parsed.intent === "list"
            || !!(parsed.explicitEntityPhrases || []).length
            || !!(parsed.compareEntityPhrases || []).length;
        if (!expectsEntity || !fuzzyEntityMatches.length) return null;
        const first = fuzzyEntityMatches[0];
        const second = fuzzyEntityMatches[1];
        const weak = !first || first.score > 0.28;
        const ambiguous = !!first && !!second && Math.abs(first.score - second.score) <= 0.04;
        if (!weak && !ambiguous) return null;
        const suggestions = fuzzyEntityMatches.slice(0, 5).map((match) => match.item.label);
        const entityConfidence = this.matchScoreToConfidence(first?.score, 0.28, second?.score);
        return {
            handled: true,
            text: "I'm not fully sure what field or item you mean. Did you mean one of these?",
            suggestions,
            confidence: this.makeConfidence(parsed, {
                metricConfidence: 1,
                entityConfidence,
                reasons: [weak ? "entity_match_weak" : "entity_match_ambiguous"],
                matchedEntity: first?.item.label
            })
        };
    }

    private getWeakDidYouMean(
        exactEntities: AssistantEntity[],
        fuzzyEntityMatches: Array<{ item: AssistantEntity; score: number }>,
        confidentCount: number
    ): string | undefined {
        if (exactEntities.length || confidentCount > 0 || !fuzzyEntityMatches.length) return undefined;
        const first = fuzzyEntityMatches[0];
        if (!first || first.score > 0.42) return undefined;
        return first.item.label;
    }

    private getConfidentEntityMatches(
        intent: string,
        exactEntities: AssistantEntity[],
        fuzzyEntityMatches: Array<{ item: AssistantEntity; score: number }>
    ): Array<{ item: AssistantEntity; score: number }> {
        if (exactEntities.length) return fuzzyEntityMatches;
        const threshold = intent === "compare" ? 0.2 : 0.24;
        const best = fuzzyEntityMatches[0];
        return fuzzyEntityMatches.filter((match, index) => {
            if (match.score <= 0.08) return true;
            if (match.score > threshold) return false;
            if (!best) return false;
            if (index === 0) return true;
            return Math.abs(match.score - best.score) <= 0.08;
        });
    }

    private shouldAskToClarify(
        exactEntities: AssistantEntity[],
        fuzzyEntityMatches: Array<{ item: AssistantEntity; score: number }>
    ): boolean {
        if (exactEntities.length || fuzzyEntityMatches.length < 2) return false;
        const first = fuzzyEntityMatches[0];
        const second = fuzzyEntityMatches[1];
        if (!first || !second) return false;
        if (first.score > 0.28) return true;
        return Math.abs(first.score - second.score) <= 0.035;
    }

    private matchScoreToConfidence(score: number | undefined, weakThreshold: number, secondScore?: number): number {
        if (!Number.isFinite(score as number)) return 0.2;
        let confidence = 1 - ((score as number) / Math.max(0.01, weakThreshold)) * 0.65;
        if (Number.isFinite(secondScore as number)) {
            const gap = Math.abs((secondScore as number) - (score as number));
            if (gap <= 0.035) confidence -= 0.22;
            else if (gap <= 0.07) confidence -= 0.1;
        }
        return clampConfidence(confidence);
    }

    private normalizeFieldResolutionText(value: string): string {
        return String(value || "")
            .toLowerCase()
            .replace(/&/g, " and ")
            .replace(/[^a-z0-9/]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    private fieldEditDistance(a: string, b: string, maxDistance: number): number {
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
                const value = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
                cur[j] = value;
                if (value < rowMin) rowMin = value;
            }
            if (rowMin > maxDistance) return maxDistance + 1;
            const swap = prev;
            prev = cur;
            cur = swap;
        }
        return prev[b.length];
    }

    private fuzzyFieldScore(clean: string, label: string): number {
        const normalized = this.normalizeFieldResolutionText(label);
        if (!clean || !normalized) return 0;
        if (normalized === clean) return 1;
        const compactClean = clean.replace(/\s+/g, "");
        const compactLabel = normalized.replace(/\s+/g, "");
        if (compactLabel === compactClean) return 0.96;
        if (normalized.indexOf(clean) >= 0 || clean.indexOf(normalized) >= 0) return 0.84;
        const maxDistance = compactClean.length >= 8 ? 2 : compactClean.length >= 5 ? 1 : 0;
        if (!maxDistance) return 0;
        const distance = this.fieldEditDistance(compactClean, compactLabel, maxDistance);
        if (distance > maxDistance) return 0;
        return distance === 1 ? 0.82 : 0.74;
    }

    private resolutionStatus(confidence: number): AssistantFieldResolution["status"] {
        if (confidence >= 0.78) return "resolved";
        if (confidence >= 0.55) return "ambiguous";
        return "missing";
    }

    private hasFieldAllowList(): boolean {
        return !!this.context.dataDictionary && Array.isArray(this.context.dataDictionary.fields);
    }

    private allowedFieldLabelSet(): Set<string> {
        const out = new Set<string>();
        if (!this.hasFieldAllowList()) return out;
        (this.context.dataDictionary?.fields || [])
            .filter((field) => field.enabled !== false)
            .forEach((field) => {
                [field.actualName, field.displayName].concat(field.synonyms || []).forEach((label) => {
                    const clean = this.normalizeOverrideText(label || "");
                    if (clean) out.add(clean);
                });
            });
        return out;
    }

    private isAssistantFieldAllowed(fieldName: string): boolean {
        if (!this.hasFieldAllowList()) return true;
        const clean = this.normalizeOverrideText(fieldName || "");
        if (!clean) return false;
        return this.allowedFieldLabelSet().has(clean);
    }

    private knownMatrixFields(): Array<{ name: string; kind: string; aliases: string[] }> {
        const available = new Set<string>();
        const addAvailable = (value: string) => {
            const clean = this.normalizeOverrideText(value);
            if (clean) available.add(clean);
        };
        (this.context.fieldNames || []).filter((field) => this.isAssistantFieldAllowed(field)).forEach(addAvailable);
        (this.context.rows || []).forEach((row) => {
            Object.keys(row?.filters || {}).filter((field) => this.isAssistantFieldAllowed(field)).forEach(addAvailable);
            if (String(row?.tenant || "").trim() && this.isAssistantFieldAllowed("Assigned Tenant Name")) addAvailable("Assigned Tenant Name");
            if (String(row?.unitId || row?.shapeKey || "").trim() && this.isAssistantFieldAllowed("Unit")) addAvailable("Unit");
            if (String(row?.category || "").trim() && this.isAssistantFieldAllowed("Assigned Sales Category")) addAvailable("Assigned Sales Category");
            if (String(row?.group || "").trim() && this.isAssistantFieldAllowed("Assigned Group")) addAvailable("Assigned Group");
            if ((row?.floors || []).some((floor) => String(floor || "").trim()) && this.isAssistantFieldAllowed("Floor")) addAvailable("Floor");
        });
        (this.context.dataDictionary?.fields || [])
            .filter((field) => field.enabled !== false)
            .forEach((field) => {
                addAvailable(field.actualName || "");
                addAvailable(field.displayName || "");
                (field.synonyms || []).forEach(addAvailable);
            });
        const fieldDefs = [
            { name: "Assigned Tenant Name", kind: "tenant", aliases: ["tenant", "tenants", "tenant name", "brand", "brands", "shop", "shops", "store", "stores"] },
            { name: "Unit", kind: "unit", aliases: ["unit", "units", "unit id", "unit ids", "unit name", "space", "spaces"] },
            { name: "Assigned Sales Category", kind: "category", aliases: ["category", "categories", "sales category", "sales categories", "segment", "segments", "class", "classes", "type", "types"] },
            { name: "Assigned Group", kind: "group", aliases: ["group", "groups", "department", "departments"] },
            { name: "Zone", kind: "zone", aliases: ["zone", "zones", "region", "regions"] },
            { name: "Floor", kind: "floor", aliases: ["floor", "floors", "level", "levels"] },
            { name: "Layer", kind: "layer", aliases: ["layer", "layers"] }
        ];
        const fields = fieldDefs.filter((field) =>
            [field.name].concat(field.aliases || []).some((label) => available.has(this.normalizeOverrideText(label)))
        );
        const addOrMergeField = (name: string, kind: string, aliases: string[]) => {
            const cleanName = String(name || "").trim();
            if (!cleanName) return;
            const existing = fields.find((item) => this.normalizeOverrideText(item.name) === this.normalizeOverrideText(cleanName));
            const cleanAliases = Array.from(new Set((aliases || [])
                .map((alias) => String(alias || "").trim())
                .filter((alias) => !!alias && this.normalizeOverrideText(alias) !== this.normalizeOverrideText(cleanName))));
            if (existing) {
                existing.aliases = Array.from(new Set((existing.aliases || []).concat(cleanAliases)));
                return;
            }
            fields.push({ name: cleanName, kind, aliases: cleanAliases });
        };
        (this.context.dataDictionary?.fields || [])
            .filter((field) => field.enabled !== false)
            .forEach((field) => {
                const actualName = String(field.actualName || field.displayName || "").trim();
                const aliases = [field.displayName || ""].concat(field.synonyms || []);
                addOrMergeField(actualName, this.assistantKindForField([actualName, field.displayName || ""].join(" ")), aliases);
            });
        this.getKnownFilterFieldKeys()
            .filter((field) => !this.isKnownMetricLabel(field))
            .forEach((field) => {
                if (fields.some((item) => this.normalizeOverrideText(item.name) === this.normalizeOverrideText(field))) return;
                fields.push({ name: field, kind: this.assistantKindForField(field), aliases: [] });
            });
        return fields;
    }

    private isKnownMetricLabel(value: string): boolean {
        const clean = this.normalizeOverrideText(value);
        if (!clean) return false;
        return (this.context.metrics || []).some((metric) =>
            [metric.name].concat(metric.aliases || []).some((label) => this.normalizeOverrideText(label) === clean)
        );
    }

    private resolveExactMetricLabels(labels: string[]): AssistantMetric[] {
        const normalizedLabels = (labels || [])
            .map((label) => this.normalizeOverrideText(label))
            .filter((label) => label.trim().length >= 3);
        if (!normalizedLabels.length) return [];
        const out: AssistantMetric[] = [];
        (this.context.metrics || []).forEach((metric) => {
            if (!metric || isDimensionMetric(metric)) return;
            const metricLabels = [metric.name].concat(metric.aliases || [])
                .map((label) => this.normalizeOverrideText(label))
                .filter((label) => label.trim().length >= 3);
            if (!metricLabels.some((metricLabel) => normalizedLabels.some((label) => label === metricLabel))) return;
            if (!out.some((item) => item.key === metric.key)) out.push(metric);
        });
        return out;
    }

    private resolveLockedSelectedMetricTokens(tokens: SelectedAssistantToken[]): AssistantMetric[] {
        const out: AssistantMetric[] = [];
        const exactMetricForSelectedToken = (token: SelectedAssistantToken): AssistantMetric | null => {
            const label = String(token.label || "").trim();
            if (!label) return null;
            if (token.type !== "metric" && this.isKnownMatrixFieldLabel(label)) return null;
            const rawKey = String(token.metricKey || token.id || "").trim().replace(/^metric:/i, "");
            const labelKey = this.normalizeOverrideText(label);
            const candidates = (this.context.metrics || []).filter((metric) => metric && !isDimensionMetric(metric));
            const byName = candidates.find((candidate) => this.normalizeOverrideText(candidate.name || "") === labelKey);
            if (byName) return byName;
            const byKey = rawKey
                ? candidates.find((candidate) => String(candidate.key || "") === rawKey)
                : undefined;
            if (byKey) return byKey;
            return candidates.find((candidate) =>
                (candidate.aliases || []).some((alias) => this.normalizeOverrideText(alias || "") === labelKey)
            ) || null;
        };
        const tokenMetrics = (tokens || [])
            .map((token) => ({ token, metric: exactMetricForSelectedToken(token) }))
            .filter((item): item is { token: SelectedAssistantToken; metric: AssistantMetric } => !!item.metric);
        const hasNonFieldMetricToken = tokenMetrics.some(({ token }) =>
            !this.isKnownMatrixFieldLabel(token.label || "")
        );
        tokenMetrics
            .forEach(({ token, metric }) => {
                const label = String(token.label || "").trim();
                if (hasNonFieldMetricToken && this.isKnownMatrixFieldLabel(label)) return;
                if (!metric || isDimensionMetric(metric) || out.some((item) => item.key === metric.key)) return;
                const displayMetric = label && this.normalizeOverrideText(label) !== this.normalizeOverrideText(metric.name || "")
                    ? { ...metric, name: label, aliases: Array.from(new Set([metric.name].concat(metric.aliases || []))).filter(Boolean) }
                    : metric;
                out.push(displayMetric);
            });
        return out.slice(0, 30);
    }

    private resolveExactMetricsInText(text: string): AssistantMetric[] {
        const normalizedText = this.normalizeOverrideText(text);
        if (!normalizedText.trim()) return [];
        const out: AssistantMetric[] = [];
        (this.context.metrics || []).forEach((metric) => {
            if (!metric || isDimensionMetric(metric)) return;
            const labels = [metric.name].concat(metric.aliases || [])
                .map((label) => this.normalizeOverrideText(label))
                .filter((label) => label.trim().length >= 3)
                .sort((a, b) => b.length - a.length);
            if (!labels.some((label) => normalizedText.indexOf(label) >= 0)) return;
            if (!out.some((item) => item.key === metric.key)) out.push(metric);
        });
        return out;
    }

    private dropContainedMetricNameMatches(metrics: AssistantMetric[]): AssistantMetric[] {
        if ((metrics || []).length <= 1) return metrics || [];
        const labelSets = (metrics || []).map((metric) => {
            const labels = [metric.name].concat(metric.aliases || [])
                .map((label) => this.normalizeOverrideText(label || ""))
                .filter((label) => label.length >= 3);
            return { metric, labels };
        });
        return labelSets
            .filter(({ metric, labels }) => {
                const ownPrimary = this.normalizeOverrideText(metric.name || "");
                if (!ownPrimary) return false;
                return !labelSets.some((other) => {
                    if (other.metric.key === metric.key) return false;
                    const otherPrimary = this.normalizeOverrideText(other.metric.name || "");
                    if (otherPrimary.length <= ownPrimary.length) return false;
                    return other.labels.some((otherLabel) =>
                        labels.some((label) => otherLabel !== label && otherLabel.indexOf(label) >= 0)
                    );
                });
            })
            .map((item) => item.metric);
    }

    private preferMetricsNamedInQuestion(metrics: AssistantMetric[], question: string): AssistantMetric[] {
        if (metrics.length <= 1) return metrics;
        const normalizedQuestion = ` ${this.normalizeOverrideText(question)} `;
        const named = metrics.filter((metric) => {
            const name = this.normalizeOverrideText(metric.name || "");
            return !!name && normalizedQuestion.indexOf(` ${name} `) >= 0;
        });
        if (!named.length) return metrics;
        return named.filter((metric) => {
            const name = this.normalizeOverrideText(metric.name || "");
            if (!name) return false;
            return !named.some((other) => {
                if (other.key === metric.key) return false;
                const otherName = this.normalizeOverrideText(other.name || "");
                return otherName.length > name.length && (` ${otherName} `).indexOf(` ${name} `) >= 0;
            });
        });
    }

    private assistantFieldRoleAllowed(field: string, role: "row" | "column" | "filter" | "mention"): boolean {
        const configured = (this.context.dataDictionary?.fields || []).filter((item) => item.enabled !== false);
        if (!configured.length) return true;
        const clean = this.normalizeOverrideText(field);
        const match = configured.find((item) =>
            [item.actualName, item.displayName].concat(item.synonyms || [])
                .filter(Boolean)
                .some((label) => this.normalizeOverrideText(String(label)) === clean)
        );
        if (!match) return false;
        return (match.roles || []).indexOf(role) >= 0;
    }

    private matrixDimensionDistinctCount(phrase: string): number {
        const clean = this.normalizeFieldResolutionText(phrase);
        const values = new Set<string>();
        const add = (value: string) => {
            const cleanValue = String(value || "").trim();
            if (!cleanValue || /^n\/a$|^na$|^none$|^null$|^undefined$|^-$/i.test(cleanValue)) return;
            values.add(cleanValue.toLowerCase());
        };
        if (/\btenant|brand|shop|store|retailer\b/.test(clean)) {
            (this.context.rows || []).forEach((row) => add(row?.tenant || ""));
            return values.size;
        }
        if (/\bunit|space|location\b/.test(clean)) {
            (this.context.rows || []).forEach((row) => add(row?.unitId || row?.shapeKey || ""));
            return values.size;
        }
        if (/\bcategory|segment|class|type\b/.test(clean)) {
            (this.context.rows || []).forEach((row) => add(row?.category || ""));
            return values.size;
        }
        if (/\bgroup|department\b/.test(clean)) {
            (this.context.rows || []).forEach((row) => add(row?.group || ""));
            return values.size;
        }
        if (/\bfloor|level\b/.test(clean)) {
            (this.context.rows || []).forEach((row) => (row?.floors || []).forEach(add));
            return values.size;
        }
        if (/\bzone|region\b/.test(clean)) {
            (this.context.entities || []).filter((entity) => entity.kind === "zone").forEach((entity) => add(entity.label));
            return values.size;
        }
        const filterField = this.getKnownFilterFieldKeys().find((field) => {
            const normalized = this.normalizeFieldResolutionText(field);
            return normalized === clean || normalized.replace(/\s+/g, "") === clean.replace(/\s+/g, "");
        });
        if (filterField) (this.context.rows || []).forEach((row) => add((row?.filters || {})[filterField]));
        return values.size || 1;
    }

    private applyAutoMatrixAxes(parsed: ParsedAssistantQuestion): void {
        const matrix = parsed.matrix;
        if (!matrix?.autoAxes) return;
        const dimensions = Array.from(new Set((matrix.rows || []).concat(matrix.columns || []).map((value) => String(value || "").trim()).filter(Boolean)));
        if (dimensions.length < 2) return;
        const scored = dimensions.map((phrase, index) => ({
            phrase,
            index,
            count: this.matrixDimensionDistinctCount(phrase)
        }));
        const row = scored.slice().sort((a, b) => b.count - a.count || a.index - b.index)[0];
        if (!row) return;
        const rows = [row.phrase];
        const columns = scored.filter((item) => item.phrase !== row.phrase).sort((a, b) => a.index - b.index).map((item) => item.phrase);
        matrix.rows = rows;
        matrix.rowPhrases = rows;
        matrix.columns = columns;
        matrix.columnPhrases = columns;
    }

    private explicitMatrixFieldMentions(raw: string): string[] {
        const text = String(raw || "").toLowerCase().replace(/[?!.:,;()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
        const specs: Array<{ field: string; re: RegExp }> = [
            { field: "Assigned Tenant Name", re: /\b(?:assigned\s+tenant\s+name|assigned\s+tenant|tenant\s+names?|tenants?|brands?|shops?|stores?)\b/g },
            { field: "Unit", re: /\b(?:combined\s+units?|unit\s+ids?|unit\s+names?|units?|spaces?)\b/g },
            { field: "Assigned Sales Category", re: /\b(?:assigned\s+sales\s+categor(?:y|ies)|sales\s+categor(?:y|ies)|categor(?:y|ies)|segment|class|type)\b/g },
            { field: "Assigned Group", re: /\b(?:assigned\s+groups?|groups?|departments?)\b/g },
            { field: "Zone", re: /\b(?:zones?|regions?)\b/g },
            { field: "Floor", re: /\b(?:floors?|levels?|ground\s+floor|first\s+floor|second\s+floor)\b/g },
            { field: "Layer", re: /\b(?:layers?)\b/g }
        ];
        const matches: Array<{ field: string; index: number }> = [];
        specs.forEach((spec) => {
            Array.from(text.matchAll(spec.re)).forEach((match) => {
                matches.push({ field: spec.field, index: Number(match.index || 0) });
            });
        });
        const seen = new Set<string>();
        return matches
            .sort((a, b) => a.index - b.index)
            .map((match) => match.field)
            .filter((field) => {
                const key = this.normalizeOverrideText(field);
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
    }

    private enforceExplicitMatrixFields(parsed: ParsedAssistantQuestion): void {
        const matrix = parsed.matrix;
        if (!matrix) return;
        const raw = parsed.raw || parsed.normalized || "";
        if (!/\bas\s+(?:rows?|columns?|cols?)\b|\b(?:rows?|columns?|cols?)\s*:/i.test(raw)) return;
        const mentions = this.explicitMatrixFieldMentions(raw);
        if (!mentions.length) return;
        const clean = (value: string) => this.normalizeOverrideText(value);
        const current = new Set((matrix.rows || []).concat(matrix.columns || []).map(clean).filter(Boolean));
        const mentioned = mentions.map(clean).filter(Boolean);
        const hasMissingMention = mentioned.some((field) => !current.has(field));
        const firstMention = mentions[0];
        const firstCurrentRow = (matrix.rows || [])[0] || "";
        const shouldReplaceDefaultRow = firstMention
            && firstCurrentRow
            && clean(firstCurrentRow) !== clean(firstMention)
            && !mentioned.includes(clean(firstCurrentRow))
            && (matrix.rows || []).length === 1
            && !(matrix.columns || []).length;
        if (!hasMissingMention && !shouldReplaceDefaultRow) return;

        const rows = [firstMention].filter(Boolean);
        const columns = mentions.slice(1).filter((field) => clean(field) !== clean(firstMention));
        matrix.rows = rows;
        matrix.rowPhrases = rows;
        matrix.columns = columns;
        matrix.columnPhrases = columns;
        if (matrix.query) {
            matrix.query.rows = rows;
            matrix.query.columns = columns;
        }
        if (parsed.requestedFields) {
            parsed.requestedFields.rows = rows;
            parsed.requestedFields.columns = columns;
        }
    }

    private resolveDimensionFieldSlot(role: "row" | "column", phrase: string): AssistantFieldResolution {
        const clean = this.normalizeFieldResolutionText(phrase);
        const fields = this.knownMatrixFields();
        const scored = fields
            .map((field) => {
                const labels = [field.name].concat(field.aliases || []);
                const best = labels.reduce((score, label) => {
                    return Math.max(score, this.fuzzyFieldScore(clean, label));
                }, 0);
                return { field, score: best };
            })
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score || a.field.name.localeCompare(b.field.name));
        const best = scored[0];
        const second = scored[1];
        const confidence = best ? (second && Math.abs(best.score - second.score) < 0.1 ? Math.min(best.score, 0.7) : best.score) : 0.2;
        return {
            role,
            phrase,
            status: this.resolutionStatus(confidence),
            confidence: clampConfidence(confidence),
            matchedName: best?.field.name,
            matchedKind: best?.field.kind,
            suggestions: scored.slice(0, 4).map((item) => item.field.name)
        };
    }

    private resolveMetricFieldSlot(role: "value" | "metric", phrase: string): AssistantFieldResolution {
        const matches = this.matcher.matchMetrics([phrase], 4);
        const best = matches[0];
        const confidence = best ? this.matchScoreToConfidence(best.score, 0.34, matches[1]?.score) : 0.2;
        return {
            role,
            phrase,
            status: this.resolutionStatus(confidence),
            confidence,
            matchedName: best?.item.name,
            matchedKind: best?.item.kind,
            suggestions: matches.slice(0, 4).map((match) => match.item.name)
        };
    }

    private resolveEntityFieldSlot(phrase: string): AssistantFieldResolution {
        const clean = this.normalizeFieldResolutionText(phrase);
        const exact = (this.context.entities || []).find((entity) =>
            [entity.label].concat(entity.aliases || []).some((label) => this.normalizeFieldResolutionText(label) === clean)
        );
        if (exact) {
            return { role: "entity", phrase, status: "resolved", confidence: 1, matchedName: exact.label, matchedKind: exact.kind, suggestions: [exact.label] };
        }
        const matches = this.matcher.matchEntities([phrase], 4);
        const best = matches[0];
        const confidence = best ? this.matchScoreToConfidence(best.score, 0.28, matches[1]?.score) : 0.2;
        return {
            role: "entity",
            phrase,
            status: this.resolutionStatus(confidence),
            confidence,
            matchedName: best?.item.label,
            matchedKind: best?.item.kind,
            suggestions: matches.slice(0, 4).map((match) => match.item.label)
        };
    }

    private resolveFilterFieldSlot(phrase: string): AssistantFieldResolution {
        const cleanPhrase = String(phrase || "").replace(/^(?:include|exclude|only|just|floor|near)\s+/i, "").trim();
        const entityResolution = this.resolveEntityFieldSlot(cleanPhrase);
        if (entityResolution.status !== "missing") return { ...entityResolution, role: "filter", phrase };
        const fieldResolution = this.resolveDimensionFieldSlot("row", cleanPhrase);
        return { ...fieldResolution, role: "filter", phrase };
    }

    private resolveRequestedFields(parsed: ParsedAssistantQuestion): AssistantFieldResolution[] {
        const slots = parsed.requestedFields;
        if (!slots) return [];
        const out: AssistantFieldResolution[] = [];
        (slots.rows || []).forEach((phrase) => out.push(this.resolveDimensionFieldSlot("row", phrase)));
        (slots.columns || []).forEach((phrase) => out.push(this.resolveDimensionFieldSlot("column", phrase)));
        (slots.values || []).forEach((phrase) => out.push(this.resolveMetricFieldSlot("value", phrase)));
        (slots.metrics || [])
            .filter((phrase) => !(slots.values || []).some((value) => this.normalizeFieldResolutionText(value) === this.normalizeFieldResolutionText(phrase)))
            .forEach((phrase) => out.push(this.resolveMetricFieldSlot("metric", phrase)));
        (slots.entities || []).forEach((phrase) => out.push(this.resolveEntityFieldSlot(phrase)));
        (slots.filters || []).forEach((phrase) => out.push(this.resolveFilterFieldSlot(phrase)));
        return out;
    }

    private intentConfidence(parsed: ParsedAssistantQuestion, semanticReason?: string): number {
        if (!parsed.normalized) return 0;
        if (parsed.detectedIntent) return clampConfidence(Math.min(parsed.detectedIntent.confidence, parsed.intent === "unknown" ? 0.25 : 1));
        if (parsed.intent === "unknown") return 0.25;
        if (parsed.topBottom || parsed.matrix || parsed.crossMetric || parsed.metricThreshold || parsed.breakdown) return clampConfidence(semanticReason ? 0.88 : 0.94);
        if (semanticReason && semanticReason !== "typo_correction") return 0.86;
        if (/\b(top|bottom|highest|lowest|largest|smallest|compare|vs|formula|trend|list|summary|summarize|why|explain|filter)\b/i.test(parsed.normalized)) return 0.86;
        if ((parsed.metricPhrases || []).length || (parsed.entityPhrases || []).length) return 0.72;
        return 0.55;
    }

    private makeConfidence(
        parsed: ParsedAssistantQuestion,
        options: {
            intentConfidence?: number;
            metricConfidence?: number;
            entityConfidence?: number;
            matchedMetric?: string;
            matchedEntity?: string;
            fieldResolutions?: AssistantFieldResolution[];
            reasons?: string[];
        }
    ): AssistantConfidence {
        const intentConfidence = clampConfidence(options.intentConfidence ?? this.intentConfidence(parsed));
        const metricConfidence = clampConfidence(options.metricConfidence ?? 1);
        const entityConfidence = clampConfidence(options.entityConfidence ?? 1);
        const fieldResolutions = options.fieldResolutions || parsed.fieldResolutions || [];
        const fieldConfidence = fieldResolutions.length
            ? Math.min(...fieldResolutions.map((resolution) => resolution.confidence))
            : 1;
        const overallConfidence = clampConfidence(Math.min(intentConfidence, metricConfidence, entityConfidence, fieldConfidence));
        return {
            intentConfidence,
            metricConfidence,
            entityConfidence,
            overallConfidence,
            intent: parsed.intent,
            matchedMetric: options.matchedMetric,
            matchedEntity: options.matchedEntity,
            fieldResolutions,
            reasons: Array.from(new Set(options.reasons || [])).filter(Boolean)
        };
    }

    private buildAnswerConfidence(
        parsed: ParsedAssistantQuestion,
        semanticReason: string | undefined,
        hasMetricOverride: boolean,
        hasEntityOverride: boolean,
        metricPhrases: string[],
        metricMatches: Array<AssistantMatch<AssistantMetric>>,
        metrics: AssistantMetric[],
        exactEntities: AssistantEntity[],
        fuzzyEntityMatches: Array<AssistantMatch<AssistantEntity>>,
        confidentFuzzyEntityMatches: Array<AssistantMatch<AssistantEntity>>,
        entities: AssistantEntity[]
    ): AssistantConfidence {
        const reasons: string[] = [];
        if (semanticReason) reasons.push(semanticReason);
        const metricNeeded = !!(metricPhrases || []).length
            || parsed.intent === "rank"
            || parsed.intent === "compare"
            || parsed.intent === "lookup"
            || !!parsed.topBottom
            || !!parsed.metricThreshold
            || !!parsed.crossMetric
            || !!parsed.matrix;
        const entityNeeded = parsed.intent === "lookup"
            || parsed.intent === "compare"
            || parsed.intent === "summary"
            || parsed.intent === "filter"
            || !!(parsed.explicitEntityPhrases || []).length
            || !!(parsed.compareEntityPhrases || []).length;

        const metricConfidence = hasMetricOverride
            ? 1
            : metrics.length && metricMatches.length
            ? this.matchScoreToConfidence(metricMatches[0]?.score, 0.34, metricMatches[1]?.score)
            : metrics.length && !metricNeeded
            ? 0.72
            : metrics.length
            ? 0.65
            : metricNeeded
            ? 0.25
            : 1;
        const entityConfidence = hasEntityOverride || exactEntities.length
            ? 1
            : confidentFuzzyEntityMatches.length
            ? this.matchScoreToConfidence(fuzzyEntityMatches[0]?.score, 0.28, fuzzyEntityMatches[1]?.score)
            : entities.length
            ? 0.7
            : entityNeeded
            ? 0.25
            : 1;
        if (metricConfidence < 0.55) reasons.push("metric_confidence_low");
        if (entityConfidence < 0.55) reasons.push("entity_confidence_low");
        return this.makeConfidence(parsed, {
            intentConfidence: this.intentConfidence(parsed, semanticReason),
            metricConfidence,
            entityConfidence,
            matchedMetric: metrics[0]?.name,
            matchedEntity: entities[0]?.label,
            fieldResolutions: parsed.fieldResolutions,
            reasons
        });
    }

    private withSuggestions(response: AssistantResponse, suggestions: string[], didYouMean?: string, confidence?: AssistantConfidence): AssistantResponse {
        if (!response.handled) return response;
        const unique = Array.from(new Set((suggestions || []).map((value) => String(value || "").trim()).filter(Boolean))).slice(0, 5);
        const suggestionPayload = unique.length ? { suggestions: unique } : {};
        const didYouMeanPayload = didYouMean ? { didYouMean } : {};
        const confidencePayload = response.confidence || confidence ? { confidence: response.confidence || confidence } : {};
        return { ...response, ...suggestionPayload, ...didYouMeanPayload, ...confidencePayload };
    }

    private buildFieldResolutionGate(parsed: ParsedAssistantQuestion, confidence: AssistantConfidence): AssistantResponse | null {
        if (parsed.intent !== "matrix") return null;
        const weak = (parsed.fieldResolutions || []).find((resolution) =>
            (resolution.role === "row" || resolution.role === "column" || resolution.role === "value")
            && (resolution.status === "missing" || resolution.confidence < 0.55)
        );
        if (!weak) return null;
        const roleText = weak.role === "value" ? "matrix value" : `matrix ${weak.role}`;
        const suggestions = (weak.suggestions || []).filter(Boolean).slice(0, 5);
        return {
            handled: true,
            text: `I couldn't confidently resolve the ${roleText} "${weak.phrase}". Which field did you mean?`,
            suggestions,
            confidence
        };
    }

    private isEntityOnlyQuery(
        parsed: ParsedAssistantQuestion,
        metrics: AssistantMetric[],
        entities: AssistantEntity[]
    ): boolean {
        if (metrics.length > 0) return false;
        if (parsed.explicitMetricPhrase) return false;
        if (parsed.intent !== "lookup") return false;
        if (!entities.length) return false;
        return entities.every((e) => e.kind === "tenant" || e.kind === "unit" || e.kind === "category" || e.kind === "group" || e.kind === "zone" || e.kind === "layer" || e.kind === "floor" || e.kind === "filter" || e.kind === "context");
    }

    private answerRawEntitySelect(parsed: ParsedAssistantQuestion): AssistantResponse | null {
        const raw = String(parsed.raw || parsed.normalized || "").trim();
        if (/^\s*(?:show|display)\b/i.test(raw) && !/\bmap\b/i.test(raw)) return null;
        if (/^\s*(?:show|display)\b/i.test(raw)
            && /\b(?:assigned\s+tenant\s+name|assigned\s+tenant|tenant\s+names?|tenants?|brands?|shops?|stores?|units?|unit\s+names?|unit\s+ids?)\b/i.test(raw)
            && /\b(?:in|inside|within|under|for)\b/i.test(raw)) return null;
        const match = raw.match(/^\s*(?:select|highlight|zoom(?:\s+to)?|focus(?:\s+on)?|show(?:\s+me)?\s+on\s+map)\s+(.+?)\s*$/i);
        if (!match?.[1]) return null;
        const phrase = match[1]
            .replace(/\b(?:on|in)\s+(?:the\s+)?map\b/ig, " ")
            .replace(/[?!.;]+$/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        if (!phrase) return null;
        const exact = this.getExactEntities(phrase, [phrase])
            .filter((entity) => entity.kind !== "context");
        const direct = exact.length ? [] : this.findEntitiesForRawSelection(phrase);
        const fuzzy = exact.length
            ? []
            : this.matcher.matchEntities([phrase], 8)
                .filter((match) => match.score <= 0.24)
                .map((match) => match.item)
                .filter((entity) => entity.kind !== "context");
        const entities = (exact.length ? exact : (direct.length ? direct : fuzzy))
            .filter((entity, index, arr) => arr.findIndex((item) => item.kind === entity.kind && item.id === entity.id) === index);
        if (!entities.length) return null;
        return this.answerEntitySelect({
            ...parsed,
            intent: "lookup",
            normalized: phrase,
            raw: phrase,
            debug: true,
            explicitMetricPhrase: undefined,
            metricPhrases: []
        }, entities);
    }

    private answerBareEntitySelect(parsed: ParsedAssistantQuestion): AssistantResponse | null {
        const raw = String(parsed.raw || parsed.normalized || "").trim();
        if (!raw || raw.length > 80) return null;
        if (/\b(?:show|list|compare|top|bottom|rank|count|how|many|what|which|why|matrix|chart|table|by|with|of|in|for)\b/i.test(raw)) return null;
        if (parsed.explicitMetricPhrase || (parsed.metricPhrases || []).length || parsed.matrix || parsed.topBottom || parsed.crossMetric) return null;
        const entities = this.findEntitiesForRawSelection(raw)
            .filter((entity) => entity.kind === "tenant" || entity.kind === "unit" || entity.kind === "category" || entity.kind === "group" || entity.kind === "zone" || entity.kind === "floor" || entity.kind === "layer" || entity.kind === "filter");
        if (!entities.length) return null;
        return this.answerEntitySelect({
            ...parsed,
            intent: "lookup",
            normalized: raw,
            raw,
            explicitMetricPhrase: undefined,
            metricPhrases: [],
            debug: true
        }, entities);
    }

    private findEntitiesForRawSelection(phrase: string): AssistantEntity[] {
        const wanted = this.normalizeOverrideText(phrase);
        const compactWanted = wanted.replace(/\s+/g, "");
        if (!wanted || compactWanted.length < 3) return [];
        const kindRank = (kind: AssistantEntity["kind"]): number => {
            if (kind === "tenant") return 0;
            if (kind === "unit") return 1;
            if (kind === "category") return 2;
            if (kind === "group") return 3;
            if (kind === "zone") return 4;
            if (kind === "floor") return 5;
            if (kind === "layer") return 6;
            if (kind === "filter") return 7;
            return 8;
        };
        const scored: Array<{ entity: AssistantEntity; score: number; labelLength: number }> = [];
        (this.context.entities || []).forEach((entity) => {
            if (entity.kind === "context" || entity.kind === "bookmark") return;
            const labels = [entity.label].concat(entity.aliases || [])
                .map((label) => this.normalizeOverrideText(label || ""))
                .filter(Boolean);
            let best = 0;
            labels.forEach((label) => {
                const compactLabel = label.replace(/\s+/g, "");
                if (!compactLabel || compactLabel.length < 3) return;
                if (label === wanted || compactLabel === compactWanted) best = Math.max(best, 100);
                else if (label.startsWith(wanted) || compactLabel.startsWith(compactWanted)) best = Math.max(best, 90);
                else if (wanted.length >= 4 && (label.indexOf(wanted) >= 0 || wanted.indexOf(label) >= 0)) best = Math.max(best, 75);
                else if (compactWanted.length >= 4 && (compactLabel.indexOf(compactWanted) >= 0 || compactWanted.indexOf(compactLabel) >= 0)) best = Math.max(best, 70);
            });
            if (best > 0) scored.push({ entity, score: best, labelLength: String(entity.label || "").length });
        });
        return scored
            .sort((a, b) => b.score - a.score || kindRank(a.entity.kind) - kindRank(b.entity.kind) || b.labelLength - a.labelLength || a.entity.label.localeCompare(b.entity.label))
            .map((item) => item.entity)
            .filter((entity, index, arr) => arr.findIndex((item) => item.kind === entity.kind && item.id === entity.id) === index)
            .slice(0, 20);
    }

    private answerEntitySelect(
        parsed: ParsedAssistantQuestion,
        entities: AssistantEntity[]
    ): AssistantResponse {
        const q = String(parsed.normalized || "").replace(/\s+/g, " ").trim();
        const compactQ = q.replace(/\s+/g, "");
        const wantsShowAll = parsed.debug === true || /\b(show|select|highlight|zoom|focus|list)\b/i.test(q) || /\b(all|both|each|every)\b/i.test(q);
        const primaryMatches = entities.filter((e) => {
            const label = String(e.label || "").toLowerCase().replace(/\s+/g, " ").trim();
            return label === q || label.replace(/\s+/g, "") === compactQ;
        });
        const selected = primaryMatches.length > 0 ? primaryMatches : entities;
        if (parsed.hasExplicitSelections) {
            const exactSelected = selected.filter((entity) => {
                const label = String(entity.label || "").toLowerCase().replace(/\s+/g, " ").trim();
                return label === q || label.replace(/\s+/g, "") === compactQ;
            });
            const locked = exactSelected.length ? exactSelected : selected;
            const indices = Array.from(new Set(locked.reduce((out: number[], entity) => out.concat(entity.indices || []), [])));
            return {
                handled: true,
                text: `Selected ${locked.map((entity) => entity.label).join(", ")} in the report.`,
                autoSelectIndices: indices,
                actions: locked.slice(0, 8).map((entity) => ({ kind: "select" as const, label: `Select ${entity.label} in report`, indices: Array.from(new Set(entity.indices || [])) })),
                table: locked.length > 1 ? {
                    columns: ["Name"],
                    rows: locked.map((entity) => [entity.label])
                } : undefined
            };
        }
        const expanded: AssistantEntity[] = [];
        selected.forEach((entity) => {
            const units = entity.kind === "tenant" ? this.unitChoicesForEntity(entity) : [];
            if (units.length > 1) expanded.push(...units);
            else expanded.push(entity);
        });
        const uniqueExpanded = expanded.filter((entity, index, arr) =>
            arr.findIndex((item) => item.kind === entity.kind && item.id === entity.id) === index
        );
        if (selected.length > 1 && !wantsShowAll) {
            return {
                handled: true,
                text: `I found multiple matches for "${q}". Which one did you want to select?`,
                suggestions: selected.slice(0, 5).map((e) => e.label)
            };
        }
        if (uniqueExpanded.length > 1) {
            const indices = Array.from(new Set(uniqueExpanded.reduce((out: number[], entity) => out.concat(entity.indices || []), [])));
            const tableRows = uniqueExpanded.map((entity) => {
                const first = (entity.indices || []).map((idx) => this.context.rows[idx]).filter(Boolean)[0];
                return [
                    entity.label,
                    first?.unitId || first?.shapeKey || "N/A",
                    (first?.floors || []).filter(Boolean).join(", ") || "N/A"
                ];
            });
            return {
                handled: true,
                text: `Selected ${uniqueExpanded.length} match${uniqueExpanded.length !== 1 ? "es" : ""} in the report.`,
                autoSelectIndices: indices,
                actions: uniqueExpanded.slice(0, 8).map((entity) => ({ kind: "select" as const, label: `Select ${entity.label}`, indices: Array.from(new Set(entity.indices || [])) })),
                table: {
                    columns: ["Name"],
                    rows: tableRows.map((row) => [row[0] || ""])
                }
            };
        }
        const entity = uniqueExpanded[0];
        const indices = Array.from(new Set((entity?.indices || [])));
        return {
            handled: true,
            text: `Selected ${entity.label} in the report.`,
            autoSelectIndices: indices,
            actions: indices.length ? [{ kind: "select" as const, label: `Select ${entity.label} in report`, indices }] : []
        };
    }

    answerWithTokens(question: string, selectedTokens: SelectedAssistantToken[]): AssistantResponse {
        const accessBlocked = this.bookmarkMeasureAccessBlockedResponse();
        if (accessBlocked) return accessBlocked;
        if (!selectedTokens.length) return this.answer(question);
        const unresolvedBookmarkMeasure = (selectedTokens || []).find((token) => String(token.id || "").indexOf("bookmark-measures:") === 0);
        if (unresolvedBookmarkMeasure && !this.resolveBookmarkMeasureToken(unresolvedBookmarkMeasure).length) {
            const label = String(unresolvedBookmarkMeasure.label || "").replace(/^#+/, "").trim() || "this bookmark group";
            return {
                handled: true,
                text: `No measures found in #${label}. Add measures to the configured measure group, then try again.`
            };
        }
        const extracted = this.slotExtractor.extract(question);
        const baseParsed = this.shouldUseRawExtractedQuestion(extracted)
            ? this.createParsedFromExtractedQuestion(question, extracted)
            : parseAssistantQuestion(question);
        const parsed = this.applySelectedTokenFilterOverrides(baseParsed, selectedTokens);
        parsed.plannerSource = "slot";
        parsed.hasExplicitSelections = true;
        parsed.detectedIntent = parsed.detectedIntent || {
            intent: parsed.intent,
            confidence: 1,
            reasons: ["selected_tokens"]
        };
        if (this.shouldUseRawExtractedQuestion(extracted)) this.applyExtractedQuestionSlots(parsed, extracted);
        const selectedFieldNamesFromText = (): string[] => {
            const raw = this.normalizeOverrideText(question);
            const fields = this.knownMatrixFields()
                .filter((field) => field.kind === "category" || field.kind === "group" || field.kind === "tenant" || field.kind === "unit" || field.kind === "zone" || field.kind === "floor" || field.kind === "layer" || field.kind === "filter")
                .map((field) => field.name)
                .filter((field, index, arr) => arr.findIndex((candidate) => this.normalizeOverrideText(candidate) === this.normalizeOverrideText(field)) === index);
            return fields.filter((field) => {
                const clean = this.normalizeOverrideText(field);
                if (!clean || raw.indexOf(clean) < 0) return false;
                return !/\b(?:sum|total|average|avg|min|max|earliest|latest)\s+of\s*$/i.test(raw.slice(0, raw.indexOf(clean)));
            });
        };
        const clickedFilterFields = selectedTokens
            .filter((t) => t.type === "filter" && /^filter-field:/i.test(String(t.id || "")))
            .map((t) => String(t.label || t.id.replace(/^filter-field:/i, "")).trim())
            .filter(Boolean)
            .filter((field) => this.isKnownMatrixFieldLabel(field) || !this.isKnownMetricLabel(field))
            .filter((field, index, arr) => arr.findIndex((candidate) => this.normalizeOverrideText(candidate) === this.normalizeOverrideText(field)) === index);
        const selectedTokenFieldName = (token: SelectedAssistantToken): string => {
            const type = String(token.type || "").toLowerCase();
            if (type === "tenant") return "Assigned Tenant Name";
            if (type === "unit") return "Unit";
            if (type === "category") return "Assigned Sales Category";
            if (type === "group") return "Assigned Group";
            if (type === "zone") return "Zone";
            if (type === "floor") return "Floor";
            if (type === "layer") return "Layer";
            return "";
        };
        const hasSelectedNonFieldMetricToken = selectedTokens.some((token) =>
            token.type === "metric" && !this.isKnownMatrixFieldLabel(token.label || "")
        );
        const selectedMetricTokenShouldBehaveAsField = (token: SelectedAssistantToken): boolean =>
            token.type === "metric" && hasSelectedNonFieldMetricToken && this.isKnownMatrixFieldLabel(token.label || "");
        const clickedKnownFields = selectedTokens
            .filter((t) => {
                if (t.type === "function" || t.type === "example") return false;
                if (t.type === "filter" && /^filter-field:/i.test(String(t.id || ""))) return false;
                if (t.type !== "metric") return true;
                const idLabel = String(t.id || "").replace(/^(?:filter-field|field|metric):/i, "");
                return selectedMetricTokenShouldBehaveAsField(t)
                    || this.isKnownMatrixFieldLabel(t.label || "")
                    || this.isKnownMatrixFieldLabel(idLabel);
            })
            .map((t) => {
                const idLabel = String(t.id || "").replace(/^(?:filter-field|field):/i, "");
                return this.canonicalMatrixFieldLabel(t.label || "") || this.canonicalMatrixFieldLabel(idLabel) || selectedTokenFieldName(t) || "";
            })
            .filter(Boolean)
            .filter((field) => this.isKnownMatrixFieldLabel(field) || !this.isKnownMetricLabel(field));
        const clickedSelectedFields = clickedFilterFields
            .concat(clickedKnownFields)
            .filter((field) => this.isKnownMatrixFieldLabel(field) || !this.isKnownMetricLabel(field))
            .filter((field, index, arr) => arr.findIndex((candidate) => this.normalizeOverrideText(candidate) === this.normalizeOverrideText(field)) === index);
        const selectedFilterFields = (clickedSelectedFields.length ? clickedSelectedFields : selectedFieldNamesFromText())
            .filter((field) => this.isKnownMatrixFieldLabel(field) || !this.isKnownMetricLabel(field))
            .filter((field, index, arr) => arr.findIndex((candidate) => this.normalizeOverrideText(candidate) === this.normalizeOverrideText(field)) === index);
        const selectedFieldOrMetricQuestion = selectedFilterFields.length > 0
            || selectedTokens.some((token) => token.type === "metric");
        const earlySelectedMetrics = this.resolveLockedSelectedMetricTokens(selectedTokens)
            .filter((metric) => !this.isKnownMatrixFieldLabel(metric.name || ""));
        const earlyExactTokenMetrics: AssistantMetric[] = [];
        const hasClickedMetric = earlySelectedMetrics.length > 0 || earlyExactTokenMetrics.length > 0;
        const earlyExactTextMetrics = (hasClickedMetric ? [] : this.resolveExactMetricsInText(question))
            .filter((metric) => !earlySelectedMetrics.some((selected) => selected.key === metric.key));
        const earlyEffectiveMetrics = hasClickedMetric
            ? earlySelectedMetrics.concat(earlyExactTokenMetrics)
                .filter((metric, index, arr) => arr.findIndex((item) => item.key === metric.key) === index)
            : this.preferMetricsNamedInQuestion(
                earlySelectedMetrics.concat(earlyExactTokenMetrics).concat(earlyExactTextMetrics)
                    .filter((metric, index, arr) => arr.findIndex((item) => item.key === metric.key) === index),
                question
            );
        if (this.isCardinalityQuestion(question)) {
            const selectedCardinalityFields = selectedFilterFields
                .filter((field, index, arr) => arr.findIndex((candidate) => this.normalizeOverrideText(candidate) === this.normalizeOverrideText(field)) === index);
            const cardinalityQuestion = selectedCardinalityFields.length >= 2
                ? `cardinality ${selectedCardinalityFields.join(" and ")}`
                : question;
            const cardinalityAnswer = this.answerCardinalityQuestion(cardinalityQuestion, selectedCardinalityFields, earlyEffectiveMetrics);
            if (cardinalityAnswer) return this.withSuggestions(cardinalityAnswer, cardinalityAnswer.suggestions || [], undefined);
        }
        const lockedSelected: LockedSelectedTokens = {
            fields: selectedFilterFields.slice(),
            metrics: earlyEffectiveMetrics.slice(),
            entities: []
        };
        const textForcedOutputType = this.explicitOutputTypeFromText(question);
        const forcedOutputType = textForcedOutputType || (selectedTokens.some((token) => token.type === "function" && String(token.id || "").toLowerCase() === "output:table")
            ? "table"
            : selectedTokens.some((token) => token.type === "function" && String(token.id || "").toLowerCase() === "output:matrix")
            ? "matrix"
            : "");
        const selectedValueFilters = this.strictClickedFilterTokens(selectedTokens);
        if (!forcedOutputType && selectedFilterFields.length && !lockedSelected.metrics.length && !selectedValueFilters.length && !this.isCardinalityQuestion(question)) {
            const fieldOnlyAnswer = this.buildFieldValueListAnswer(
                selectedFilterFields,
                (this.context.rows || []).map((row) => row.idx),
                "selected_field_only_value_list"
            );
            if (fieldOnlyAnswer) return this.withSuggestions(fieldOnlyAnswer, fieldOnlyAnswer.suggestions || [], undefined);
        }
        const strictClickedFilterAnswer = this.answerStrictClickedFilters(question, selectedTokens, selectedFilterFields, lockedSelected.metrics, forcedOutputType);
        if (strictClickedFilterAnswer) return strictClickedFilterAnswer;
        if (forcedOutputType === "table" && lockedSelected.fields.length && lockedSelected.metrics.length) {
            const metricNames = lockedSelected.metrics.map((metric) => metric.name).filter(Boolean);
            const selectedMetricLabels = new Set(metricNames.map((metricName) => this.normalizeOverrideText(metricName)));
            const tableFields = lockedSelected.fields
                .filter((field) => !selectedMetricLabels.has(this.normalizeOverrideText(field)))
                .filter((field) => this.isKnownMatrixFieldLabel(field) || !this.isKnownMetricLabel(field));
            if (tableFields.length) {
                this.promoteMeasureWithFieldsToBreakdown(parsed, metricNames, tableFields, [], [
                    "selected_tokens",
                    "selected_token_lock",
                    "preserve_table_edit"
                ]);
                parsed.entityPhrases = [];
                parsed.explicitEntityPhrases = [];
                parsed.compareEntityPhrases = [];
                parsed.filters = undefined;
                return this.withSuggestions(answerFilterFieldBreakdown(this.context, parsed, lockedSelected.metrics[0], tableFields, lockedSelected.metrics.slice(1, 30)), [], undefined, {
                    intentConfidence: 1,
                    metricConfidence: 1,
                    entityConfidence: 1,
                    overallConfidence: 1,
                    intent: "lookup",
                    reasons: ["selected_tokens", "selected_token_lock", "preserve_table_edit"]
                });
            }
        }
        const earlySelectedTokenRankQuestion = /\b(?:top|bottom|highest|lowest|largest|smallest|best|worst|rank)\b/i.test(question);
        if (!forcedOutputType && earlySelectedTokenRankQuestion && lockedSelected.fields.length && lockedSelected.metrics.length) {
            const metricPhrase = lockedSelected.metrics[0].name;
            const dimensionField = lockedSelected.fields[0];
            const dimensionType = this.assistantKindForField(dimensionField);
            parsed.intent = "rank";
            parsed.matrix = undefined;
            parsed.breakdown = undefined;
            parsed.entityPhrases = [];
            parsed.explicitEntityPhrases = [];
            parsed.compareEntityPhrases = [];
            parsed.filters = undefined;
            parsed.topBottom = {
                direction: /\b(?:bottom|lowest|smallest|worst)\b/i.test(question) ? "bottom" : "top",
                limit: parsed.limit || extracted.rank?.limit || 5,
                dimensionType,
                dimensionField: dimensionType === "filter" ? dimensionField : undefined,
                metricPhrase
            };
            parsed.explicitMetricPhrase = metricPhrase;
            parsed.metricPhrases = [metricPhrase];
            parsed.requestedFields = {
                rows: [],
                columns: [],
                values: [metricPhrase],
                metrics: [metricPhrase],
                entities: [dimensionField],
                filters: []
            };
            return this.withSuggestions(this.answer(question, { metrics: lockedSelected.metrics, parsed }), [], undefined, {
                intentConfidence: 1,
                metricConfidence: 1,
                entityConfidence: 1,
                overallConfidence: 1,
                intent: "rank",
                reasons: ["selected_tokens", "selected_token_lock", "locked_rank"]
            });
        }
        if (!earlySelectedTokenRankQuestion && lockedSelected.fields.length && lockedSelected.metrics.length) {
            const metricNames = lockedSelected.metrics.map((metric) => metric.name).filter(Boolean);
            const selectedMetricLabels = new Set(metricNames.map((metricName) => this.normalizeOverrideText(metricName)));
            const strictInputFields = lockedSelected.fields.slice();
            const extractedFields = strictInputFields
                .filter((field) => !selectedMetricLabels.has(this.normalizeOverrideText(field)))
                .filter((field) => this.isKnownMatrixFieldLabel(field) || !this.isKnownMetricLabel(field));
            const selectedFieldKeys = new Set(extractedFields.map((field) => this.normalizeOverrideText(field)));
            const canonicalSelectedAxisFields = (fields: string[] | undefined): string[] => {
                const seen = new Set<string>();
                return (fields || [])
                    .map((field) => this.canonicalMatrixFieldLabel(field) || field)
                    .filter((field) => {
                        const key = this.normalizeOverrideText(field);
                        if (!key || !selectedFieldKeys.has(key) || seen.has(key)) return false;
                        seen.add(key);
                        return true;
                    });
            };
            const explicitRowsFromSlots = extracted.axesExplicit?.rows
                ? canonicalSelectedAxisFields(extracted.axes?.rows)
                : [];
            const explicitColumnsFromSlots = extracted.axesExplicit?.columns
                ? canonicalSelectedAxisFields(extracted.axes?.columns)
                : [];
            const explicitRowsFromParsed = canonicalSelectedAxisFields(parsed.matrix?.rows?.length ? parsed.matrix.rows : parsed.matrix?.rowPhrases);
            const explicitColumnsFromParsed = canonicalSelectedAxisFields(parsed.matrix?.columns?.length ? parsed.matrix.columns : parsed.matrix?.columnPhrases);
            const strictRows = explicitRowsFromSlots.length ? explicitRowsFromSlots : explicitRowsFromParsed;
            const strictColumns = explicitColumnsFromSlots.length ? explicitColumnsFromSlots : explicitColumnsFromParsed;
            const planned = this.planMatrixSlots({
                ...extracted,
                intent: "matrix",
                confidence: 1,
                reasons: ["selected_tokens", "strict_selected_token_matrix"].concat(extracted.reasons || []),
                measures: metricNames,
                fields: extractedFields,
                entities: [],
                axes: { rows: strictRows, columns: strictColumns },
                axesExplicit: { rows: strictRows.length > 0, columns: strictColumns.length > 0 },
                filters: []
            });
            if (!planned && extractedFields.length >= 2 && forcedOutputType !== "matrix") {
                this.promoteMeasureWithFieldsToBreakdown(parsed, metricNames, extractedFields, [], [
                    "selected_tokens",
                    "strict_selected_token_table",
                    "cardinality_table_fallback"
                ]);
                parsed.entityPhrases = [];
                parsed.explicitEntityPhrases = [];
                parsed.compareEntityPhrases = [];
                parsed.filters = undefined;
                return this.withSuggestions(answerFilterFieldBreakdown(this.context, parsed, lockedSelected.metrics[0], extractedFields, lockedSelected.metrics.slice(1, 30)), [], undefined, {
                    intentConfidence: 1,
                    metricConfidence: 1,
                    entityConfidence: 1,
                    overallConfidence: 1,
                    intent: "lookup",
                    reasons: ["selected_tokens", "strict_selected_token_table", "cardinality_table_fallback"]
                });
            }
            const strictFields = extractedFields.length ? extractedFields : selectedFilterFields;
            const fallbackRows = strictFields.slice(0, 5);
            const fallbackColumns = strictFields
                .filter((field) => !fallbackRows.some((row) => this.normalizeOverrideText(row) === this.normalizeOverrideText(field)))
                .filter((field) => this.assistantFieldRoleAllowed(field, "column"))
                .slice(0, 4);
            const plannedColumns = planned?.columns || [];
            const plannedRows = planned?.rows || [];
            const columns = plannedColumns.length
                ? plannedColumns
                : strictColumns.length
                ? strictColumns
                : fallbackColumns;
            const columnKeys = new Set(columns.map((field) => this.normalizeOverrideText(field)));
            const baseRows = (plannedRows.length
                ? plannedRows
                : strictRows.length
                ? strictRows
                : fallbackRows)
                .filter((field) => !columnKeys.has(this.normalizeOverrideText(field)));
            const rowKeys = new Set(baseRows.map((field) => this.normalizeOverrideText(field)));
            const rows = baseRows.concat(strictFields
                .filter((field) => !columnKeys.has(this.normalizeOverrideText(field)))
                .filter((field) => {
                    const key = this.normalizeOverrideText(field);
                    if (!key || rowKeys.has(key)) return false;
                    rowKeys.add(key);
                    return true;
                }))
                .slice(0, 5);
            const values = metricNames;
            const filterTexts = planned?.filterTexts || [];
            const plannedFieldLabels = new Set(rows.concat(columns).map((field) => this.normalizeOverrideText(field)));
            const droppedSelectedField = strictFields.some((field) => !plannedFieldLabels.has(this.normalizeOverrideText(field)));
            if (droppedSelectedField && strictFields.length && forcedOutputType !== "matrix") {
                this.promoteMeasureWithFieldsToBreakdown(parsed, metricNames, strictFields, [], [
                    "selected_tokens",
                    "strict_selected_token_table",
                    "planner_dropped_selected_field"
                ]);
                parsed.entityPhrases = [];
                parsed.explicitEntityPhrases = [];
                parsed.compareEntityPhrases = [];
                parsed.filters = undefined;
                return this.withSuggestions(answerFilterFieldBreakdown(this.context, parsed, lockedSelected.metrics[0], strictFields, lockedSelected.metrics.slice(1, 30)), [], undefined, {
                    intentConfidence: 1,
                    metricConfidence: 1,
                    entityConfidence: 1,
                    overallConfidence: 1,
                    intent: "lookup",
                    reasons: ["selected_tokens", "strict_selected_token_table", "planner_dropped_selected_field"]
                });
            }
            if (rows.length || columns.length) {
                parsed.intent = "matrix";
                parsed.topBottom = undefined;
                parsed.breakdown = undefined;
                parsed.entityPhrases = [];
                parsed.explicitEntityPhrases = [];
                parsed.compareEntityPhrases = [];
                parsed.filters = undefined;
                parsed.matrix = {
                    intent: "matrix",
                    rows,
                    columns,
                    values,
                    filters: filterTexts,
                    query: normalizeMatrixQuery({
                        ...(planned?.query || {}),
                        rows,
                        columns,
                        values,
                        filters: filterTexts
                    }),
                    defaultValue: false,
                    autoAxes: false,
                    hideZeros: planned?.query.hideZeros,
                    totalsMode: planned?.totalsMode,
                    metricPhrase: values[0] || metricNames[0],
                    metricPhrases: values.length > 1 ? values : undefined,
                    rowPhrases: rows,
                    columnPhrases: columns
                };
                parsed.requestedFields = {
                    rows,
                    columns,
                    values,
                    metrics: values,
                    entities: [],
                    filters: filterTexts
                };
                return this.withSuggestions(answerMatrix(this.context, parsed, lockedSelected.metrics, []), [], undefined, {
                    intentConfidence: 1,
                    metricConfidence: 1,
                    entityConfidence: 1,
                    overallConfidence: 1,
                    intent: "matrix",
                    reasons: ["selected_tokens", "strict_selected_token_matrix"],
                    fieldResolutions: parsed.fieldResolutions
                });
            }
        }
        const selectedTokenAppearsInQuestion = (token: SelectedAssistantToken): boolean => {
            const cleanQuestion = this.normalizeOverrideText(question);
            const cleanLabel = this.normalizeOverrideText(token.label || "");
            return !!cleanLabel && cleanQuestion.indexOf(cleanLabel) >= 0;
        };
        const filterPhraseLabels = new Set((parsed.filters?.includeFilters || [])
            .concat(parsed.filters?.excludeFilters || [])
            .map((filter) => String(filter.phrase || "").toLowerCase().trim())
            .filter(Boolean));
        const explicitEntities = selectedTokens
            .filter((t) => t.type !== "metric" && !(t.type === "filter" && /^filter-field:/i.test(String(t.id || ""))))
            .filter((t) => !this.isKnownMetricLabel(t.label || ""))
            .filter((t) => !this.isKnownMatrixFieldLabel(t.label || ""))
            .filter((t) => !selectedFieldOrMetricQuestion || selectedTokenAppearsInQuestion(t))
            .filter((t) => t.type !== "filter" || !filterPhraseLabels.has(String(t.label || "").toLowerCase().trim()))
            .map((t) => {
                const cleanLabel = this.normalizeOverrideText(t.label || "");
                const type = t.type as AssistantEntity["kind"];
                const exact = this.context.entities.find((e) => e.id === t.id && e.kind === t.type);
                if (exact) return exact;
                const byLabel = this.context.entities.find((e) =>
                    e.kind === t.type
                    && this.normalizeOverrideText(e.label || "") === cleanLabel
                );
                if (byLabel) return byLabel;
                return (t.indices || []).length
                    ? { id: t.id, kind: type, label: t.label, aliases: [t.label], indices: t.indices || [] }
                    : null;
            })
            .filter((e): e is AssistantEntity => e !== null);
        parsed.explicitSelectedEntityKeys = explicitEntities
            .map((entity) => `${entity.kind}:${entity.id}`)
            .filter(Boolean);
        parsed.explicitSelectedEntityLabels = selectedTokens
            .filter((t) => t.type !== "metric" && t.type !== "function" && t.type !== "example" && !(t.type === "filter" && /^filter-field:/i.test(String(t.id || ""))))
            .filter((t) => !this.isKnownMetricLabel(t.label || ""))
            .filter((t) => !this.isKnownMatrixFieldLabel(t.label || ""))
            .map((t) => String(t.label || "").trim())
            .filter(Boolean);
        if (/^\s*(?:select|highlight|zoom(?:\s+to)?|focus(?:\s+on)?|show(?:\s+me)?\s+on\s+map)\b/i.test(question) && explicitEntities.length) {
            const rawPhrase = String(question || "")
                .replace(/^\s*(?:select|highlight|zoom(?:\s+to)?|focus(?:\s+on)?|show(?:\s+me)?\s+on\s+map)\s+/i, "")
                .replace(/\b(?:on|in)\s+(?:the\s+)?map\b/ig, " ")
                .replace(/[?!.;]+$/g, " ")
                .replace(/\s+/g, " ")
                .trim();
            return this.answerEntitySelect({
                ...parsed,
                intent: "lookup",
                raw: rawPhrase || question,
                normalized: rawPhrase || parsed.normalized,
                explicitMetricPhrase: undefined,
                metricPhrases: [],
                debug: true
            }, explicitEntities);
        }
        if (explicitEntities.length && !parsed.matrix && !parsed.topBottom && !parsed.crossMetric && !parsed.explicitMetricPhrase && !(parsed.metricPhrases || []).length) {
            const rawText = String(question || "").trim();
            if (rawText && rawText.length <= 80 && !/\b(?:show|list|compare|top|bottom|rank|count|how|many|what|which|why|matrix|chart|table|by|with|of|in|for)\b/i.test(rawText)) {
                return this.answerEntitySelect({
                    ...parsed,
                    intent: "lookup",
                    raw: rawText,
                    normalized: rawText,
                    explicitMetricPhrase: undefined,
                    metricPhrases: [],
                    debug: true
                }, explicitEntities);
            }
        }
        const explicitMetrics = this.resolveLockedSelectedMetricTokens(selectedTokens);
        const exactSelectedLabelMetrics: AssistantMetric[] = [];
        const hasExplicitSelectedMetric = explicitMetrics.length > 0 || exactSelectedLabelMetrics.length > 0;
        const exactAllTextMetrics = (hasExplicitSelectedMetric ? [] : this.resolveExactMetricsInText(question))
            .filter((metric, index, arr) => arr.findIndex((item) => item.key === metric.key) === index);
        const selectedTextMetrics = explicitMetrics.length
            ? exactAllTextMetrics
            : exactAllTextMetrics.concat(this.resolveMetricsInPhraseOrder(this.getMatrixMetricPhrases(parsed), 8));
        const typedMetrics = (hasExplicitSelectedMetric
            ? []
            : this.resolveMetricsInPhraseOrder(extracted.measures.length ? extracted.measures : this.getMatrixMetricPhrases(parsed), 8)
                .concat(selectedTextMetrics))
            .filter((metric) => !explicitMetrics.concat(exactSelectedLabelMetrics).some((selected) => selected.key === metric.key))
            .filter((metric) => !explicitMetrics.concat(exactSelectedLabelMetrics).some((selected) => {
                const selectedName = this.normalizeOverrideText(selected.name || "");
                const metricName = this.normalizeOverrideText(metric.name || "");
                return selectedName && metricName && selectedName !== metricName && selectedName.indexOf(metricName) >= 0;
            }));
        const effectiveMetrics = hasExplicitSelectedMetric
            ? explicitMetrics.concat(exactSelectedLabelMetrics)
                .filter((metric, index, arr) => arr.findIndex((item) => item.key === metric.key) === index)
            : this.preferMetricsNamedInQuestion(
                explicitMetrics.concat(exactSelectedLabelMetrics).concat(typedMetrics)
                    .filter((metric, index, arr) => arr.findIndex((item) => item.key === metric.key) === index),
                question
            );
        const wantsSelectedRowHierarchy = (fields: string[]): boolean => {
            const raw = String(question || "");
            if (/\b(?:under|within|inside)\s+each\b|\bdrill(?:\s+down)?\b|\bexpand(?:able)?\b|\bhierarchy\b/i.test(raw)) return true;
            return fields.slice(1).some((field) => /\btenant|brand|shop|store\b/i.test(field));
        };
        const selectedColumns = (fields: string[]): string[] => wantsSelectedRowHierarchy(fields) ? [] : fields.slice(1, 5).filter((field) => this.assistantFieldRoleAllowed(field, "column"));
        const selectedRows = (fields: string[]): string[] => {
            const clean = fields.filter((field) => this.assistantFieldRoleAllowed(field, "row"));
            if (wantsSelectedRowHierarchy(clean)) return clean.slice(0, 5);
            const columns = selectedColumns(clean);
            const rows = clean.filter((field) => !columns.some((column) => this.normalizeOverrideText(column) === this.normalizeOverrideText(field)));
            return rows.length ? rows.slice(0, 5) : clean.slice(0, 1);
        };
        const selectedTokenRankQuestion = /\b(?:top|bottom|highest|lowest|largest|smallest|best|worst|rank)\b/i.test(question);
        const selectedTokenMatrixQuestion = this.hasExplicitMatrixLanguage(question);
        if (explicitEntities.length >= 2 && effectiveMetrics.length && !selectedTokenRankQuestion && !selectedTokenMatrixQuestion) {
            const metricNames = effectiveMetrics.map((metric) => metric.name).filter(Boolean);
            parsed.intent = "compare";
            parsed.matrix = undefined;
            parsed.topBottom = undefined;
            parsed.breakdown = undefined;
            parsed.explicitMetricPhrase = metricNames[0];
            parsed.metricPhrases = metricNames;
            parsed.entityPhrases = explicitEntities.map((entity) => entity.label).filter(Boolean);
            parsed.explicitEntityPhrases = parsed.entityPhrases.slice();
            parsed.compareEntityPhrases = parsed.entityPhrases.slice();
            parsed.requestedFields = {
                rows: [],
                columns: [],
                values: metricNames,
                metrics: metricNames,
                entities: parsed.entityPhrases,
                filters: []
            };
        } else if (explicitEntities.length && effectiveMetrics.length && !selectedFilterFields.length && !parsed.chartType && !selectedTokenRankQuestion && !selectedTokenMatrixQuestion) {
            const metricNames = effectiveMetrics.map((metric) => metric.name).filter(Boolean);
            parsed.intent = "lookup";
            parsed.matrix = undefined;
            parsed.topBottom = undefined;
            parsed.breakdown = undefined;
            parsed.explicitMetricPhrase = metricNames[0];
            parsed.metricPhrases = metricNames;
            parsed.entityPhrases = explicitEntities.map((entity) => entity.label).filter(Boolean);
            parsed.explicitEntityPhrases = parsed.entityPhrases.slice();
            parsed.requestedFields = {
                rows: [],
                columns: [],
                values: metricNames,
                metrics: metricNames,
                entities: parsed.entityPhrases,
                filters: []
            };
        } else if (selectedTokenRankQuestion && selectedFilterFields.length && effectiveMetrics.length) {
            const rankMetrics = explicitMetrics.length
                ? explicitMetrics
                : this.resolveMetricsInPhraseOrder(extracted.measures.length ? extracted.measures : this.getTopBottomMetricPhrases(parsed), 4);
            const metricPhrase = (rankMetrics[0] || effectiveMetrics[0])?.name || effectiveMetrics[0].name;
            const dimensionField = selectedFilterFields.find((field) =>
                selectedTokens.some((token) =>
                    token.type === "filter"
                    && /^filter-field:/i.test(String(token.id || ""))
                    && this.normalizeOverrideText(token.label || "") === this.normalizeOverrideText(field)
                )
            ) || selectedFilterFields.find((field) =>
                this.assistantKindForField(field) !== "filter"
            ) || selectedFilterFields[0];
            const dimensionType = this.assistantKindForField(dimensionField);
            parsed.intent = "rank";
            parsed.matrix = undefined;
            parsed.breakdown = undefined;
            parsed.topBottom = {
                direction: /\b(?:bottom|lowest|smallest|worst)\b/i.test(question) ? "bottom" : "top",
                limit: parsed.limit || extracted.rank?.limit || 5,
                dimensionType,
                dimensionField: dimensionType === "filter" ? dimensionField : undefined,
                metricPhrase
            };
            parsed.explicitMetricPhrase = metricPhrase;
            parsed.metricPhrases = [metricPhrase];
            parsed.requestedFields = {
                rows: [],
                columns: [],
                values: [metricPhrase],
                metrics: [metricPhrase],
                entities: [dimensionField],
                filters: []
            };
        } else if (selectedFilterFields.length && effectiveMetrics.length) {
            const metricNames = effectiveMetrics.map((metric) => metric.name).filter(Boolean);
            const selectedMetricLabels = new Set(metricNames.map((metricName) => this.normalizeOverrideText(metricName)));
            const strictInputFields = selectedFilterFields.length
                ? selectedFilterFields
                : (extracted.fields.length ? extracted.fields : []).concat(selectedFilterFields);
            const extractedFields = (selectedFilterFields.length
                ? selectedFilterFields
                : this.mergeMatrixFieldsFromQuestion(question, strictInputFields))
                .filter((field) => !selectedMetricLabels.has(this.normalizeOverrideText(field)))
                .filter((field) => this.isKnownMatrixFieldLabel(field) || !this.isKnownMetricLabel(field));
            const planned = this.planMatrixSlots({
                ...extracted,
                intent: "matrix",
                confidence: 1,
                reasons: ["selected_tokens"].concat(extracted.reasons || []),
                measures: metricNames,
                fields: extractedFields,
                axes: { rows: [], columns: [] },
                axesExplicit: { rows: false, columns: false }
            });
            if (!planned) {
                this.promoteMeasureWithFieldsToBreakdown(parsed, metricNames, extractedFields, [], ["selected_tokens", "cardinality_table_fallback"]);
                parsed.entityPhrases = [];
                parsed.explicitEntityPhrases = [];
                parsed.compareEntityPhrases = [];
                parsed.filters = undefined;
                return this.withSuggestions(answerFilterFieldBreakdown(this.context, parsed, effectiveMetrics[0], extractedFields, effectiveMetrics.slice(1, 30)), [], undefined, {
                    intentConfidence: 1,
                    metricConfidence: 1,
                    entityConfidence: 1,
                    overallConfidence: 1,
                    intent: "lookup",
                    reasons: ["selected_tokens", "strict_selected_token_table", "cardinality_table_fallback"]
                });
            }
            const plannedRows = planned?.rows || [];
            const plannedColumns = planned?.columns || [];
            const columns = plannedColumns.length ? plannedColumns : selectedColumns(extractedFields);
            const columnKeys = new Set(columns.map((field) => this.normalizeOverrideText(field)));
            const baseRows = (plannedRows.length ? plannedRows : selectedRows(extractedFields))
                .filter((field) => !columnKeys.has(this.normalizeOverrideText(field)));
            const rowKeys = new Set(baseRows.map((field) => this.normalizeOverrideText(field)));
            const rows = baseRows.concat(extractedFields
                .filter((field) => !columnKeys.has(this.normalizeOverrideText(field)))
                .filter((field) => {
                    const key = this.normalizeOverrideText(field);
                    if (!key || rowKeys.has(key)) return false;
                    rowKeys.add(key);
                    return true;
                }))
                .slice(0, 5);
            const values = metricNames;
            const filterTexts = planned?.filterTexts || [];
            const plannedFieldLabels = new Set(rows.concat(columns).map((field) => this.normalizeOverrideText(field)));
            const droppedSelectedField = extractedFields.some((field) => !plannedFieldLabels.has(this.normalizeOverrideText(field)));
            if (droppedSelectedField && extractedFields.length) {
                this.promoteMeasureWithFieldsToBreakdown(parsed, metricNames, extractedFields, [], [
                    "selected_tokens",
                    "strict_selected_token_table",
                    "planner_dropped_selected_field"
                ]);
                parsed.entityPhrases = [];
                parsed.explicitEntityPhrases = [];
                parsed.compareEntityPhrases = [];
                parsed.filters = undefined;
                return this.withSuggestions(answerFilterFieldBreakdown(this.context, parsed, effectiveMetrics[0], extractedFields, effectiveMetrics.slice(1, 30)), [], undefined, {
                    intentConfidence: 1,
                    metricConfidence: 1,
                    entityConfidence: 1,
                    overallConfidence: 1,
                    intent: "lookup",
                    reasons: ["selected_tokens", "strict_selected_token_table", "planner_dropped_selected_field"]
                });
            }
            parsed.intent = "matrix";
            parsed.topBottom = undefined;
            parsed.matrix = {
                intent: "matrix",
                rows,
                columns,
                values,
                filters: filterTexts,
                query: normalizeMatrixQuery({
                    ...(planned?.query || {}),
                    rows,
                    columns,
                    values,
                    filters: filterTexts
                }),
                defaultValue: false,
                autoAxes: false,
                hideZeros: planned?.query.hideZeros,
                totalsMode: planned?.totalsMode,
                metricPhrase: values[0] || effectiveMetrics[0].name,
                metricPhrases: values.length > 1 ? values : undefined,
                rowPhrases: rows,
                columnPhrases: columns
            };
            parsed.entityPhrases = [];
            parsed.explicitEntityPhrases = [];
            parsed.compareEntityPhrases = [];
            parsed.filters = undefined;
            parsed.requestedFields = {
                rows,
                columns,
                values,
                metrics: values,
                entities: [],
                filters: filterTexts
            };
        }
        if (parsed.matrix && selectedFilterFields.length && effectiveMetrics.length) {
            this.replanMatrixWithCardinality(parsed, {
                intent: "matrix",
                measures: effectiveMetrics.map((metric) => metric.name).filter(Boolean),
                fields: this.mergeMatrixFieldsFromQuestion(
                    question,
                    selectedFilterFields.concat(parsed.matrix.rows || [], parsed.matrix.columns || [])
                ),
                entities: [],
                axes: { rows: [], columns: [] },
                axesExplicit: { rows: false, columns: false },
                filters: [],
                chartType: undefined,
                rank: undefined,
                confidence: 1,
                reasons: ["selected_tokens", "cardinality_matrix_replan"]
            });
            parsed.entityPhrases = [];
            parsed.explicitEntityPhrases = [];
            parsed.compareEntityPhrases = [];
            parsed.filters = undefined;
        }
        if (parsed.matrix && selectedFilterFields.length) {
            const mergedFields = this.mergeMatrixFieldsFromQuestion(question, (parsed.matrix.rows || [])
                .concat(parsed.matrix.columns || [])
                .concat(selectedFilterFields)
                .map((field) => String(field || "").trim())
                .filter(Boolean)
                .filter((field) => this.isKnownMatrixFieldLabel(field) || !this.isKnownMetricLabel(field))
                .map((field) => {
                    const selected = selectedFilterFields.find((candidate) =>
                        this.normalizeOverrideText(candidate) === this.normalizeOverrideText(field)
                        || this.normalizeOverrideText(candidate).indexOf(this.normalizeOverrideText(field)) >= 0
                        || this.normalizeOverrideText(field).indexOf(this.normalizeOverrideText(candidate)) >= 0
                    );
                    return selected || field;
                }));
            const mergePlanned = this.planMatrixSlots({
                ...extracted,
                intent: "matrix",
                confidence: 1,
                reasons: ["selected_token_matrix_merge"].concat(extracted.reasons || []),
                measures: (parsed.matrix.values || []).filter(Boolean),
                fields: mergedFields,
                axes: { rows: [], columns: [] },
                axesExplicit: { rows: false, columns: false },
                filters: []
            });
            const selectedFieldKeysForMerge = new Set(selectedFilterFields.map((field) => this.normalizeOverrideText(field)));
            const mergedColumns = mergePlanned?.columns || [];
            const mergedColumnKeys = new Set(mergedColumns.map((field) => this.normalizeOverrideText(field)));
            const baseMergedRows = (mergePlanned?.rows?.length ? mergePlanned.rows : selectedRows(mergedFields))
                .filter((field) => !mergedColumnKeys.has(this.normalizeOverrideText(field)));
            const mergedRowKeys = new Set(baseMergedRows.map((field) => this.normalizeOverrideText(field)));
            const mergedRows = baseMergedRows.concat(mergedFields
                .filter((field) => selectedFieldKeysForMerge.has(this.normalizeOverrideText(field)))
                .filter((field) => !mergedColumnKeys.has(this.normalizeOverrideText(field)))
                .filter((field) => {
                    const key = this.normalizeOverrideText(field);
                    if (!key || mergedRowKeys.has(key)) return false;
                    mergedRowKeys.add(key);
                    return true;
                }))
                .slice(0, 5);
            parsed.matrix.rows = mergedRows;
            parsed.matrix.columns = mergedColumns;
            parsed.matrix.rowPhrases = mergedRows;
            parsed.matrix.columnPhrases = mergedColumns;
            parsed.matrix.query = normalizeMatrixQuery({
                ...(parsed.matrix.query || { rows: mergedRows, columns: parsed.matrix.columns, values: parsed.matrix.values, filters: parsed.matrix.filters }),
                rows: mergedRows,
                columns: mergedColumns
            });
            if (parsed.requestedFields) {
                parsed.requestedFields.rows = mergedRows;
                parsed.requestedFields.columns = mergedColumns;
            }
        }
        const selectedTokenCountQuestion = this.isRawCountQuestion(this.normalizeRawCountQuestion(question));
        if (selectedTokenCountQuestion) {
            parsed.intent = "list";
            parsed.requestedFields = {
                rows: [],
                columns: [],
                values: [],
                metrics: [],
                entities: selectedFilterFields,
                filters: []
            };
        }
        if (selectedFilterFields.length && !effectiveMetrics.length && !parsed.matrix && !parsed.topBottom && !selectedTokenCountQuestion) {
            if (this.isCardinalityQuestion(question)) {
                const cardinalityAnswer = this.answerCardinalityQuestion(`cardinality ${selectedFilterFields.join(" and ")}`, selectedFilterFields, []);
                if (cardinalityAnswer) return this.withSuggestions(cardinalityAnswer, cardinalityAnswer.suggestions || [], undefined);
            }
            const wantsTenantList = /\b(?:list|show|display)\b/i.test(question) && /\b(?:tenant|tenants|brand|brands|shop|shops|store|stores)\b/i.test(question);
            if (wantsTenantList) {
                const clarification = selectedFilterFields
                    .map((field) => this.selectedFieldValueQuestionSuggestions(field))
                    .find((item): item is { prompt: string; suggestions: string[] } => !!item);
                if (clarification) {
                    return this.withSuggestions({
                        handled: true,
                        text: clarification.prompt,
                        suggestions: clarification.suggestions
                    }, clarification.suggestions, undefined);
                }
            }
            const selectedFieldList = this.answerFieldValueListQuestion({
                ...parsed,
                matrix: undefined,
                topBottom: undefined,
                breakdown: undefined,
                metricPhrases: [],
                explicitMetricPhrase: undefined,
                requestedFields: {
                    rows: selectedFilterFields.slice(),
                    columns: [],
                    values: [],
                    metrics: [],
                    entities: selectedFilterFields.slice(),
                    filters: []
                }
            }, null);
            if (selectedFieldList) return this.withSuggestions(selectedFieldList, [], undefined);
            return this.withSuggestions({
                handled: true,
                text: `Which field should I list?`,
                suggestions: this.knownMatrixFields().slice(0, 5).map((field) => field.name)
            }, this.knownMatrixFields().slice(0, 5).map((field) => field.name), undefined);
        }
        if (parsed.matrix && effectiveMetrics.length) {
            const metricNames = effectiveMetrics.map((metric) => metric.name).filter(Boolean);
            parsed.matrix.values = metricNames;
            parsed.matrix.metricPhrase = metricNames[0] || parsed.matrix.metricPhrase;
            parsed.matrix.metricPhrases = metricNames.length > 1 ? metricNames : undefined;
            parsed.matrix.query = normalizeMatrixQuery({
                ...(parsed.matrix.query || { rows: parsed.matrix.rows, columns: parsed.matrix.columns, values: parsed.matrix.values, filters: parsed.matrix.filters }),
                values: metricNames
            });
            if (parsed.requestedFields) {
                parsed.requestedFields.values = metricNames;
                parsed.requestedFields.metrics = metricNames;
            }
            return this.withSuggestions(answerMatrix(this.context, parsed, effectiveMetrics, []), [], undefined, {
                intentConfidence: 1,
                metricConfidence: 1,
                entityConfidence: 1,
                overallConfidence: 1,
                intent: "matrix",
                reasons: ["selected_tokens", "direct_matrix_answer"],
                fieldResolutions: parsed.fieldResolutions
            });
        }
        const explicitEntityKeys = new Set(explicitEntities.map((entity) => `${entity.kind}:${entity.id}`));
        const explicitEntityLabels = new Set(explicitEntities.map((entity) => this.normalizeOverrideText(entity.label || "")));
        const typedComparePhrases = parsed.intent === "compare"
            ? (parsed.compareEntityPhrases || parsed.entityPhrases || [])
                .concat(extracted.entities.map((entity) => entity.label))
                .map((phrase) => String(phrase || "").trim())
                .filter((phrase) => phrase && !explicitEntityLabels.has(this.normalizeOverrideText(phrase)))
            : [];
        const typedCompareEntities = typedComparePhrases
            .reduce((out: AssistantEntity[], phrase) => {
                const exact = parsed.hasExplicitSelections
                    ? (this.context.entities || []).filter((entity) => {
                        if (entity.kind !== "tenant" && entity.kind !== "unit") return false;
                        return this.phraseExactlyMatchesEntity(entity, phrase);
                    })
                    : this.getExactEntities(phrase, [phrase]);
                const matches = exact.length || parsed.hasExplicitSelections
                    ? exact
                    : this.matcher.matchEntities([phrase], 4).filter((match) => match.score <= 0.24).map((match) => match.item);
                matches.forEach((entity) => {
                    const key = `${entity.kind}:${entity.id}`;
                    if (explicitEntityKeys.has(key) || out.some((item) => `${item.kind}:${item.id}` === key)) return;
                    out.push(entity);
                });
                return out;
            }, []);
        const effectiveEntities = parsed.hasExplicitSelections && explicitEntities.length
            ? explicitEntities.concat(typedCompareEntities)
                .filter((entity, index, arr) => arr.findIndex((item) => item.kind === entity.kind && item.id === entity.id) === index)
            : explicitEntities.length ? explicitEntities : typedCompareEntities;
        this.correctRankDimensionAndMetric(parsed, extracted);
        return this.answer(question, {
            entities: effectiveEntities.length ? effectiveEntities : undefined,
            metrics: effectiveMetrics.length ? effectiveMetrics : undefined,
            parsed
        });
    }

    private answerStrictClickedFilters(
        question: string,
        selectedTokens: SelectedAssistantToken[],
        selectedFields: string[],
        selectedMetrics: AssistantMetric[],
        forcedOutputType: string
    ): AssistantResponse | null {
        if (!selectedMetrics.length) return null;
        const clickedValues = this.strictClickedFilterTokens(selectedTokens);
        if (!clickedValues.length) return null;
        const metricNames = selectedMetrics.map((metric) => metric.name).filter(Boolean);
        const editableFilterTokens = clickedValues.map((item) => item.token);
        const exactFilteredIndices = this.strictClickedFilterIndices(clickedValues);
        if (!exactFilteredIndices.length) {
            return this.withSuggestions({
                handled: true,
                text: `No rows match ${clickedValues.map((item) => item.label).join(", ")} with ${metricNames.join(", ")}.`,
                table: {
                    columns: ["Filter"].concat(metricNames),
                    rows: []
                }
            }, [], undefined, {
                intentConfidence: 1,
                metricConfidence: 1,
                entityConfidence: 1,
                overallConfidence: 1,
                intent: "lookup",
                reasons: ["selected_tokens", "strict_clicked_filters", "empty_exact_filter"]
            });
        }
        const fieldLabels = selectedFields
            .map((field) => this.canonicalMatrixFieldLabel(field) || field)
            .filter((field) => !selectedMetrics.some((metric) => this.normalizeOverrideText(metric.name) === this.normalizeOverrideText(field)))
            .filter((field, index, arr) => {
                const key = this.normalizeOverrideText(field);
                return !!key && arr.findIndex((candidate) => this.normalizeOverrideText(candidate) === key) === index;
            });
        if (clickedValues.length === 1 && selectedMetrics.length === 1 && !fieldLabels.length && forcedOutputType !== "table" && forcedOutputType !== "matrix") {
            const metric = selectedMetrics[0];
            const value = resolveMetricValue(this.context, metric, exactFilteredIndices);
            const formatted = formatAssistantMetric(this.context, metric, value);
            const scope = clickedValues[0].label;
            return this.withSuggestions({
                handled: true,
                text: `${metric.name} for ${scope} is ${formatted}.`,
                kpi: {
                    title: metric.name,
                    value: formatted,
                    rawValue: value,
                    metricKey: metric.key,
                    metricName: metric.name,
                    scopeLabel: scope
                },
                actions: [{ kind: "select", label: `Select ${scope} in report`, indices: exactFilteredIndices }]
            }, [], undefined, {
                intentConfidence: 1,
                metricConfidence: 1,
                entityConfidence: 1,
                overallConfidence: 1,
                intent: "lookup",
                reasons: ["selected_tokens", "strict_clicked_filters", "single_filter_kpi"]
            });
        }
        const valueFields = clickedValues
            .map((item) => item.field)
            .filter((field, index, arr) => !!field && arr.findIndex((candidate) => this.normalizeOverrideText(candidate) === this.normalizeOverrideText(field)) === index);
        const rowFields = valueFields.concat(fieldLabels)
            .filter((field, index, arr) => !!field && arr.findIndex((candidate) => this.normalizeOverrideText(candidate) === this.normalizeOverrideText(field)) === index)
            .slice(0, 6);
        const titleScope = clickedValues.map((item) => item.label).join(", ");
        const scopedRowFields = clickedValues.length === 1 && fieldLabels.length
            ? fieldLabels.slice(0, 5)
            : rowFields;
        const shouldUseMatrix = forcedOutputType === "matrix"
            || (forcedOutputType !== "table" && this.strictClickedFilterShouldUseMatrix(rowFields, exactFilteredIndices));
        if (fieldLabels.length && shouldUseMatrix) {
            const matrixParsed: ParsedAssistantQuestion = {
                ...parseAssistantQuestion(question),
                intent: "matrix",
                plannerSource: "slot",
                hasExplicitSelections: true,
                detectedIntent: {
                    intent: "matrix",
                    confidence: 1,
                    reasons: ["selected_tokens", "strict_clicked_filters", "clicked_value_hierarchy_matrix"]
                },
                filters: {
                    includeFilters: [{
                        phrase: titleScope,
                        matchedIndices: exactFilteredIndices
                    }]
                },
                entityPhrases: [],
                explicitEntityPhrases: [],
                compareEntityPhrases: [],
                matrix: {
                    intent: "matrix",
                    rows: scopedRowFields,
                    columns: [],
                    values: metricNames,
                    filters: [titleScope],
                    query: normalizeMatrixQuery({
                        rows: scopedRowFields,
                        columns: [],
                        values: metricNames,
                        filters: [titleScope]
                    }),
                    defaultValue: false,
                    autoAxes: false,
                    metricPhrase: metricNames[0] || selectedMetrics[0].name,
                    metricPhrases: metricNames.length > 1 ? metricNames : undefined,
                    rowPhrases: scopedRowFields,
                    columnPhrases: []
                },
                requestedFields: {
                    rows: scopedRowFields,
                    columns: [],
                    values: metricNames,
                    metrics: metricNames,
                    entities: [],
                    filters: [titleScope]
                }
            };
            const matrixAnswer = answerMatrix(this.context, matrixParsed, selectedMetrics, []);
            if (clickedValues.length === 1 && fieldLabels.length) {
                const scope = clickedValues[0].label;
                const rowText = scopedRowFields.join(" > ");
                matrixAnswer.text = `${metricNames.join(", ")} by ${rowText} for ${scope}.`;
                if (matrixAnswer.matrix) {
                    matrixAnswer.matrix.title = `${scope}: ${metricNames.join(", ")}`;
                }
            }
            return this.withSuggestions(matrixAnswer, [], undefined, {
                intentConfidence: 1,
                metricConfidence: 1,
                entityConfidence: 1,
                overallConfidence: 1,
                intent: "matrix",
                reasons: ["selected_tokens", "strict_clicked_filters", "clicked_value_hierarchy_matrix"]
            });
        }
        const tableRowFields = clickedValues.length === 1 && fieldLabels.length ? scopedRowFields : rowFields;
        const rows = fieldLabels.length
            ? this.strictGroupedRowsForFields(tableRowFields, exactFilteredIndices, selectedMetrics)
            : clickedValues.map((item) => [
                item.label,
                ...selectedMetrics.map((metric) => formatAssistantMetric(this.context, metric, resolveMetricValue(this.context, metric, item.indices)))
            ]);
        const columns = (fieldLabels.length
            ? tableRowFields
            : [valueFields[0] || "Selection"]).concat(metricNames);
        const text = fieldLabels.length
            ? `${metricNames.join(", ")} by ${tableRowFields.join(" > ")} for ${titleScope}.`
            : `${metricNames.join(", ")} for ${titleScope}.`;
        const explicitFieldOnlyRepeatsClickedField = fieldLabels.length > 0
            && tableRowFields.length === 1
            && valueFields.length === 1
            && this.normalizeOverrideText(tableRowFields[0]) === this.normalizeOverrideText(valueFields[0]);
        const shouldTransposeClickedComparison = (!fieldLabels.length || explicitFieldOnlyRepeatsClickedField)
            && selectedMetrics.length > 1
            && clickedValues.length >= 2
            && clickedValues.length <= 4
            && forcedOutputType !== "matrix"
            && !/\b(?:normal\s+table|row\s+layout|by\s+(?:tenant|name|group|category|unit)\s+rows?)\b/i.test(question);
        if (shouldTransposeClickedComparison) {
            const metricGroupFor = (metric: AssistantMetric): string => {
                const metricKey = String(metric.key || "").trim();
                const metricName = this.normalizeOverrideText(metric.name || "");
                const token = (selectedTokens || []).find((candidate) => {
                    if (candidate.type !== "metric" || !candidate.bookmarkGroup) return false;
                    const tokenKey = String(candidate.metricKey || candidate.id || "").replace(/^metric:/i, "").trim();
                    const tokenLabel = this.normalizeOverrideText(candidate.label || "");
                    return (!!metricKey && tokenKey === metricKey) || (!!metricName && tokenLabel === metricName);
                });
                return String(token?.bookmarkGroup || "").trim();
            };
            const hasBookmarkGroups = selectedMetrics.some((metric) => !!metricGroupFor(metric));
            const transposedRows: string[][] = [];
            let lastGroup = "";
            selectedMetrics.forEach((metric) => {
                const groupName = hasBookmarkGroups ? (metricGroupFor(metric) || "Other measures") : "";
                if (groupName && groupName !== lastGroup) {
                    transposedRows.push([groupName].concat(clickedValues.map(() => "")));
                    lastGroup = groupName;
                }
                transposedRows.push([
                    metric.name,
                    ...clickedValues.map((item) => formatAssistantMetric(this.context, metric, resolveMetricValue(this.context, metric, item.indices)))
                ]);
            });
            return this.withSuggestions({
                handled: true,
                text,
                table: {
                    columns: ["Metric"].concat(clickedValues.map((item) => item.label)),
                    rows: transposedRows,
                    editableQuery: {
                        fields: [],
                        measures: metricNames,
                        filters: editableFilterTokens,
                        fieldOptions: this.knownMatrixFields().map((field) => field.name),
                        measureOptions: (this.context.metrics || []).map((metric) => metric.name)
                    }
                },
                actions: [{ kind: "select", label: `Select ${titleScope} in report`, indices: exactFilteredIndices }]
            }, [], undefined, {
                intentConfidence: 1,
                metricConfidence: 1,
                entityConfidence: 1,
                overallConfidence: 1,
                intent: "compare",
                reasons: ["selected_tokens", "strict_clicked_filters", "transposed_clicked_comparison"]
            });
        }
        return this.withSuggestions({
            handled: true,
            text,
            table: {
                columns,
                rows: rows.slice(0, 500),
                editableQuery: {
                    fields: tableRowFields,
                    measures: metricNames,
                    filters: editableFilterTokens,
                    fieldOptions: this.knownMatrixFields().map((field) => field.name),
                    measureOptions: (this.context.metrics || []).map((metric) => metric.name)
                }
            },
            actions: [{ kind: "select", label: `Select ${titleScope} in report`, indices: exactFilteredIndices }]
        }, [], undefined, {
            intentConfidence: 1,
            metricConfidence: 1,
            entityConfidence: 1,
            overallConfidence: 1,
            intent: "lookup",
            reasons: ["selected_tokens", "strict_clicked_filters", "multi_filter_table"]
        });
    }

    private strictClickedFilterShouldUseMatrix(fields: string[], indices: number[]): boolean {
        const cleanFields = (fields || []).filter(Boolean);
        if (cleanFields.length < 2) return false;
        const counts = cleanFields.map((field) => this.strictDistinctFieldCount(field, indices));
        const first = counts[0] || 0;
        const maxChild = Math.max(...counts.slice(1));
        if (first > 0 && first <= 12 && maxChild > first) return true;
        if (first > 0 && first <= 25 && maxChild >= first * 2) return true;
        return false;
    }

    private strictDistinctFieldCount(field: string, indices: number[]): number {
        const values = new Set<string>();
        (indices || []).forEach((idx) => {
            const value = this.normalizeOverrideText(this.strictRowFieldValue(idx, field));
            if (value) values.add(value);
        });
        return values.size;
    }

    private strictClickedFilterTokens(selectedTokens: SelectedAssistantToken[]): Array<{ token: SelectedAssistantToken; label: string; field: string; indices: number[] }> {
        return (selectedTokens || [])
            .filter((token) => token.type !== "metric" && token.type !== "function" && token.type !== "example")
            .filter((token) => !(token.type === "filter" && /^filter-field:/i.test(String(token.id || ""))))
            .filter((token) => !this.isKnownMetricLabel(token.label || ""))
            .filter((token) => !this.isKnownMatrixFieldLabel(token.label || ""))
            .map((token) => {
                const label = String(token.label || "").trim();
                const indices = Array.from(new Set((token.indices || [])
                    .map((idx) => Number(idx))
                    .filter((idx) => Number.isFinite(idx) && idx >= 0 && idx < this.context.rows.length)));
                const field = this.selectedTokenExactFieldName(token);
                return { token, label, field, indices };
            })
            .filter((item) => item.label && item.field && item.indices.length);
    }

    private selectedTokenExactFieldName(token: SelectedAssistantToken): string {
        const explicitFieldName = String(token.fieldName || "").trim();
        if (explicitFieldName && this.isAssistantFieldAllowed(explicitFieldName)) return explicitFieldName;
        const rawId = String(token.id || "");
        const encodedField = rawId.match(/^value:filter:([^:]+):/i)?.[1];
        if (encodedField) {
            const known = this.knownMatrixFields().find((field) =>
                this.normalizeAutocompleteText(field.name || "") === encodedField
                || (field.aliases || []).some((alias) => this.normalizeAutocompleteText(alias || "") === encodedField)
            );
            if (known?.name) return known.name;
        }
        const type = String(token.type || "").toLowerCase();
        if (type === "tenant") return "Assigned Tenant Name";
        if (type === "unit") return "Unit";
        if (type === "category") return "Assigned Sales Category";
        if (type === "group") return "Assigned Group";
        if (type === "zone") return "Zone";
        if (type === "floor") return "Floor";
        if (type === "layer") return "Layer";
        const id = String(token.id || "").toLowerCase();
        if (id.indexOf("tenant") >= 0) return "Assigned Tenant Name";
        if (id.indexOf("unit") >= 0) return "Unit";
        if (id.indexOf("category") >= 0 || id.indexOf("sales") >= 0) return "Assigned Sales Category";
        if (id.indexOf("group") >= 0) return "Assigned Group";
        if (id.indexOf("zone") >= 0) return "Zone";
        if (id.indexOf("floor") >= 0) return "Floor";
        if (id.indexOf("layer") >= 0) return "Layer";
        const inferred = this.inferClickedFilterField(token);
        if (inferred) return inferred;
        return "Selection";
    }

    private inferClickedFilterField(token: SelectedAssistantToken): string {
        const label = this.normalizeOverrideText(token.label || "");
        const indices = (token.indices || [])
            .map((idx) => Number(idx))
            .filter((idx) => Number.isFinite(idx) && idx >= 0 && idx < this.context.rows.length)
            .slice(0, 200);
        if (!label || !indices.length) return "";
        const candidates = this.knownMatrixFields()
            .map((field) => field.name)
            .filter((field, index, arr) => field && arr.findIndex((candidate) => this.normalizeOverrideText(candidate) === this.normalizeOverrideText(field)) === index);
        let best = "";
        let bestScore = 0;
        candidates.forEach((field) => {
            let score = 0;
            indices.forEach((idx) => {
                if (this.normalizeOverrideText(this.strictRowFieldValue(idx, field)) === label) score += 1;
            });
            if (score > bestScore) {
                bestScore = score;
                best = field;
            }
        });
        return bestScore > 0 ? best : "";
    }

    private strictClickedFilterIndices(clickedValues: Array<{ field: string; indices: number[] }>): number[] {
        const byField = new Map<string, Set<number>>();
        clickedValues.forEach((item) => {
            const key = this.normalizeOverrideText(item.field || "Selection") || "selection";
            const set = byField.get(key) || new Set<number>();
            (item.indices || []).forEach((idx) => set.add(idx));
            byField.set(key, set);
        });
        const groups = Array.from(byField.values()).filter((set) => set.size);
        if (!groups.length) return [];
        const first = Array.from(groups[0]);
        return groups.slice(1).reduce((out, set) => out.filter((idx) => set.has(idx)), first).sort((a, b) => a - b);
    }

    private strictGroupedRowsForFields(fields: string[], indices: number[], metrics: AssistantMetric[]): string[][] {
        const groups = new Map<string, { values: string[]; indices: number[] }>();
        (indices || []).forEach((idx) => {
            const values = fields.map((field) => this.strictRowFieldValue(idx, field));
            if (values.some((value) => !value)) return;
            const key = values.map((value) => this.normalizeOverrideText(value)).join("\u0001");
            const existing = groups.get(key);
            if (existing) existing.indices.push(idx);
            else groups.set(key, { values, indices: [idx] });
        });
        return Array.from(groups.values())
            .sort((a, b) => {
                const av = resolveMetricValue(this.context, metrics[0], a.indices);
                const bv = resolveMetricValue(this.context, metrics[0], b.indices);
                return bv - av;
            })
            .map((group) => group.values.concat(metrics.map((metric) =>
                formatAssistantMetric(this.context, metric, resolveMetricValue(this.context, metric, group.indices))
            )));
    }

    private strictRowFieldValue(idx: number, field: string): string {
        const row = this.context.rows[idx];
        if (!row) return "";
        if (!this.isAssistantFieldAllowed(field)) return "";
        const clean = this.normalizeOverrideText(field);
        const exactFilterKey = Object.keys(row.filters || {}).find((key) => this.normalizeOverrideText(key) === clean);
        if (exactFilterKey) return String((row.filters || {})[exactFilterKey] || "").trim();
        if (/^(assigned sales category|sales category|category|categories)$/.test(clean)) return String(row.category || row.filters?.["Assigned Sales Category"] || row.filters?.["Sales Category"] || row.filters?.["Category"] || "").trim();
        if (/^(assigned group|group|groups)$/.test(clean)) return String(row.group || row.filters?.["Assigned Group"] || row.filters?.["Group"] || "").trim();
        if (/^(assigned tenant name|assigned tenant|tenant name|tenant names|tenant|tenants)$/.test(clean)) return String(row.filters?.["Assigned Tenant Name"] || row.filters?.["Assigned Tenant"] || row.filters?.["Tenant Name"] || row.filters?.["Tenant"] || row.tenant || row.unitId || "").trim();
        if (/^(assigned unit|unit|units|unit id|unit ids|unit name|unit names)$/.test(clean)) return String(row.unitId || row.combinedUnit || row.filters?.["Unit"] || row.filters?.["Unit ID"] || "").trim();
        if (/^(floor|floors|level|levels)$/.test(clean)) return (row.floors || []).filter(Boolean).join(", ");
        if (/^(zone|zones)$/.test(clean)) return this.context.entities.filter((entity) => entity.kind === "zone" && (entity.indices || []).indexOf(idx) >= 0).map((entity) => entity.label).filter(Boolean).join(", ");
        if (/^(layer|layers)$/.test(clean)) return this.context.entities.filter((entity) => entity.kind === "layer" && (entity.indices || []).indexOf(idx) >= 0).map((entity) => entity.label).filter(Boolean).join(", ");
        return "";
    }

    private applySelectedTokenFilterOverrides(parsed: ParsedAssistantQuestion, selectedTokens: SelectedAssistantToken[]): ParsedAssistantQuestion {
        const filters = parsed.filters;
        if (!filters) return parsed;
        const exactTokens = (selectedTokens || [])
            .filter((token) => {
                if (token.type === "metric" || token.type === "function" || token.type === "example") return false;
                if (token.type === "filter" && /^filter-field:/i.test(String(token.id || ""))) return false;
                const label = String(token.label || "").trim();
                if (!label) return false;
                if (this.resolveExactMetricLabels([label]).length) return false;
                if (this.isKnownMetricLabel(label) && !this.isKnownMatrixFieldLabel(label)) return false;
                return true;
            })
            .map((token) => ({
                token,
                label: this.normalizeOverrideText(token.label || ""),
                indices: Array.from(new Set(token.indices || []))
            }))
            .filter((item) => item.label);
        if (!exactTokens.length) return parsed;
        const apply = (filter: NonNullable<ParsedAssistantQuestion["filters"]>["includeFilters"][number]) => {
            const phrase = this.normalizeOverrideText(filter.phrase || "");
            const exact = exactTokens.find((item) => phrase === item.label || phrase.indexOf(item.label) >= 0 || item.label.indexOf(phrase) >= 0);
            if (!exact) return filter;
            return {
                ...filter,
                type: exact.token.type === "filter" ? filter.type : exact.token.type as any,
                matchedEntityIds: [exact.token.id],
                matchedIndices: exact.indices
            };
        };
        return {
            ...parsed,
            filters: {
                ...filters,
                includeFilters: (filters.includeFilters || []).map(apply),
                excludeFilters: (filters.excludeFilters || []).map(apply)
            }
        };
    }

    private inferPasteOverrides(parsed: ParsedAssistantQuestion): { entities: AssistantEntity[]; metrics: AssistantMetric[]; filterFields: string[] } {
        const text = String(parsed.raw || parsed.normalized || "");
        const normalized = this.normalizeOverrideText(text);
        if (!normalized) return { entities: [], metrics: [], filterFields: [] };
        const containsLabel = (label: string): boolean => {
            const clean = this.normalizeOverrideText(label);
            return !!clean && (normalized === clean || normalized.indexOf(` ${clean} `) >= 0 || normalized.indexOf(clean) >= 0);
        };
        const builtinMetric = this.resolveBuiltinMetricFromText(normalized);
        const metrics = (this.context.metrics || [])
            .map((metric) => {
                if (metric.formatHint === "text") return false;
                if (isDimensionLikeMetric(metric)) return false;
                if ((metric.key === "__builtin::area" || metric.key === "__builtin::units" || metric.key === "__builtin::occupancy" || metric.key === "__builtin::vacant") && builtinMetric) {
                    return metric.key === builtinMetric.key ? { metric, score: 2 } : false;
                }
                const labels = [metric.name].concat(metric.aliases || []);
                const exactName = this.normalizeOverrideText(metric.name);
                if (exactName && (normalized === exactName || normalized.indexOf(` ${exactName.trim()} `) >= 0 || normalized.indexOf(exactName) >= 0)) {
                    return { metric, score: 0 };
                }
                const matchedAlias = labels.some((label) => {
                    const clean = this.normalizeOverrideText(label);
                    return clean.length >= 3 && containsLabel(label);
                });
                return matchedAlias ? { metric, score: 1 } : false;
            })
            .filter((item): item is { metric: AssistantMetric; score: number } => !!item)
            .sort((a, b) => a.score - b.score || String(b.metric.name || "").length - String(a.metric.name || "").length)
            .map((item) => item.metric)
            .slice(0, parsed.matrix ? 1 : 8);
        const filterFields = this.getKnownFilterFieldKeys()
            .filter((field) => containsLabel(field))
            .sort((a, b) => b.length - a.length)
            .slice(0, 4);
        const filterPhraseLabels = new Set((parsed.filters?.includeFilters || [])
            .concat(parsed.filters?.excludeFilters || [])
            .map((filter) => this.normalizeOverrideText(filter.phrase))
            .filter(Boolean));
        const entities = (this.context.entities || [])
            .filter((entity) => entity.kind === "tenant"
                || entity.kind === "unit"
                || entity.kind === "category"
                || entity.kind === "group"
                || entity.kind === "zone"
                || entity.kind === "floor"
                || entity.kind === "layer"
                || entity.kind === "bookmark")
            .filter((entity) => !filterPhraseLabels.has(this.normalizeOverrideText(entity.label)))
            .filter((entity) => [entity.label].concat(entity.aliases || []).some((label) => {
                const clean = this.normalizeOverrideText(label);
                return clean.length >= 3 && containsLabel(label);
            }))
            .sort((a, b) => String(b.label || "").length - String(a.label || "").length)
            .slice(0, 8);
        return { entities, metrics, filterFields };
    }

    private getKnownFilterFieldKeys(): string[] {
        const keys = new Set<string>();
        (this.context.fieldNames || []).filter((key) => this.isAssistantFieldAllowed(key)).forEach((key) => {
            if (String(key || "").trim()) keys.add(key);
        });
        (this.context.dataDictionary?.fields || [])
            .filter((field) => field.enabled !== false)
            .forEach((field) => {
                [field.actualName, field.displayName].concat(field.synonyms || []).forEach((label) => {
                    const clean = String(label || "").trim();
                    if (clean) keys.add(clean);
                });
            });
        (this.context.rows || []).forEach((row) => {
            Object.keys(row?.filters || {}).forEach((key) => {
                if (!this.isAssistantFieldAllowed(key)) return;
                if (String(key || "").trim()) keys.add(key);
            });
        });
        (this.context.metrics || []).forEach((metric) => {
            const label = String(metric.name || "").trim();
            if (/\bassigned\b/i.test(label) && /\b(tenant|name|category|group|brand|segment|class|type)\b/i.test(label)) keys.add(label);
        });
        return Array.from(keys);
    }

    private normalizeOverrideText(value: string): string {
        return ` ${String(value || "")
            .toLowerCase()
            .replace(/&/g, " and ")
            .replace(/[^a-z0-9]+/g, " ")
            .replace(/\s+/g, " ")
            .trim()} `;
    }

    resolveTableCellAction(columns: string[], row: string[], columnIndex: number): AssistantAction | null {
        const column = String(columns?.[columnIndex] || "").toLowerCase().trim();
        const raw = String(row?.[columnIndex] || "").trim();
        if (!raw || /^total$/i.test(raw)) return null;
        const normalize = (value: string): string => String(value || "")
            .toLowerCase()
            .replace(/[?!.:,;()[\]{}]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        const compact = (value: string): string => normalize(value).replace(/\s+/g, "");
        const kindFromColumn = (): Array<AssistantEntity["kind"]> => {
            if (/^unit\b|unit id|unit_id/.test(column)) return ["unit"];
            if (/tenant|brand|shop|store/.test(column)) return ["tenant", "unit"];
            if (/category|categor/.test(column)) return ["category", "filter"];
            if (/\bgroup\b/.test(column)) return ["group", "filter"];
            if (/\bzone\b/.test(column)) return ["zone"];
            if (/\bfloor\b/.test(column)) return ["floor"];
            if (/\blayer\b/.test(column)) return ["layer"];
            if (/^name$|^rank$/.test(column)) return ["tenant", "unit", "category", "group", "zone", "floor", "layer", "filter"];
            return [];
        };
        let kinds = kindFromColumn();
        if (!kinds.length) return null;
        const unitColumnIndex = columns.findIndex((item) => /^unit\b|unit id|unit_id/i.test(String(item || "")));
        const unitValue = unitColumnIndex >= 0 ? String(row?.[unitColumnIndex] || "").trim() : "";
        if (columnIndex === 0 && unitValue && !/^(n\/a|-|none)$/i.test(unitValue)) {
            const unit = this.findEntityByLabel(unitValue, ["unit"], normalize, compact);
            if (unit) return { kind: "select", label: `Select ${raw} in report`, indices: Array.from(new Set(unit.indices || [])) };
        }
        const entity = this.findEntityByLabel(raw, kinds, normalize, compact);
        if (!entity) return null;
        return { kind: "select", label: `Select ${entity.label} in report`, indices: Array.from(new Set(entity.indices || [])) };
    }

    resolveTableHeaderAction(label: string): AssistantAction | null {
        const raw = String(label || "").trim();
        if (!raw || /^(metric|value|total|grand total)$/i.test(raw)) return null;
        const normalize = (value: string): string => String(value || "")
            .toLowerCase()
            .replace(/[?!.:,;()[\]{}]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        const compact = (value: string): string => normalize(value).replace(/\s+/g, "");
        const q = normalize(raw);
        const cq = compact(raw);
        const entity = (this.context.entities || [])
            .filter((item) => ["tenant", "unit", "category", "group", "zone", "floor", "layer", "filter"].indexOf(item.kind) >= 0)
            .filter((item) => normalize(item.label || "") === q || compact(item.label || "") === cq)
            .sort((a, b) => String(a.label || "").length - String(b.label || "").length)[0] || null;
        if (!entity || !(entity.indices || []).length) return null;
        return { kind: "select", label: `Select ${entity.label} in report`, indices: Array.from(new Set(entity.indices || [])) };
    }

    private findEntityByLabel(
        label: string,
        kinds: Array<AssistantEntity["kind"]>,
        normalize: (value: string) => string,
        compact: (value: string) => string
    ): AssistantEntity | null {
        const q = normalize(label);
        const cq = compact(label);
        if (!q) return null;
        const candidates = (this.context.entities || []).filter((entity) => kinds.indexOf(entity.kind) >= 0);
        const exactPrimary = candidates
            .filter((entity) => normalize(entity.label || "") === q || compact(entity.label || "") === cq)
            .sort((a, b) => String(a.label || "").length - String(b.label || "").length)[0];
        if (exactPrimary) return exactPrimary;
        return candidates.find((entity) => {
            const labels = [entity.label].concat(entity.aliases || []);
            return labels.some((value) => normalize(value) === q || compact(value) === cq);
        }) || null;
    }

    private getTopBottomMetricPhrases(parsed: ParsedAssistantQuestion): string[] {
        const raw = String(parsed.raw || parsed.normalized || "");
        const match = raw.match(/\b(?:by|with|based on|using|across|across all metrics:?|for each metric:?)\s+(.+?)$/i);
        const connectorSource = match?.[1] || "";
        const implicitSource = !connectorSource && parsed.topBottom
            ? String(raw || "").replace(/\b(top|bottom|highest|lowest|best|worst|largest|smallest|maximum|minimum|max|min)\b/ig, " ")
                .replace(/\b(which|what|who|tenant|tenants|unit|units|group|groups|category|categories|zone|zones|layer|layers|floor|floors|has|have|having|with|the|a|an|is|are)\b/ig, " ")
            : "";
        const source = parsed.topBottom?.metricPhrase || connectorSource || implicitSource || parsed.explicitMetricPhrase || "";
        const stopScoped = String(source || "")
            .replace(/^\s*(?:all\s+)?metrics?\s*:?\s*/i, "")
            .replace(/\s+\bfor\s+(?:benchmark\s+statistics|benchmarks?|statistics|statics|tenant\s+concentration|concentration)\b.*$/i, "")
            .replace(/\s+\bfor\s+show\s+(?:90|75|50|25)(?:th)?\s+percentile\b.*$/i, "")
            .replace(/\s+\bshow\s+(?:90|75|50|25)(?:th)?\s+percentile\b.*$/i, "")
            .replace(/\b(sales|revenue|turnover)\s*(?:per|\/)?\s*(sqm|sq\s*m|m2|area)\b/gi, "$1 productivity")
            .replace(/\b(sqm|sq\s*m|m2|area)\s*(?:per|\/)?\s*(sales|revenue|turnover)\b/gi, "$2 productivity")
            .replace(/\s+\b(?:in|inside|within|under|from|for)\s+\b(?:category|categories|group|groups|zone|zones|floor|floors|layer|layers)\b.+$/i, "")
            .trim();
        const pieces = stopScoped
            .split(/\s*,\s*|\s+;\s*|\s+\band\b\s+/i)
            .map((part) => part.replace(/\b(?:chart|table|graph|visual)\b/ig, " "))
            .map((part) => part.replace(/[?!.;]+$/g, "").replace(/\s+/g, " ").trim())
            .filter((part) => part && !/^(tenant|unit|category|group|zone|floor|layer|bookmark)s?$/i.test(part));
        if (pieces.length) return pieces;
        return parsed.topBottom?.metricPhrase ? [parsed.topBottom.metricPhrase] : [];
    }

    private getCompareMetricPhrases(parsed: ParsedAssistantQuestion): string[] {
        const raw = String(parsed.raw || parsed.normalized || "");
        const sources: string[] = [];
        const byMatch = raw.match(/\b(?:by|with|using|based on)\s+(.+?)$/i);
        if (byMatch?.[1]) sources.push(byMatch[1]);
        if (parsed.explicitMetricPhrase) sources.push(parsed.explicitMetricPhrase);
        (parsed.metricPhrases || []).forEach((phrase) => sources.push(phrase));
        if (!sources.length && /\b(all\s+)?growth\s+metrics?\b/i.test(raw)) sources.push("growth");
        const stopWords = /\s+\b(?:in|inside|within|under|from|for)\s+\b(?:category|categories|group|groups|zone|zones|floor|floors|layer|layers)\b.+$/i;
        const pieces = sources
            .map((source) => String(source || "")
                .replace(/^\s*(?:all\s+)?metrics?\s*:?\s*/i, "")
                .replace(/\b(all\s+)?growth\s+metrics?\b/ig, "growth")
                .replace(/\b(sales|revenue|turnover)\s*(?:per|\/)?\s*(sqm|sq\s*m|m2|area)\b/gi, "$1 productivity")
                .replace(/\b(sqm|sq\s*m|m2|area)\s*(?:per|\/)?\s*(sales|revenue|turnover)\b/gi, "$2 productivity")
                .replace(stopWords, ""))
            .flatMap((source) => source.split(/\s*,\s*|\s+;\s*|\s+\band\b\s+/i))
            .map((part) => part.replace(/\b(?:chart|table|graph|visual|compare|comparison)\b/ig, " "))
            .map((part) => part.replace(/[?!.;]+$/g, "").replace(/\s+/g, " ").trim())
            .filter((part) => part && !/^(tenant|tenants|unit|units|category|categories|group|groups|zone|zones|floor|floors|layer|layers|bookmark|bookmarks)$/i.test(part));
        return Array.from(new Set(pieces));
    }

    private getMatrixMetricPhrases(parsed: ParsedAssistantQuestion): string[] {
        const raw = String(parsed.raw || parsed.normalized || "");
        const sources: string[] = [];
        if (parsed.matrix?.metricPhrases?.length) sources.push(...parsed.matrix.metricPhrases);
        if (parsed.matrix?.metricPhrase) sources.push(parsed.matrix.metricPhrase);
        if (!sources.length) {
            const beforeAxes = raw
                .replace(/\s+\b(?:of|for|by|with)\b\s+.+?\s+\bas\s+(?:rows?|columns?|cols?)\b.*$/i, "")
                .replace(/\s+\b(?:by|across|grouped\s+by|split\s+by)\b\s+(?:assigned\s+)?(?:tenant|tenants|tenant\s+names?|unit|units|category|categories|sales\s+category|sales\s+categories|group|groups|zone|zones|floor|floors|layer|layers).+$/i, "");
            const leadingMetric = beforeAxes.match(/\b(?:show|display|get|give|create|build)?\s*(.+?)$/i);
            if (leadingMetric?.[1]) sources.push(leadingMetric[1]);
        }
        const pieces = sources
            .map((source) => String(source || "")
                .replace(/\b(?:show|display|get|give|create|build|please|me|the|a|an|matrix|pivot|report|table|summary|values?|measures?|metrics?)\b/ig, " ")
                .replace(/\b(sales|revenue|turnover)\s*(?:per|\/)?\s*(sqm|sq\s*m|m2|area)\b/gi, "$1/sqm")
                .replace(/\b(rent|rental|lease)\s*(?:per|\/)?\s*(sqm|sq\s*m|m2|area)\b/gi, "$1/sqm")
                .replace(/\s+\b(?:with|by|across|grouped\s+by|split\s+by)\b\s+(?:assigned\s+)?(?:tenant|tenants|tenant\s+names?|unit|units|category|categories|sales\s+category|sales\s+categories|group|groups|zone|zones|floor|floors|layer|layers)\b.*$/i, "")
                .replace(/\s+\b(?:as|in|with)\s+(?:bar|column|line|pie|donut|doughnut|table)?\s*(?:chart|graph|visual|view)?\b.*$/i, "")
                .replace(/\s+/g, " ")
                .trim())
            .flatMap((source) => source.split(/\s*,\s*|\s+;\s*|\s+\band\b\s+|\s+\bplus\b\s+/i))
            .map((part) => part.replace(/\b(?:rows?|columns?|cols?|chart|graph|visual|view)\b/ig, " "))
            .map((part) => part.replace(/[?!.;]+$/g, "").replace(/\s+/g, " ").trim())
            .filter((part) => part && !/^(tenant|tenants|tenant name|tenant names|unit|units|category|categories|sales category|sales categories|group|groups|zone|zones|region|regions|floor|floors|layer|layers|bookmark|bookmarks)$/i.test(part));
        return Array.from(new Set(pieces));
    }

    private resolveMetricsMentionedInQuestionText(question: string, limit: number): AssistantMetric[] {
        const exactDynamic = this.resolveExactDynamicMetricNameMentions(question);
        const resolved = this.metricResolver.resolveQuestionMentions(question, {
            limit,
            allowAliases: true
        });
        return this.mergeMetricPriorityLists(exactDynamic, resolved).slice(0, limit);
    }

    private pruneUnaskedResolvedMetrics(question: string, metrics: AssistantMetric[]): AssistantMetric[] {
        const cleanMetrics = (metrics || [])
            .filter((metric) => !!metric && !isDimensionMetric(metric))
            .filter((metric, index, arr) => arr.findIndex((candidate) => candidate.key === metric.key) === index);
        if (!cleanMetrics.length) return [];
        const raw = String(question || "");
        if (/#\s*[\w]/.test(raw)) return this.dropContainedMetricNameMatches(cleanMetrics);
        const normalizedQuestion = this.normalizeOverrideText(
            raw.replace(/\b(area|rent|sales|ocr|units?|sqm|m2)of\b/ig, "$1 of")
        );
        if (!normalizedQuestion) return this.dropContainedMetricNameMatches(cleanMetrics);
        const wrappedQuestion = ` ${normalizedQuestion} `;
        const explicitlyMentionedKeys = new Set<string>();
        cleanMetrics.forEach((metric) => {
            const labels = [metric.name].concat(metric.aliases || [])
                .map((label) => this.normalizeOverrideText(label || ""))
                .filter((label) => label.length >= 2);
            if (labels.some((label) => wrappedQuestion.indexOf(` ${label} `) >= 0)) {
                explicitlyMentionedKeys.add(metric.key);
            }
        });
        if (!explicitlyMentionedKeys.size) return this.dropContainedMetricNameMatches(cleanMetrics);
        const exact = cleanMetrics.filter((metric) => explicitlyMentionedKeys.has(metric.key));
        return this.dropContainedMetricNameMatches(exact.length ? exact : cleanMetrics);
    }

    private resolveExactDynamicMetricNameMentions(question: string): AssistantMetric[] {
        const normalizedQuestion = this.normalizeOverrideText(
            String(question || "").replace(/\b(area|rent|sales|ocr|units?|sqm|m2)of\b/ig, "$1 of")
        );
        if (!normalizedQuestion) return [];
        const wrappedQuestion = ` ${normalizedQuestion} `;
        const matches = (this.context.metrics || [])
            .filter((metric) => !isDimensionMetric(metric))
            .filter((metric) => {
                const label = this.normalizeOverrideText(metric.name || "");
                return label.length >= 3 && wrappedQuestion.indexOf(` ${label} `) >= 0;
            })
            .sort((a, b) => this.normalizeOverrideText(b.name || "").length - this.normalizeOverrideText(a.name || "").length);
        return this.mergeMetricPriorityLists(matches);
    }

    private mergeMetricPriorityLists(...lists: AssistantMetric[][]): AssistantMetric[] {
        const seen = new Set<string>();
        const out: AssistantMetric[] = [];
        lists.forEach((list) => {
            (list || []).forEach((metric) => {
                const key = String(metric?.key || "");
                if (!key || seen.has(key)) return;
                seen.add(key);
                out.push(metric);
            });
        });
        return out;
    }

    private getLookupMetricPhrases(parsed: ParsedAssistantQuestion): string[] {
        const raw = String(parsed.raw || parsed.normalized || "");
        const sources: string[] = [];
        const metricSide = raw.match(/\b(?:what|show|tell|get|give|find)?\s*(?:is|are|the)?\s*(.+?)\s+\b(?:of|for)\b\s+.+$/i);
        if (metricSide?.[1]) sources.push(metricSide[1]);
        if (parsed.explicitMetricPhrase) sources.push(parsed.explicitMetricPhrase);
        (parsed.metricPhrases || []).forEach((phrase) => sources.push(phrase));
        const pieces = sources
            .map((source) => String(source || "")
                .replace(/\b(?:what|show|tell|get|give|find|is|are|the|value|field|metric|measure)\b/ig, " ")
                .replace(/\b(sales|revenue|turnover)\s*(?:per|\/)?\s*(sqm|sq\s*m|m2|area)\b/gi, "$1/sqm")
                .replace(/\b(rent|rental|lease)\s*(?:per|\/)?\s*(sqm|sq\s*m|m2|area)\b/gi, "$1/sqm")
                .replace(/\s+/g, " ")
                .trim())
            .flatMap((source) => source.split(/\s*,\s*|\s+;\s*|\s+\band\b\s+|\s+\bplus\b\s+/i))
            .map((part) => part.replace(/\b(?:chart|table|graph|visual)\b/ig, " "))
            .map((part) => part.replace(/[?!.;]+$/g, "").replace(/\s+/g, " ").trim())
            .filter((part) => part && !/^(tenant|tenants|unit|units|category|categories|group|groups|zone|zones|floor|floors|layer|layers|bookmark|bookmarks)$/i.test(part));
        return Array.from(new Set(pieces));
    }

    private resolveMetricsInPhraseOrder(phrases: string[], limit: number): AssistantMetric[] {
        const expanded = (phrases || []).reduce((out: AssistantMetric[], phrase) => {
            this.expandMetricIntentPhrase(phrase).forEach((metric) => {
                if (!out.some((item) => item.key === metric.key)) out.push(metric);
            });
            return out;
        }, []);
        const resolved = this.metricResolver.resolvePhrases(phrases, {
            limit,
            allowAliases: true,
            allowFallback: true
        });
        return this.dropContainedMetricNameMatches(resolved.length ? resolved : expanded).slice(0, limit);
    }

    private expandMetricIntentPhrase(phrase: string): AssistantMetric[] {
        const q = String(phrase || "").toLowerCase().replace(/\s+/g, " ").trim();
        const dynamic = (this.context.metrics || []).filter((metric) => metric.kind === "dynamic");
        const haystack = (metric: AssistantMetric): string => [metric.name].concat(metric.aliases || []).join(" ").toLowerCase();
        if (/^(growth|growth metrics?|performance growth|growth opportunity|growth opportunities)$/.test(q)) {
            return dynamic
                .filter((metric) => /\b(growth|mom|ytd|yoy|annual|change|increase)\b/.test(haystack(metric)))
                .slice(0, 8);
        }
        if (/\b(rent pressure|rent stress|cost pressure|lease pressure)\b/.test(q)) {
            return dynamic.filter((metric) => /\b(ocr|occupancy cost|cost ratio|rent to sales|rent sales ratio)\b/.test(haystack(metric))).slice(0, 3);
        }
        if (/\b(sales productivity|revenue productivity|sales per area|sales per sqm|sales\s+sqm|sales\/sqm|revenue\s+sqm|revenue\/sqm|turnover\s+sqm|turnover\/sqm)\b/.test(q)) {
            const preferred = dynamic.filter((metric) => /\b(sales|revenue|turnover)\b/.test(haystack(metric)) && /\b(sqm|sq m|m2|area|productivity|psm|per)\b/.test(haystack(metric)));
            return (preferred.length ? preferred : dynamic.filter((metric) => /\b(sales|revenue|turnover)\b/.test(haystack(metric)))).slice(0, 4);
        }
        if (/\b(rent productivity|rent per area|rent per sqm|rent\s+sqm|rent\/sqm|rent psm|rental per sqm|rental\s+sqm|lease per sqm|lease\s+sqm)\b/.test(q)) {
            const preferred = dynamic.filter((metric) => /\b(rent|rental|lease)\b/.test(haystack(metric)) && /\b(sqm|sq m|m2|area|productivity|psm|per)\b/.test(haystack(metric)));
            return (preferred.length ? preferred : dynamic.filter((metric) => /\b(rent|rental|lease)\b/.test(haystack(metric)))).slice(0, 4);
        }
        return [];
    }

    private normalizeAutocompleteText(value: string): string {
        return String(value || "")
            .toLowerCase()
            .replace(/&/g, " and ")
            .replace(/[^a-z0-9]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    private compactAutocompleteText(value: string): string {
        return this.normalizeAutocompleteText(value).replace(/\s+/g, "");
    }

    private buildAutocompleteIndex(): AssistantAutocompleteIndex {
        const metricLabelSet = new Set<string>();
        (this.context.metrics || []).forEach((metric) => {
            [metric.name].concat(metric.aliases || []).forEach((label) => {
                const clean = this.normalizeAutocompleteText(String(label || ""));
                if (clean) metricLabelSet.add(clean);
            });
        });
        const filterKeys = new Set<string>();
        (this.context.fieldNames || []).filter((key) => this.isAssistantFieldAllowed(key)).forEach((key) => {
            if (String(key || "").trim()) filterKeys.add(key);
        });
        (this.context.dataDictionary?.fields || [])
            .filter((field) => field.enabled !== false)
            .forEach((field) => {
                [field.displayName, field.actualName].concat(field.synonyms || []).forEach((label) => {
                    const clean = String(label || "").trim();
                    if (clean) filterKeys.add(clean);
                });
            });
        (this.context.rows || []).forEach((row) => {
            Object.keys(row?.filters || {}).forEach((key) => {
                if (!this.isAssistantFieldAllowed(key)) return;
                if (String(key || "").trim()) filterKeys.add(key);
            });
        });
        (this.context.metrics || []).forEach((metric) => {
            const label = String(metric.name || "").trim();
            if (/\bassigned\b/i.test(label) && /\b(tenant|name|category|group|brand|segment|class|type)\b/i.test(label)) {
                filterKeys.add(label);
            }
        });
        const filterFieldKeys = Array.from(filterKeys)
            .filter((fieldKey) => !this.isKnownMetricLabel(fieldKey))
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
        const valueBuckets = new Map<string, {
            type: SelectedAssistantToken["type"];
            label: string;
            indices: number[];
            subtitle: string;
            detail?: string;
            fieldName?: string;
        }>();
        const addBucket = (type: SelectedAssistantToken["type"], label: string, idx: number, subtitle: string, detail?: string) => {
            const clean = String(label || "").trim();
            if (!clean || /^n\/a$|^na$|^none$|^null$|^undefined$|^-$/i.test(clean)) return;
            const key = `${type}:${this.normalizeAutocompleteText(clean)}`;
            const existing = valueBuckets.get(key);
            if (existing) {
                if (existing.indices.length < 500) existing.indices.push(idx);
                return;
            }
            valueBuckets.set(key, { type, label: clean, indices: [idx], subtitle, detail, fieldName: type === "filter" ? subtitle : undefined });
        };
        (this.context.rows || []).forEach((row) => {
            if (this.isAssistantFieldAllowed("Assigned Tenant Name")) addBucket("tenant", this.strictRowFieldValue(row.idx, "Assigned Tenant Name") || row.tenant, row.idx, "Assigned Tenant Name", row.category || row.group || undefined);
            if (this.isAssistantFieldAllowed("Assigned Sales Category")) addBucket("category", row.category, row.idx, "Category");
            if (this.isAssistantFieldAllowed("Assigned Group")) addBucket("group", row.group, row.idx, "Group");
            if (this.isAssistantFieldAllowed("Floor")) (row.floors || []).forEach((floor) => addBucket("floor", floor, row.idx, "Floor"));
            Object.keys(row.filters || {}).forEach((field) => {
                if (!this.isAssistantFieldAllowed(field)) return;
                if (this.isKnownMetricLabel(field) || metricLabelSet.has(this.normalizeAutocompleteText(field))) return;
                addBucket("filter", (row.filters || {})[field], row.idx, field);
            });
        });
        return {
            filterFieldKeys,
            filterFieldKeySet: new Set(filterFieldKeys.map((key) => this.compactAutocompleteText(key))),
            normalizedFilterFieldKeySet: new Set(filterFieldKeys.map((key) => this.normalizeAutocompleteText(key))),
            valueItems: Array.from(valueBuckets.values())
        };
    }

    searchForAutocomplete(query: string, limit: number = 10, contextHint: "metric" | "entity" | "any" | "tenant" | "category" | "group" | "zone" | "floor" | "layer" = "any"): AssistantAutocompleteItem[] {
        const start = this.performanceNow();
        const normalizedQuery = this.normalizeAutocompleteText(query);
        const cacheKey = normalizedQuery ? `${contextHint}::${limit}::${normalizedQuery}` : "";
        const cacheHit = !!(cacheKey && this.autocompleteCache.has(cacheKey));
        const items = this.searchForAutocompleteCore(query, limit, contextHint);
        this.lastAutocompletePerformance = {
            query: String(query || ""),
            contextHint,
            limit,
            resultCount: items.length,
            totalMs: Math.round((this.performanceNow() - start) * 10) / 10,
            cacheHit
        };
        return items;
    }

    searchForValueAutocomplete(query: string, limit: number = 10): AssistantAutocompleteItem[] {
        const normalizeAc = (value: string): string => this.normalizeAutocompleteText(value);
        const raw = String(query || "").replace(/^@+/, "").trim();
        const prefixMatch = raw.match(/^(?:(assigned)\s+)?(tenant|tenants|brand|brands|shop|shops|store|stores|group|groups|category|categories|cat|sales\s+category|unit|units|floor|floors|level|levels|zone|zones|layer|layers)(?:\s+(.+))?$/i);
        const prefixText = prefixMatch ? `${prefixMatch[1] ? `${prefixMatch[1]} ` : ""}${prefixMatch[2] || ""}` : "";
        const valueQuery = (prefixMatch ? String(prefixMatch[3] || "") : raw).trim();
        const prefixKind = normalizeAc(prefixText);
        const q = normalizeAc(valueQuery);
        const cacheKey = `${limit}::${prefixKind}::${q}`;
        const cached = this.valueAutocompleteCache.get(cacheKey);
        if (cached) return cached.slice(0, limit);
        const boundedEditDistance = (a: string, b: string, limit: number): number => {
            if (Math.abs(a.length - b.length) > limit) return limit + 1;
            const prev = new Array(b.length + 1);
            const curr = new Array(b.length + 1);
            for (let j = 0; j <= b.length; j += 1) prev[j] = j;
            for (let i = 1; i <= a.length; i += 1) {
                curr[0] = i;
                let rowMin = curr[0];
                for (let j = 1; j <= b.length; j += 1) {
                    const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
                    curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
                    rowMin = Math.min(rowMin, curr[j]);
                }
                if (rowMin > limit) return limit + 1;
                for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
            }
            return prev[b.length];
        };
        const fuzzyScore = (item: AssistantAutocompleteItem): number | null => {
            if (q.length < 3) return null;
            const queryWords = q.split(/\s+/g).filter((word) => word.length >= 2);
            const candidates = [item.label, item.subtitle || "", item.detail || ""]
                .map(normalizeAc)
                .filter(Boolean);
            let best: number | null = null;
            candidates.forEach((candidate) => {
                const words = candidate.split(/\s+/g).filter(Boolean);
                if (!words.length) return;
                let at = 0;
                let total = 0;
                for (const queryWord of queryWords) {
                    let bestIndex = -1;
                    let bestWordScore = Number.POSITIVE_INFINITY;
                    for (let i = at; i < words.length; i += 1) {
                        const word = words[i];
                        let wordScore = Number.POSITIVE_INFINITY;
                        if (word.startsWith(queryWord)) wordScore = 0.25;
                        else {
                            const prefix = word.slice(0, Math.min(word.length, queryWord.length));
                            const limitDistance = queryWord.length <= 5 ? 1 : 2;
                            const distance = boundedEditDistance(queryWord, prefix, limitDistance);
                            if (distance <= limitDistance) wordScore = 1.3 + distance * 0.4;
                        }
                        if (wordScore < bestWordScore) {
                            bestWordScore = wordScore;
                            bestIndex = i;
                        }
                    }
                    if (bestIndex < 0 || bestWordScore > 2.5) {
                        total = Number.POSITIVE_INFINITY;
                        break;
                    }
                    total += bestWordScore;
                    at = bestIndex + 1;
                }
                if (!Number.isFinite(total)) return;
                const score = 5 + total + Math.max(0, words.length - queryWords.length) * 0.05;
                best = best === null ? score : Math.min(best, score);
            });
            return best;
        };
        const kindMatches = (item: AssistantAutocompleteItem): boolean => {
            if (!prefixKind) return true;
            const subtitle = normalizeAc(item.subtitle || "");
            const type = String(item.type || "");
            if (/\btenant|brand|shop|store\b/.test(prefixKind)) return type === "tenant" || /\btenant|brand|shop|store\b/.test(subtitle);
            if (/\bgroup\b/.test(prefixKind)) return type === "group" || /\bgroup\b/.test(subtitle);
            if (/\bcategory|cat|sales category\b/.test(prefixKind)) return type === "category" || /\bcategory|sales category\b/.test(subtitle);
            if (/\bunit\b/.test(prefixKind)) return type === "unit" || /\bunit\b/.test(subtitle);
            if (/\bfloor|level\b/.test(prefixKind)) return type === "floor" || /\bfloor|level\b/.test(subtitle);
            if (/\bzone\b/.test(prefixKind)) return type === "zone" || /\bzone\b/.test(subtitle);
            if (/\blayer\b/.test(prefixKind)) return type === "layer" || /\blayer\b/.test(subtitle);
            return true;
        };
        const scoreLabel = (item: AssistantAutocompleteItem): number => {
            const label = normalizeAc(item.label || "");
            const subtitle = normalizeAc(item.subtitle || "");
            const detail = normalizeAc(item.detail || "");
            if (!q) return 0;
            if (label === q) return 0;
            if (label.startsWith(q)) return 1;
            if (label.includes(q)) return 2;
            if (subtitle.includes(q)) return 3;
            if (detail.includes(q)) return 4;
            const fuzzy = fuzzyScore(item);
            if (fuzzy !== null) return fuzzy;
            return 99;
        };
        const valueBusinessKind = (item: AssistantAutocompleteItem): string => {
            const subtitle = normalizeAc(item.subtitle || "");
            const type = String(item.type || "");
            if (/\bassigned\s+tenant\b|\btenant\s+name\b|\btenant\b|\bbrand\b|\bshop\b|\bstore\b/.test(subtitle)) return "tenant";
            if (/\bassigned\s+group\b|\bgroup\b/.test(subtitle)) return "group";
            if (/\bassigned\s+sales\s+category\b|\bsales\s+category\b|\bcategory\b/.test(subtitle)) return "category";
            if (/\bunit\b/.test(subtitle)) return "unit";
            if (/\bfloor\b|\blevel\b/.test(subtitle)) return "floor";
            if (/\bzone\b/.test(subtitle)) return "zone";
            if (/\blayer\b/.test(subtitle)) return "layer";
            return type;
        };
        const seen = new Set<string>();
        const candidates: Array<AssistantAutocompleteItem & { score: number }> = [];
        const addCandidate = (item: AssistantAutocompleteItem) => {
            if (!kindMatches(item)) return;
            const score = scoreLabel(item);
            if (q && score >= 99) return;
            candidates.push({ ...item, score });
        };
        for (const item of this.autocompleteIndex.valueItems) {
            addCandidate({
                type: item.type,
                id: item.type === "filter"
                    ? `value:${item.type}:${normalizeAc(item.subtitle)}:${normalizeAc(item.label)}`
                    : `value:${item.type}:${normalizeAc(item.label)}`,
                label: item.label,
                subtitle: item.subtitle,
                detail: item.detail,
                fieldName: item.fieldName,
                indices: item.indices
            });
            if (candidates.length >= 80) break;
        }
        for (const entity of (this.context.entities || [])) {
            if (entity.kind !== "unit" && entity.kind !== "zone" && entity.kind !== "layer") continue;
            addCandidate({
                type: entity.kind as SelectedAssistantToken["type"],
                id: entity.id,
                label: this.autocompleteEntityLabel(entity),
                subtitle: entity.kind === "unit" ? "Unit" : entity.kind === "zone" ? "Zone" : "Layer",
                detail: this.autocompleteEntityDetail(entity),
                indices: entity.indices.slice(0, 500)
            });
            if (candidates.length >= 120) break;
        }
        const items = candidates
            .sort((a, b) => a.score - b.score || String(a.subtitle || "").localeCompare(String(b.subtitle || ""), undefined, { sensitivity: "base" }) || String(a.label || "").localeCompare(String(b.label || ""), undefined, { sensitivity: "base", numeric: true }))
            .filter((item) => {
                const key = `${valueBusinessKind(item)}:${normalizeAc(item.label || "")}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .map(({ score: _score, ...item }) => item)
            .slice(0, limit);
        if (this.valueAutocompleteCache.size > 200) this.valueAutocompleteCache.clear();
        this.valueAutocompleteCache.set(cacheKey, items);
        return items;
    }

    searchForFieldValueAutocomplete(fieldPhrase: string, query: string, limit: number = 10): AssistantAutocompleteItem[] {
        const normalizeAc = (value: string): string => this.normalizeAutocompleteText(value);
        const field = this.resolveScopedValueField(fieldPhrase);
        if (!field) return [];
        const q = normalizeAc(String(query || "").trim());
        const cacheKey = `field-value::${limit}::${normalizeAc(field)}::${q}`;
        const cached = this.valueAutocompleteCache.get(cacheKey);
        if (cached) return cached.slice(0, limit);
        const buckets = new Map<string, { label: string; indices: number[] }>();
        (this.context.rows || []).forEach((row) => {
            const rawValue = this.strictRowFieldValue(row.idx, field);
            String(rawValue || "")
                .split(/\s*,\s*/g)
                .map((value) => value.trim())
                .filter(Boolean)
                .forEach((value) => {
                    if (/^n\/a$|^na$|^none$|^null$|^undefined$|^-$/i.test(value)) return;
                    const key = normalizeAc(value);
                    if (!key) return;
                    const existing = buckets.get(key);
                    if (existing) {
                        if (existing.indices.length < 500) existing.indices.push(row.idx);
                    } else {
                        buckets.set(key, { label: value, indices: [row.idx] });
                    }
                });
        });
        const score = (label: string): number => {
            const clean = normalizeAc(label);
            if (!q) return 0;
            if (clean === q) return 0;
            if (clean.startsWith(q)) return 1;
            if (clean.includes(q)) return 2;
            const queryWords = q.split(/\s+/g).filter(Boolean);
            if (queryWords.length && queryWords.every((word) => clean.indexOf(word) >= 0)) return 3;
            return 99;
        };
        const type = this.assistantKindForField(field) as SelectedAssistantToken["type"];
        const tokenType: SelectedAssistantToken["type"] = ["tenant", "unit", "category", "group", "zone", "floor", "layer"].indexOf(type) >= 0 ? type : "filter";
        const items = Array.from(buckets.values())
            .map((bucket) => ({ bucket, score: score(bucket.label) }))
            .filter((item) => !q || item.score < 99)
            .sort((a, b) => a.score - b.score || a.bucket.label.localeCompare(b.bucket.label, undefined, { sensitivity: "base", numeric: true }))
            .slice(0, limit)
            .map(({ bucket }): AssistantAutocompleteItem => ({
                type: tokenType,
                id: tokenType === "filter"
                    ? `value:filter:${normalizeAc(field)}:${normalizeAc(bucket.label)}`
                    : `value:${tokenType}:${normalizeAc(bucket.label)}`,
                label: bucket.label,
                subtitle: field,
                fieldName: field,
                indices: Array.from(new Set(bucket.indices)).slice(0, 500)
            }));
        if (this.valueAutocompleteCache.size > 200) this.valueAutocompleteCache.clear();
        this.valueAutocompleteCache.set(cacheKey, items);
        return items;
    }

    private resolveScopedValueField(fieldPhrase: string): string {
        const clean = this.normalizeOverrideText(String(fieldPhrase || "").replace(/[\s(]+$/g, ""));
        if (!clean) return "";
        const candidates = this.knownMatrixFields();
        const exact = candidates.find((field) =>
            this.normalizeOverrideText(field.name || "") === clean
            || (field.aliases || []).some((alias) => this.normalizeOverrideText(alias || "") === clean)
        );
        if (exact?.name) return exact.name;
        const compact = clean.replace(/\s+/g, "");
        const compactExact = candidates.find((field) =>
            this.normalizeOverrideText(field.name || "").replace(/\s+/g, "") === compact
            || (field.aliases || []).some((alias) => this.normalizeOverrideText(alias || "").replace(/\s+/g, "") === compact)
        );
        if (compactExact?.name) return compactExact.name;
        const contained = candidates
            .map((field) => ({
                field,
                labels: [field.name].concat(field.aliases || []).map((label) => this.normalizeOverrideText(label || "")).filter(Boolean)
            }))
            .filter((item) => item.labels.some((label) => label.indexOf(clean) >= 0 || clean.indexOf(label) >= 0))
            .sort((a, b) => Math.min(...a.labels.map((label) => label.length)) - Math.min(...b.labels.map((label) => label.length)))[0];
        return contained?.field?.name || "";
    }

    searchForBookmarkMeasureAutocomplete(query: string, limit: number = 10): AssistantAutocompleteItem[] {
        const normalizeAc = (value: string): string => this.normalizeAutocompleteText(value);
        const q = normalizeAc(String(query || "").replace(/^#+/, "").trim());
        const groups = (this.context.bookmarkMeasureGroups || [])
            .map((group) => ({
                id: String(group.id || group.name || "").trim(),
                name: String(group.name || "").trim(),
                metricKeys: (group.metricKeys || []).map((key) => String(key || "").trim()).filter(Boolean)
            }))
            .filter((group) => group.id && group.name && group.metricKeys.length);
        const score = (name: string): number => {
            const label = normalizeAc(name);
            if (!q) return label === "all" ? 0 : 1;
            if (label === q) return 0;
            if (label.startsWith(q)) return 1;
            if (label.includes(q)) return 2;
            return 99;
        };
        return groups
            .map((group) => ({ group, score: score(group.name) }))
            .filter((item) => !q || item.score < 99)
            .sort((a, b) => a.score - b.score || a.group.name.localeCompare(b.group.name, undefined, { sensitivity: "base", numeric: true }))
            .slice(0, limit)
            .map(({ group }) => ({
                type: "function" as const,
                id: `bookmark-measures:${group.id}`,
                label: `#${group.name}`,
                subtitle: `${group.metricKeys.length} bookmarked measure${group.metricKeys.length === 1 ? "" : "s"}`
            }));
    }

    resolveBookmarkMeasureToken(token: SelectedAssistantToken): AssistantMetric[] {
        const id = String(token.id || "").replace(/^bookmark-measures:/i, "").trim();
        const label = this.normalizeAutocompleteText(String(token.label || "").replace(/^#+/, ""));
        const group = (this.context.bookmarkMeasureGroups || []).find((item) =>
            String(item.id || "").trim() === id
            || this.normalizeAutocompleteText(String(item.name || "")) === label
        );
        if (!group) return [];
        const wanted = new Set((group.metricKeys || []).map((key) => String(key || "").trim()).filter(Boolean));
        return (this.context.metrics || []).filter((metric) => wanted.has(String(metric.key || "")));
    }

    resolveBookmarkMeasureTokenEntries(token: SelectedAssistantToken): Array<{ metric: AssistantMetric; groupName: string }> {
        const id = String(token.id || "").replace(/^bookmark-measures:/i, "").trim();
        const label = this.normalizeAutocompleteText(String(token.label || "").replace(/^#+/, ""));
        const group = (this.context.bookmarkMeasureGroups || []).find((item) =>
            String(item.id || "").trim() === id
            || this.normalizeAutocompleteText(String(item.name || "")) === label
        );
        if (!group) return [];
        const metricByKey = new Map((this.context.metrics || []).map((metric) => [String(metric.key || ""), metric] as const));
        const entries: Array<{ metric: AssistantMetric; groupName: string }> = [];
        const seen = new Set<string>();
        const metricGroups = group.metricGroups?.length
            ? group.metricGroups
            : [{ name: group.name || label || "Bookmark", metricKeys: group.metricKeys || [] }];
        metricGroups.forEach((metricGroup) => {
            const groupName = String(metricGroup.name || group.name || "Bookmark").trim();
            (metricGroup.metricKeys || []).forEach((keyRaw) => {
                const key = String(keyRaw || "").trim();
                const metric = metricByKey.get(key);
                if (!metric || seen.has(key)) return;
                seen.add(key);
                entries.push({ metric, groupName });
            });
        });
        return entries;
    }

    private searchForAutocompleteCore(query: string, limit: number = 10, contextHint: "metric" | "entity" | "any" | "tenant" | "category" | "group" | "zone" | "floor" | "layer" = "any"): AssistantAutocompleteItem[] {
        const normalizeAc = (value: string): string => this.normalizeAutocompleteText(value);
        const compactAc = (value: string): string => this.compactAutocompleteText(value);
        const q = normalizeAc(query);
        const compactQ = compactAc(query);
        const cacheKey = q ? `${contextHint}::${limit}::${q}` : "";
        if (cacheKey) {
            const cached = this.autocompleteCache.get(cacheKey);
            if (cached) return cached.slice(0, limit);
        }
        const assignedFieldQuery = /^assi(?:g(?:n(?:e?d?|ed|ened)?)?)?(?:\s|$)/i.test(q)
            || /^asign(?:e?d?)?(?:\s|$)/i.test(q);
        if (!q || q.length < 1) {
            if (contextHint === "tenant" || contextHint === "category" || contextHint === "group" || contextHint === "zone" || contextHint === "floor" || contextHint === "layer") {
                return (this.context.entities || [])
                    .filter((entity) => entity.kind === contextHint)
                    .slice(0, limit)
                    .map((entity) => ({
                        type: entity.kind as any,
                        id: entity.id,
                        label: this.autocompleteEntityLabel(entity),
                        detail: this.autocompleteEntityDetail(entity),
                        subtitle: contextHint.charAt(0).toUpperCase() + contextHint.slice(1),
                        indices: entity.indices
                    }));
            }
            if (contextHint === "metric") {
                const hasNamedSumOfArea = (this.context.metrics || []).some((metric) =>
                    metric.key !== "__builtin::area"
                    && this.normalizeOverrideText(metric.name || "") === "sum of area"
                );
                const preferredMetricNames = (this.context.matrixConfig?.fallbackValues || [])
                    .concat((this.context.heatmapSelectedKeys || [])
                        .map((key) => this.context.metrics.find((metric) => metric.key === key)?.name || "")
                        .filter(Boolean));
                const metricRank = (metric: AssistantMetric): number => {
                    const clean = this.normalizeOverrideText(metric.name || "");
                    const preferredIndex = preferredMetricNames.findIndex((name) => this.normalizeOverrideText(name) === clean);
                    if (preferredIndex >= 0) return preferredIndex;
                    if (metric.kind === "dynamic" && metric.role === "heatmap") return 20;
                    if (metric.kind === "dynamic") return 30;
                    return 80;
                };
                return (this.context.metrics || [])
                    .filter((metric) => metric.showInSuggestions !== false)
                    .filter((metric) => !(/\bassigned\b/i.test(metric.name || "") && /\b(tenant|name|category|group|brand|segment|class|type)\b/i.test(metric.name || "")))
                    .filter((metric) => !(hasNamedSumOfArea && metric.key === "__builtin::area"))
                    .slice()
                    .sort((a, b) => metricRank(a) - metricRank(b) || String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base", numeric: true }))
                    .slice(0, limit)
                    .map((metric) => ({
                        type: "metric" as const,
                        id: metric.key,
                        label: metric.name,
                        subtitle: "Metric",
                        metricKey: metric.key
                    }));
            }
            if (contextHint === "entity") {
                const entityItems = (this.context.entities || [])
                    .filter((entity) => entity.kind === "tenant"
                        || entity.kind === "category"
                        || entity.kind === "group"
                        || entity.kind === "zone"
                        || entity.kind === "floor"
                        || entity.kind === "layer")
                    .slice(0, limit)
                    .map((entity) => ({
                        type: entity.kind as any,
                        id: entity.id,
                        label: this.autocompleteEntityLabel(entity),
                        detail: this.autocompleteEntityDetail(entity),
                        subtitle: entity.kind === "tenant" ? "Tenant"
                            : entity.kind === "category" ? "Category"
                            : entity.kind === "group" ? "Group"
                            : entity.kind === "zone" ? "Zone"
                            : entity.kind === "floor" ? "Floor"
                            : "Layer",
                        indices: entity.indices
                    }));
                return entityItems;
            }
            return [];
        }
        const results: Array<AssistantAutocompleteItem & { score: number }> = [];
        const seen = new Set<string>();
        const hasStrongAutocompletePrefix = (label: string, aliases: string[] = []): boolean => {
            const candidates = [label].concat(aliases || []);
            return candidates.some((candidate) => {
                const lbl = normalizeAc(candidate);
                const compactLabel = compactAc(candidate);
                if (!lbl) return false;
                if (lbl.startsWith(q) || (!!compactQ && compactLabel.startsWith(compactQ))) return true;
                return lbl.split(/\s+/g).some((word) => word.startsWith(q));
            });
        };
        const boundedEditDistance = (a: string, b: string, limit: number): number => {
            if (Math.abs(a.length - b.length) > limit) return limit + 1;
            const prev = new Array(b.length + 1);
            const curr = new Array(b.length + 1);
            for (let j = 0; j <= b.length; j += 1) prev[j] = j;
            for (let i = 1; i <= a.length; i += 1) {
                curr[0] = i;
                let rowMin = curr[0];
                for (let j = 1; j <= b.length; j += 1) {
                    const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
                    curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
                    rowMin = Math.min(rowMin, curr[j]);
                }
                if (rowMin > limit) return limit + 1;
                for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
            }
            return prev[b.length];
        };
        const fuzzyAutocompleteScore = (label: string, aliases: string[] = []): number | null => {
            if (q.length < 4) return null;
            const candidates = [label].concat(aliases || []).map(normalizeAc).filter(Boolean);
            const queryWords = q.split(/\s+/g).filter((word) => word.length >= 2);
            if (!queryWords.length) return null;
            let best: number | null = null;
            candidates.forEach((candidate) => {
                const words = candidate.split(/\s+/g).filter(Boolean);
                if (!words.length) return;
                let at = 0;
                let total = 0;
                for (const queryWord of queryWords) {
                    let bestIndex = -1;
                    let bestWordScore = Number.POSITIVE_INFINITY;
                    for (let i = at; i < words.length; i += 1) {
                        const word = words[i];
                        let wordScore = Number.POSITIVE_INFINITY;
                        if (word.startsWith(queryWord)) wordScore = 0.2;
                        else if (queryWord.length >= 4) {
                            const prefix = word.slice(0, Math.min(word.length, queryWord.length));
                            const limit = queryWord.length <= 5 ? 1 : 2;
                            const distance = boundedEditDistance(queryWord, prefix, limit);
                            if (distance <= limit) wordScore = 1.2 + distance * 0.35;
                        }
                        if (wordScore < bestWordScore) {
                            bestWordScore = wordScore;
                            bestIndex = i;
                        }
                    }
                    if (bestIndex < 0 || bestWordScore > 2.2) {
                        total = Number.POSITIVE_INFINITY;
                        break;
                    }
                    total += bestWordScore;
                    at = bestIndex + 1;
                }
                if (!Number.isFinite(total)) return;
                const score = 3.1 + total + Math.max(0, words.length - queryWords.length) * 0.05;
                best = best === null ? score : Math.min(best, score);
            });
            return best;
        };
        const matchesQuery = (label: string, aliases: string[]): boolean => {
            const lbl = normalizeAc(label);
            const compactLabel = compactAc(label);
            const wordPrefixMatch = (candidate: string): boolean => {
                const words = normalizeAc(candidate).split(/\s+/g).filter(Boolean);
                const queryWords = q.split(/\s+/g).filter(Boolean);
                if (!queryWords.length || !words.length) return false;
                let at = 0;
                for (const queryWord of queryWords) {
                    const found = words.slice(at).findIndex((word) => word.startsWith(queryWord));
                    if (found < 0) return false;
                    at += found + 1;
                }
                return true;
            };
            if (assignedFieldQuery && /^assigned\b/.test(lbl)) {
                const relaxedQ = q.replace(/^assi(?:g(?:n(?:e?d?|ed|ened)?)?)?\b/i, "assigned")
                    .replace(/^asign(?:e?d?)?\b/i, "assigned")
                    .trim();
                const compactRelaxedQ = relaxedQ.replace(/\s+/g, "");
                if (relaxedQ === "assigned" || lbl.startsWith(relaxedQ) || (!!compactRelaxedQ && compactLabel.startsWith(compactRelaxedQ))) return true;
            }
            if (wordPrefixMatch(label) || (aliases || []).some((alias) => wordPrefixMatch(alias))) return true;
            if (lbl.startsWith(q) || lbl.includes(q) || (!!compactQ && (compactLabel.startsWith(compactQ) || compactLabel.includes(compactQ)))) return true;
            if (fuzzyAutocompleteScore(label, aliases) !== null) return true;
            return (aliases || []).some((a) => {
                const al = normalizeAc(a);
                const compactAlias = compactAc(a);
                return al.startsWith(q) || al.includes(q) || (!!compactQ && (compactAlias.startsWith(compactQ) || compactAlias.includes(compactQ)));
            });
        };
        const bestMatchedLabel = (label: string, aliases: string[]): string => {
            const labels = [label].concat(aliases || [])
                .map((item) => String(item || "").trim())
                .filter(Boolean);
            const scored = labels
                .filter((item) => matchesQuery(item, []))
                .map((item) => ({ label: item, score: scoreLabel(item) }))
                .sort((a, b) => a.score - b.score || a.label.length - b.label.length);
            return scored[0]?.label || label;
        };
        const uniqueFilterFieldKeys = this.autocompleteIndex.filterFieldKeys;
        const filterFieldKeySet = this.autocompleteIndex.filterFieldKeySet;
        const normalizedFilterFieldKeySet = this.autocompleteIndex.normalizedFilterFieldKeySet;
        const scoreLabel = (label: string): number => {
            const lbl = normalizeAc(label);
            const compactLabel = compactAc(label);
            if (lbl === q) return 0;
            if (compactLabel === compactQ) return 0.5;
            if (lbl.startsWith(q)) return 1;
            if (compactQ && compactLabel.startsWith(compactQ)) return 1.5;
            if (lbl.includes(q)) return 2;
            if (compactQ && compactLabel.includes(compactQ)) return 2.5;
            const fuzzy = fuzzyAutocompleteScore(label, []);
            if (fuzzy !== null) return fuzzy;
            return 3;
        };
        const addResult = (item: AssistantAutocompleteItem, score: number) => {
            const key = `${item.type}:${item.id}`;
            if (seen.has(key)) return;
            seen.add(key);
            results.push({ ...item, score });
        };
        const commandItems: Array<{ id: string; label: string; insertText: string; aliases: string[] }> = [
            { id: "top", label: "Top", insertText: "top ", aliases: ["top", "highest", "best", "largest", "maximum", "max"] },
            { id: "bottom", label: "Bottom", insertText: "bottom ", aliases: ["bottom", "lowest", "worst", "smallest", "minimum", "min"] }
        ];
        if (contextHint !== "metric") {
            commandItems.forEach((item) => {
                if (!matchesQuery(item.label, item.aliases)) return;
                addResult({ type: "function", id: item.id, label: item.label, subtitle: item.insertText }, scoreLabel(item.label));
            });
        }
        (this.context.entities || []).forEach((entity) => {
            const kind = entity.kind;
            if (kind !== "tenant" && kind !== "unit" && kind !== "floor" && kind !== "category" && kind !== "group" && kind !== "zone" && kind !== "layer") return;
            const aliasesForAutocomplete = kind === "category" || kind === "group" ? [] : (entity.aliases || []);
            if (!matchesQuery(entity.label, aliasesForAutocomplete)) return;
            if (kind === "tenant") {
                const units = this.unitChoicesForEntity(entity);
                if (units.length > 1) {
                    units.forEach((unit) => {
                        addResult({ type: "unit" as any, id: unit.id, label: unit.label, detail: this.autocompleteEntityDetail(unit), subtitle: "Tenant", indices: unit.indices }, scoreLabel(entity.label));
                    });
                    return;
                }
            }
            const subtitle = kind === "tenant" ? "Tenant"
                : kind === "unit" ? "Unit"
                : kind === "category" ? "Category"
                : kind === "group" ? "Group"
                : kind === "zone" ? "Zone"
                : kind === "layer" ? "Layer"
                : "Floor";
            addResult({ type: kind as any, id: entity.id, label: this.autocompleteEntityLabel(entity), detail: this.autocompleteEntityDetail(entity), subtitle, indices: entity.indices }, scoreLabel(entity.label));
        });
        let matchedFieldCount = 0;
        if (contextHint !== "metric" || /\bassigned\b/i.test(q)) {
            uniqueFilterFieldKeys.forEach((fieldKey) => {
                if (!matchesQuery(fieldKey, [])) return;
                matchedFieldCount += 1;
                addResult({
                    type: "filter",
                    id: `filter-field:${fieldKey}`,
                    label: fieldKey,
                    subtitle: "Field"
                }, scoreLabel(fieldKey) + 0.2);
            });
        }
        const fieldNameQuery = assignedFieldQuery || (matchedFieldCount > 0 && (q.indexOf(" ") >= 0 || q.length >= 4));
        if (contextHint !== "metric" && !fieldNameQuery) {
            const valueMatches: Array<typeof this.autocompleteIndex.valueItems[number] & { score: number }> = [];
            for (const item of this.autocompleteIndex.valueItems) {
                if (!matchesQuery(item.label, [item.subtitle, item.detail || ""])) continue;
                valueMatches.push({ ...item, score: scoreLabel(item.label) });
                if (valueMatches.length >= 80) break;
            }
            valueMatches
                .sort((a, b) => a.score - b.score || a.label.localeCompare(b.label))
                .slice(0, 16)
                .forEach((item) => {
                    addResult({
                        type: item.type,
                        id: item.type === "filter"
                            ? `value:${item.type}:${normalizeAc(item.subtitle)}:${normalizeAc(item.label)}`
                            : `value:${item.type}:${normalizeAc(item.label)}`,
                        label: item.label,
                        subtitle: item.subtitle,
                        detail: item.detail,
                        fieldName: item.type === "filter" ? item.subtitle : undefined,
                        indices: item.indices
                    }, item.score + (item.type === "tenant" ? 0.35 : 0.55));
                });
        }
        (this.context.metrics || []).forEach((metric) => {
            if (metric.showInSuggestions === false) return;
            const metricLabels = [metric.name].concat(metric.aliases || []);
            const metricNameLooksLikeFilterField = metricLabels.some((label) => filterFieldKeySet.has(compactAc(label)) || normalizedFilterFieldKeySet.has(normalizeAc(label)))
                && (metric.formatHint === "text" || /\b(assigned|category|group|tenant|brand|segment|class|type)\b/i.test(metric.name || ""));
            if (metricNameLooksLikeFilterField) return;
            if (!matchesQuery(metric.name, metric.aliases || [])) return;
            if (q.length < 5 && !hasStrongAutocompletePrefix(metric.name, metric.aliases || [])) return;
            const matchedLabel = bestMatchedLabel(metric.name, metric.aliases || []);
            const label = String(metric.name || "").trim();
            if (!label) return;
            const exactNameBoost = normalizeAc(metric.name || "") === q ? -0.45 : 0;
            const aliasPenalty = normalizeAc(metric.name || "") !== normalizeAc(matchedLabel) ? 0.12 : 0;
            const labelScore = Math.min(scoreLabel(label), scoreLabel(matchedLabel) + aliasPenalty);
            addResult({
                type: "metric",
                id: metric.key,
                label,
                subtitle: "Metric",
                metricKey: metric.key
            }, labelScore + exactNameBoost);
        });
        const typeRank = (type: string): number => {
            if (contextHint === "metric") {
                if (type === "metric") return 0;
                if (type === "function") return 1;
            }
            const order: Record<string, number> = {
                function: 0,
                filter: assignedFieldQuery ? 0 : 4,
                metric: assignedFieldQuery ? 5 : 1,
                group: fieldNameQuery ? 4 : 2,
                category: fieldNameQuery ? 4 : 3,
                tenant: 5,
                unit: 6,
                zone: 7,
                layer: 8,
                floor: 9,
                example: 9
            };
            return order[type] ?? 10;
        };
        const businessKind = (item: AssistantAutocompleteItem): string => {
            const subtitle = normalizeAc(item.subtitle || "");
            if (/\bassigned\s+group\b|\bgroup\b/.test(subtitle)) return "group";
            if (/\bassigned\s+sales\s+category\b|\bsales\s+category\b|\bcategory\b/.test(subtitle)) return "category";
            if (/\bassigned\s+tenant\b|\btenant\b|\bbrand\b|\bshop\b|\bstore\b/.test(subtitle)) return "tenant";
            if (/\bunit\b/.test(subtitle)) return "unit";
            if (/\bzone\b/.test(subtitle)) return "zone";
            if (/\bfloor\b|\blevel\b/.test(subtitle)) return "floor";
            if (/\blayer\b/.test(subtitle)) return "layer";
            return String(item.type || "");
        };
        const duplicateRank = (item: AssistantAutocompleteItem): number => {
            const subtitle = normalizeAc(item.subtitle || "");
            if (item.type === "metric") return -1;
            if (item.type === "filter" && /^assigned\s+/.test(subtitle)) return 0;
            if (item.type === "filter" && /\b(?:group|category|tenant|unit|zone|floor|layer)\b/.test(subtitle)) return 1;
            if (item.type === "group" || item.type === "category" || item.type === "tenant" || item.type === "unit") return 2;
            if (item.type === "filter") return 3;
            return 4;
        };
        const sorted = results
            .sort((a, b) => typeRank(a.type) - typeRank(b.type) || a.score - b.score || a.label.localeCompare(b.label));
        const deduped: Array<AssistantAutocompleteItem & { score: number }> = [];
        const byBusinessValue = new Map<string, number>();
        sorted.forEach((item) => {
            const key = `${businessKind(item)}:${normalizeAc(item.label)}`;
            const existingIndex = byBusinessValue.get(key);
            if (existingIndex === undefined) {
                byBusinessValue.set(key, deduped.length);
                deduped.push(item);
                return;
            }
            const existing = deduped[existingIndex];
            if (duplicateRank(item) < duplicateRank(existing)
                || (duplicateRank(item) === duplicateRank(existing) && item.score < existing.score)) {
                deduped[existingIndex] = item;
            }
        });
        const finalItems = deduped
            .slice(0, limit)
            .map(({ score: _score, ...item }) => item);
        if (cacheKey) {
            if (this.autocompleteCache.size > 250) this.autocompleteCache.clear();
            this.autocompleteCache.set(cacheKey, finalItems);
        }
        return finalItems;
    }

    private tryFallbackIntent(parsed: ParsedAssistantQuestion, entities: AssistantEntity[], metrics: AssistantMetric[]): AssistantResponse | null {
        if (parsed.intent === "rank" && (entities.length > 0 || metrics.length > 0)) {
            return answerRank(this.context, parsed, entities, metrics);
        }
        if (parsed.intent === "list") {
            return answerList(this.context, parsed, entities);
        }
        if (parsed.intent === "summary") {
            const entity = entities[0];
            return entity ? answerSummary(this.context, entity, metrics) : null;
        }
        return null;
    }

    private getTypedFilterBreakdownFields(parsed: ParsedAssistantQuestion): string[] {
        const raw = String(parsed.raw || parsed.normalized || "").toLowerCase();
        if (parsed.chartType) return [];
        const source = parsed.topBottom?.dimensionType === "filter" && parsed.topBottom.dimensionField
            ? parsed.topBottom.dimensionField
            : raw.match(/\bby\s+(.+?)(?:\s+\b(?:in|inside|within|under|from|on|at|as)\b|$)/i)?.[1]
            || raw.match(/\b(?:of|for)\s+(.+?)$/i)?.[1]
            || "";
        if (!source) return [];
        if (this.isKnownMetricLabel(source)) return [];
        const normalizeField = (value: string): string => String(value || "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        const fields = Array.from(new Set((this.context.rows || []).reduce((out: string[], row) => {
            Object.keys(row?.filters || {}).forEach((key) => {
                if (String(key || "").trim()) out.push(key);
            });
            return out;
        }, [])));
        return fields
            .filter((field) => {
                const clean = normalizeField(field);
                return clean
                    && !this.isKnownMetricLabel(field)
                    && (normalizeField(source) === clean || normalizeField(source).indexOf(clean) >= 0 || clean.indexOf(normalizeField(source)) >= 0);
            })
            .slice(0, 4);
    }

    private getChartBreakdownFields(parsed: ParsedAssistantQuestion): string[] {
        if (!parsed.chartType) return [];
        const raw = String(parsed.raw || parsed.normalized || "");
        if (/\b(matrix|pivot|cross\s*tab|crosstab)\b/i.test(raw)) return [];
        const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        let fields = (parsed.matrix?.rows || [])
            .concat(parsed.matrix?.columns || [])
            .concat(parsed.requestedFields?.rows || [])
            .concat(parsed.requestedFields?.columns || [])
            .map((field) => String(field || "").trim())
            .filter(Boolean)
            .filter((field) => !this.isKnownMetricLabel(field))
            .filter((field, index, arr) => arr.findIndex((item) => this.normalizeOverrideText(item) === this.normalizeOverrideText(field)) === index);
        if (!fields.length) {
            const normalizedRaw = this.normalizeOverrideText(raw);
            fields = this.knownMatrixFields()
                .filter((field) => !this.isKnownMetricLabel(field.name))
                .filter((field) => {
                    const labels = [field.name].concat(field.aliases || []);
                    return labels.some((label) => {
                        const clean = this.normalizeOverrideText(label);
                        return clean && new RegExp(`(?:^|\\b)${escapeRegex(clean)}(?:\\b|$)`, "i").test(normalizedRaw);
                    });
                })
                .map((field) => field.name)
                .filter((field, index, arr) => arr.findIndex((item) => this.normalizeOverrideText(item) === this.normalizeOverrideText(field)) === index);
        }
        if (!fields.length) return [];
        if (parsed.chartType === "donut") return fields.slice(0, 1);
        return fields.slice(0, 2);
    }

    private buildContextualFailureResponse(parsed: ParsedAssistantQuestion, fuzzyEntitySuggestions: string[]): AssistantResponse {
        const metricNames = this.getMetricSuggestions(3);
        const tenantNames = (this.context.entities || [])
            .filter((e) => e.kind === "tenant")
            .slice(0, 3)
            .map((e) => e.label);
        const contextSuggestions: string[] = fuzzyEntitySuggestions.length > 0
            ? fuzzyEntitySuggestions
            : ([
                tenantNames.length > 0 ? `Show ${tenantNames[0]} area` : "",
                metricNames.length > 0 ? `Top 10 by ${metricNames[0]}` : "",
                "List all tenants",
                "Show occupancy"
            ].filter(Boolean) as string[]);
        const entityHint = parsed.entityPhrases.length > 0
            ? ` I couldn't find "${parsed.entityPhrases[0]}".`
            : "";
        return {
            handled: true,
            text: `I'm not sure how to answer that.${entityHint} Here are some things you can try:`,
            suggestions: contextSuggestions.slice(0, 5)
        };
    }

}
