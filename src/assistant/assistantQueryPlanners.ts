import { AssistantAnswerContext } from "./assistantTypes";
import { ExtractedQuestion } from "./assistantQuestionSlotExtractor";

export interface PlannedChartQuery {
    chartType: "bar" | "column" | "line" | "pie" | "donut" | "area";
    category?: string;
    series?: string;
    values: string[];
    filters: string[];
    topN?: number;
    sort?: { by: "value" | "label"; direction: "asc" | "desc" };
}

export interface PlannedListQuery {
    target: string;
    filters: string[];
}

export interface PlannedCountQuery {
    target: string;
    filters: string[];
}

function clean(value: unknown): string {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function normalize(value: unknown): string {
    return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function unique(values: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    values.forEach((value) => {
        const label = clean(value);
        const key = normalize(label);
        if (!label || !key || seen.has(key)) return;
        seen.add(key);
        out.push(label);
    });
    return out;
}

function filterTexts(extracted: ExtractedQuestion): string[] {
    return unique((extracted.filters || []).map((filter) => filter.value));
}

function fieldKind(field: string): "tenant" | "unit" | "category" | "group" | "zone" | "floor" | "layer" | "filter" {
    const value = normalize(field);
    if (/tenant|brand|shop|store/.test(value)) return "tenant";
    if (/unit|space/.test(value)) return "unit";
    if (/category|sales category|segment|class|type/.test(value)) return "category";
    if (/group|department/.test(value)) return "group";
    if (/zone|region/.test(value)) return "zone";
    if (/floor|level/.test(value)) return "floor";
    if (/layer/.test(value)) return "layer";
    return "filter";
}

function canonicalTarget(field?: string): string {
    const kind = fieldKind(field || "");
    if (kind === "tenant") return "Assigned Tenant Name";
    if (kind === "unit") return "Unit";
    if (kind === "category") return "Assigned Sales Category";
    if (kind === "group") return "Assigned Group";
    if (kind === "zone") return "Zone";
    if (kind === "floor") return "Floor";
    if (kind === "layer") return "Layer";
    return clean(field) || "Assigned Tenant Name";
}

export class ChartQueryPlanner {
    constructor(private readonly ctx: AssistantAnswerContext) {}

    plan(extracted: ExtractedQuestion): PlannedChartQuery | null {
        const chartType = extracted.chartType === "bar"
            || extracted.chartType === "column"
            || extracted.chartType === "line"
            || extracted.chartType === "pie"
            || extracted.chartType === "donut"
            || extracted.chartType === "area"
            ? extracted.chartType
            : undefined;
        if (!chartType) return null;
        const fields = unique((extracted.axes.rows || [])
            .concat(extracted.axes.columns || [])
            .concat(extracted.fields || []));
        const category = fields[0] ? canonicalTarget(fields[0]) : undefined;
        const series = chartType === "pie" || chartType === "donut" ? undefined : (fields[1] ? canonicalTarget(fields[1]) : undefined);
        const values = unique(extracted.measures || []);
        const fallback = this.defaultMetric();
        const plannedValues = values.length ? values : (fallback ? [fallback] : []);
        if (!category && !plannedValues.length) return null;
        return {
            chartType,
            category,
            series,
            values: plannedValues,
            filters: filterTexts(extracted),
            topN: extracted.rank?.limit,
            sort: extracted.rank ? { by: "value", direction: extracted.rank.direction === "bottom" ? "asc" : "desc" } : undefined
        };
    }

    private defaultMetric(): string {
        const configured = (this.ctx.matrixConfig?.fallbackValues || []).map(clean).find(Boolean);
        if (configured) return configured;
        const selectedKeys = this.ctx.heatmapSelectedKeys || [];
        for (const key of selectedKeys) {
            const metric = (this.ctx.metrics || []).find((item) => item.key === key);
            if (metric) return metric.name;
        }
        return (this.ctx.metrics || []).find((metric) => metric.kind === "dynamic" && metric.role === "heatmap")?.name
            || (this.ctx.metrics || []).find((metric) => metric.kind === "dynamic")?.name
            || "";
    }
}

export class ListQueryPlanner {
    plan(extracted: ExtractedQuestion): PlannedListQuery | null {
        const target = canonicalTarget(extracted.fields[0] || extracted.rank?.dimensionField || "Assigned Tenant Name");
        return { target, filters: filterTexts(extracted) };
    }
}

export class CountQueryPlanner {
    plan(extracted: ExtractedQuestion): PlannedCountQuery | null {
        const target = canonicalTarget(extracted.fields[0] || extracted.rank?.dimensionField || "Unit");
        return { target, filters: filterTexts(extracted) };
    }
}
