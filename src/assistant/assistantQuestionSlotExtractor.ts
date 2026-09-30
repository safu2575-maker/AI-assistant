import {
    AssistantAnswerContext,
    AssistantEntityKind,
    AssistantMetric
} from "./assistantTypes";
import { normalizeAssistantText } from "./assistantParser";
import { isDimensionMetric } from "./assistantMetricResolver";

export type ExtractedIntent = "matrix" | "chart" | "rank" | "percentile" | "count" | "lookup" | "list" | "compare" | "unknown";

export interface ExtractedEntitySlot {
    label: string;
    kind: AssistantEntityKind | "filterValue";
    field?: string;
    indices?: number[];
}

export interface ExtractedFilterSlot {
    field?: string;
    value: string;
    kind?: AssistantEntityKind;
    indices?: number[];
}

export interface ExtractedQuestion {
    intent: ExtractedIntent;
    confidence: number;
    reasons: string[];
    measures: string[];
    fields: string[];
    entities: ExtractedEntitySlot[];
    axes: {
        rows: string[];
        columns: string[];
    };
    axesExplicit?: {
        rows: boolean;
        columns: boolean;
    };
    filters: ExtractedFilterSlot[];
    chartType?: "table" | "bar" | "column" | "line" | "pie" | "donut" | "area" | "matrix";
    rank?: {
        direction: "top" | "bottom";
        limit?: number;
        dimensionField?: string;
    };
}

type SlotDoc<T> = {
    label: string;
    aliases: string[];
    normalized: string[];
    item: T;
};

type Mention<T> = {
    label: string;
    normalized: string;
    start: number;
    end: number;
    exactLabel: boolean;
    item: T;
};

type FieldItem = {
    name: string;
    kind: AssistantEntityKind | "filter";
};

type EntityItem = {
    label: string;
    kind: AssistantEntityKind | "filterValue";
    field?: string;
    indices: number[];
};

function cleanText(value: unknown): string {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeSlotText(value: unknown): string {
    return normalizeAssistantText(String(value ?? ""))
        .replace(/\b(?:compaare|compar|compair|comapre)\b/g, "compare")
        .replace(/\b(area|rent|sales|ocr|units?|sqm|m2)of\b/g, "$1 of")
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9/%]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function uniqueText(values: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    values.forEach((value) => {
        const clean = cleanText(value);
        const key = normalizeSlotText(clean);
        if (!clean || !key || seen.has(key)) return;
        seen.add(key);
        out.push(clean);
    });
    return out;
}

function addDoc<T>(docs: Array<SlotDoc<T>>, label: string, aliases: string[], item: T): void {
    const normalized = uniqueText([label].concat(aliases || []))
        .map(normalizeSlotText)
        .filter((value) => value.length >= 2);
    if (!normalized.length) return;
    docs.push({ label, aliases, normalized, item });
}

function containsNormalized(text: string, phrase: string): number {
    if (!text || !phrase) return -1;
    const padded = ` ${text} `;
    const target = ` ${phrase} `;
    return padded.indexOf(target);
}

function findMentions<T>(text: string, docs: Array<SlotDoc<T>>, limit: number = 12): Array<Mention<T>> {
    const out: Array<Mention<T>> = [];
    docs.forEach((doc) => {
        let best: Mention<T> | null = null;
        doc.normalized
            .slice()
            .sort((a, b) => b.length - a.length)
            .forEach((phrase) => {
                if (best) return;
                const start = containsNormalized(text, phrase);
                if (start < 0) return;
                best = {
                    label: doc.label,
                    normalized: phrase,
                    start,
                    end: start + phrase.length,
                    exactLabel: normalizeSlotText(doc.label) === phrase,
                    item: doc.item
                };
            });
        if (best) out.push(best);
    });
    return out
        .sort((a, b) =>
            a.start - b.start
            || Number(b.exactLabel) - Number(a.exactLabel)
            || b.normalized.length - a.normalized.length
            || b.label.length - a.label.length
        )
        .filter((mention, index, arr) => {
            return !arr.some((other, otherIndex) =>
                otherIndex < index
                && mention.start >= other.start
                && mention.end <= other.end
                && other.normalized.length >= mention.normalized.length
            );
        })
        .slice(0, limit);
}

function fieldKind(name: string): FieldItem["kind"] {
    const clean = normalizeSlotText(name);
    if (/\btenant|brand|shop|store\b/.test(clean)) return "tenant";
    if (/\bunit|space\b/.test(clean)) return "unit";
    if (/\bcategory|sales category|segment|class|type\b/.test(clean)) return "category";
    if (/\bgroup|department\b/.test(clean)) return "group";
    if (/\bzone|region\b/.test(clean)) return "zone";
    if (/\bfloor|level\b/.test(clean)) return "floor";
    if (/\blayer\b/.test(clean)) return "layer";
    return "filter";
}

function canonicalFieldName(field: FieldItem): string {
    return field.name;
}

function aliasesForFieldKind(kind: FieldItem["kind"]): string[] {
    if (kind === "tenant") return ["tenant", "tenants", "tenant name", "brand", "brands", "shop", "shops", "store", "stores"];
    if (kind === "unit") return ["unit", "units", "unit id", "unit name", "space", "spaces"];
    if (kind === "category") return ["category", "categories", "sales category", "sales categories", "segment", "class", "type"];
    if (kind === "group") return ["group", "groups", "department", "departments"];
    if (kind === "zone") return ["zone", "zones", "region", "regions"];
    if (kind === "floor") return ["floor", "floors", "level", "levels", "ground floor", "first floor", "second floor"];
    if (kind === "layer") return ["layer", "layers"];
    return [];
}

function entityKindForField(field?: string): AssistantEntityKind | undefined {
    const kind = fieldKind(field || "");
    return kind === "filter" ? undefined : kind;
}

export class QuestionSlotExtractor {
    private metricDocs: Array<SlotDoc<AssistantMetric>>;
    private fieldDocs: Array<SlotDoc<FieldItem>>;
    private entityDocs: Array<SlotDoc<EntityItem>>;

    constructor(private readonly ctx: AssistantAnswerContext) {
        this.metricDocs = this.buildMetricDocs(ctx);
        this.fieldDocs = this.buildFieldDocs(ctx);
        this.entityDocs = this.buildEntityDocs(ctx);
    }

    extract(question: string): ExtractedQuestion {
        const raw = String(question || "");
        const normalized = normalizeSlotText(raw);
        const metricMentions = findMentions(normalized, this.metricDocs, 8);
        const fieldMentions = findMentions(normalized, this.fieldDocs, 8);
        const entityMentions = findMentions(normalized, this.entityDocs, 10)
            .filter((entity) => !fieldMentions.some((field) => entity.start >= field.start && entity.end <= field.end))
            .filter((entity) => !metricMentions.some((metric) => entity.start >= metric.start && entity.end <= metric.end));

        const measures = uniqueText(metricMentions.map((mention) => mention.item.name));
        const fields = uniqueText(fieldMentions.map((mention) => canonicalFieldName(mention.item)));
        const explicitAxes = this.extractAxes(normalized, fieldMentions);
        const filters = this.extractFilters(entityMentions);
        const rank = this.extractRank(normalized, fields, fieldMentions);
        const chartType = this.extractChartType(normalized);
        const countTarget = this.extractCountTarget(normalized, fields);
        const percentileTarget = this.extractPercentileTarget(normalized, fields);
        const intent = this.inferIntent(normalized, measures, fields, filters, rank, chartType, countTarget, percentileTarget);
        const axes = this.inferAxes(normalized, fields, explicitAxes);
        const confidence = this.confidence(intent, measures, fields, filters, explicitAxes, rank, chartType, countTarget, percentileTarget);
        const reasons = [
            measures.length ? "measures" : "",
            fields.length ? "fields" : "",
            filters.length ? "filters" : "",
            explicitAxes.rows.length || explicitAxes.columns.length ? "explicit_axes" : "",
            rank ? "rank_words" : "",
            percentileTarget ? "percentile_words" : "",
            countTarget ? "count_words" : ""
        ].filter(Boolean);

        return {
            intent,
            confidence,
            reasons,
            measures,
            fields: (countTarget || percentileTarget) && !fields.length ? [countTarget || percentileTarget || ""] : fields,
            entities: entityMentions.map((mention) => ({
                label: mention.item.label,
                kind: mention.item.kind,
                field: mention.item.field,
                indices: mention.item.indices
            })),
            axes,
            axesExplicit: {
                rows: explicitAxes.rows.length > 0,
                columns: explicitAxes.columns.length > 0
            },
            filters,
            chartType,
            rank: rank || percentileTarget ? {
                ...(rank || { direction: "top" as const, limit: 5 }),
                dimensionField: rank?.dimensionField || fields[0] || countTarget || percentileTarget
            } : undefined
        };
    }

    private buildMetricDocs(ctx: AssistantAnswerContext): Array<SlotDoc<AssistantMetric>> {
        const docs: Array<SlotDoc<AssistantMetric>> = [];
        const hasNamedSumOfArea = (ctx.metrics || []).some((metric) =>
            normalizeSlotText(metric.name || "") === "sum of area"
        );
        (ctx.metrics || []).forEach((metric) => {
            if (isDimensionMetric(metric)) return;
            const aliases = (metric.aliases || [])
                .concat(metric.name)
                .concat([
                    `sum of ${metric.name}`,
                    `total ${metric.name}`,
                    `total of ${metric.name}`,
                    `average ${metric.name}`,
                    `average of ${metric.name}`
                ]);
            if (metric.key === "__builtin::area" || /^area$/i.test(metric.name)) {
                aliases.push("sqm", "gla");
                if (!hasNamedSumOfArea) aliases.push("sum of area", "total area");
            }
            if (metric.key === "__builtin::units" || /^units?$/i.test(metric.name)) {
                aliases.push("number of units", "count of units", "unit count");
            }
            addDoc(docs, metric.name, aliases, metric);
        });
        return docs;
    }

    private buildFieldDocs(ctx: AssistantAnswerContext): Array<SlotDoc<FieldItem>> {
        const fields: Array<{ name: string; aliases: string[]; kind: FieldItem["kind"] }> = [];
        const availableFields = new Set<string>();
        (ctx.fieldNames || []).forEach((field) => {
            const clean = normalizeSlotText(field);
            if (clean) availableFields.add(clean);
        });
        (ctx.dataDictionary?.fields || [])
            .filter((field) => field.enabled !== false)
            .forEach((field) => {
                [field.actualName, field.displayName].concat(field.synonyms || []).forEach((label) => {
                    const clean = normalizeSlotText(label || "");
                    if (clean) availableFields.add(clean);
                });
            });
        (ctx.rows || []).forEach((row) => Object.keys(row?.filters || {}).forEach((field) => {
            const clean = normalizeSlotText(field);
            if (clean) availableFields.add(clean);
        }));
        const defaultFields: Array<{ name: string; aliases: string[]; kind: FieldItem["kind"] }> = [
            { name: "Assigned Tenant Name", kind: "tenant", aliases: ["tenant", "tenants", "tenant name", "brand", "brands", "shop", "shops", "store", "stores"] },
            { name: "Unit", kind: "unit", aliases: ["unit", "units", "unit id", "unit name", "space", "spaces"] },
            { name: "Assigned Sales Category", kind: "category", aliases: ["category", "categories", "sales category", "sales categories", "segment", "class", "type"] },
            { name: "Assigned Group", kind: "group", aliases: ["group", "groups", "department", "departments"] },
            { name: "Zone", kind: "zone", aliases: ["zone", "zones", "region", "regions"] },
            { name: "Floor", kind: "floor", aliases: ["floor", "floors", "level", "levels", "ground floor", "first floor", "second floor"] },
            { name: "Layer", kind: "layer", aliases: ["layer", "layers"] }
        ];
        defaultFields
            .filter((field) => [field.name].concat(field.aliases || []).some((label) => availableFields.has(normalizeSlotText(label))))
            .forEach((field) => fields.push(field));
        const metricLabels = new Set<string>();
        (ctx.metrics || []).forEach((metric) => {
            [metric.name].concat(metric.aliases || []).forEach((label) => {
                const clean = normalizeSlotText(label || "");
                if (clean) metricLabels.add(clean);
            });
        });
        const filterFields = new Set<string>();
        (ctx.fieldNames || []).forEach((field) => filterFields.add(cleanText(field)));
        (ctx.dataDictionary?.fields || [])
            .filter((field) => field.enabled !== false)
            .forEach((field) => {
                const actualName = String(field.actualName || field.displayName || "").trim();
                if (actualName) filterFields.add(cleanText(actualName));
            });
        (ctx.rows || []).forEach((row) => Object.keys(row?.filters || {}).forEach((field) => filterFields.add(cleanText(field))));
        Array.from(filterFields).forEach((field) => {
            if (!field) return;
            if (metricLabels.has(normalizeSlotText(field))) return;
            if (fields.some((item) => normalizeSlotText(item.name) === normalizeSlotText(field))) return;
            const kind = fieldKind(field);
            const configured = (ctx.dataDictionary?.fields || []).find((item) =>
                item.enabled !== false
                && normalizeSlotText(item.actualName || item.displayName || "") === normalizeSlotText(field)
            );
            const configuredAliases = configured
                ? [configured.displayName || ""].concat(configured.synonyms || []).filter(Boolean)
                : [];
            fields.push({ name: field, kind, aliases: configuredAliases.concat(kind === "filter" ? [] : aliasesForFieldKind(kind)) });
        });
        const docs: Array<SlotDoc<FieldItem>> = [];
        fields.forEach((field) => addDoc(docs, field.name, field.aliases, { name: field.name, kind: field.kind }));
        return docs;
    }

    private buildEntityDocs(ctx: AssistantAnswerContext): Array<SlotDoc<EntityItem>> {
        const availableFields = new Set<string>();
        (ctx.fieldNames || []).forEach((field) => {
            const clean = normalizeSlotText(field);
            if (clean) availableFields.add(clean);
        });
        (ctx.dataDictionary?.fields || [])
            .filter((field) => field.enabled !== false)
            .forEach((field) => {
                [field.actualName, field.displayName].concat(field.synonyms || []).forEach((label) => {
                    const clean = normalizeSlotText(label || "");
                    if (clean) availableFields.add(clean);
                });
            });
        (ctx.rows || []).forEach((row) => Object.keys(row?.filters || {}).forEach((field) => {
            const clean = normalizeSlotText(field);
            if (clean) availableFields.add(clean);
        }));
        const metricLabels = new Set<string>();
        (ctx.metrics || []).forEach((metric) => {
            [metric.name].concat(metric.aliases || []).forEach((label) => {
                const clean = normalizeSlotText(label || "");
                if (clean) metricLabels.add(clean);
            });
        });
        const values = new Map<string, EntityItem>();
        const add = (label: string, kind: EntityItem["kind"], indices: number[], field?: string, aliases: string[] = []) => {
            const clean = cleanText(label);
            const key = `${kind}:${field || ""}:${normalizeSlotText(clean)}`;
            if (!clean || !normalizeSlotText(clean)) return;
            const existing = values.get(key);
            if (existing) {
                existing.indices = uniqueNums(existing.indices.concat(indices));
                return;
            }
            values.set(key, { label: clean, kind, field, indices: uniqueNums(indices) });
            aliases.forEach((alias) => {
                const aliasKey = `${kind}:${field || ""}:${normalizeSlotText(alias)}`;
                if (!values.has(aliasKey)) values.set(aliasKey, { label: clean, kind, field, indices: uniqueNums(indices) });
            });
        };

        (ctx.entities || []).forEach((entity) => {
            add(entity.label, entity.kind, entity.indices || [], entity.meta?.field, entity.aliases || []);
        });
        const fieldAvailable = (names: string[]): boolean => names.some((name) => availableFields.has(normalizeSlotText(name)));
        const tenantFieldAvailable = fieldAvailable(["Assigned Tenant Name", "Assigned Tenant", "Tenant", "Tenant Name"]);
        const unitFieldAvailable = fieldAvailable(["Unit", "Unit ID", "Assigned Unit"]);
        const categoryFieldAvailable = fieldAvailable(["Assigned Sales Category", "Sales Category", "Category"]);
        const groupFieldAvailable = fieldAvailable(["Assigned Group", "Group"]);
        (ctx.rows || []).forEach((row) => {
            if (!row) return;
            if (tenantFieldAvailable) add(row.tenant, "tenant", [row.idx], "Assigned Tenant Name");
            if (unitFieldAvailable) add(row.unitId || row.combinedUnit || row.shapeKey, "unit", [row.idx], "Unit");
            if (categoryFieldAvailable) add(row.category, "category", [row.idx], "Assigned Sales Category");
            if (groupFieldAvailable) add(row.group, "group", [row.idx], "Assigned Group");
            (row.floors || []).forEach((floor) => add(floor, "floor", [row.idx], "Floor"));
            Object.keys(row.filters || {}).forEach((field) => {
                if (metricLabels.has(normalizeSlotText(field))) return;
                const value = (row.filters || {})[field];
                const kind = entityKindForField(field) || "filterValue";
                add(value, kind, [row.idx], field);
            });
        });

        const docs: Array<SlotDoc<EntityItem>> = [];
        Array.from(values.values()).forEach((item) => {
            const aliases: string[] = [];
            if (item.kind === "floor") {
                const clean = normalizeSlotText(item.label);
                if (/ground/.test(clean)) aliases.push("ground");
                if (/\b1\b|first/.test(clean)) aliases.push("first", "1st");
                if (/\b2\b|second/.test(clean)) aliases.push("second", "2nd");
                if (/\b3\b|third/.test(clean)) aliases.push("third", "3rd");
            }
            addDoc(docs, item.label, aliases, item);
        });
        return docs;
    }

    private extractAxes(normalized: string, fieldMentions: Array<Mention<FieldItem>>): { rows: string[]; columns: string[] } {
        const rows = new Set<string>();
        const columns = new Set<string>();
        const rowFirst = normalized.match(/(.+?)\s+as\s+rows?\s+(?:and\s+)?(.+?)\s+as\s+(?:columns?|cols?)/i);
        const columnFirst = normalized.match(/(.+?)\s+as\s+(?:columns?|cols?)\s+(?:and\s+)?(.+?)\s+as\s+rows?/i);
        if (rowFirst?.[1] && rowFirst?.[2]) {
            this.fieldsInSegment(rowFirst[1], fieldMentions).forEach((field) => rows.add(field));
            this.fieldsInSegment(rowFirst[2], fieldMentions).forEach((field) => columns.add(field));
        } else if (columnFirst?.[1] && columnFirst?.[2]) {
            this.fieldsInSegment(columnFirst[2], fieldMentions).forEach((field) => rows.add(field));
            this.fieldsInSegment(columnFirst[1], fieldMentions).forEach((field) => columns.add(field));
        } else {
            fieldMentions.forEach((mention) => {
                const after = normalized.slice(mention.end, mention.end + 28);
                if (/^\s+as\s+rows?\b/i.test(after)) rows.add(canonicalFieldName(mention.item));
                if (/^\s+as\s+(?:columns?|cols?)\b/i.test(after)) columns.add(canonicalFieldName(mention.item));
            });
        }
        return { rows: Array.from(rows), columns: Array.from(columns) };
    }

    private fieldsInSegment(segment: string, mentions: Array<Mention<FieldItem>>): string[] {
        const clean = normalizeSlotText(segment);
        return uniqueText(mentions
            .filter((mention) => containsNormalized(clean, mention.normalized) >= 0)
            .map((mention) => canonicalFieldName(mention.item)));
    }

    private extractFilters(entityMentions: Array<Mention<EntityItem>>): ExtractedFilterSlot[] {
        return entityMentions.map((mention) => {
            const kind = mention.item.kind === "filterValue" ? entityKindForField(mention.item.field) : mention.item.kind;
            return {
                field: mention.item.field,
                value: mention.item.label,
                kind,
                indices: mention.item.indices
            };
        });
    }

    private extractRank(normalized: string, fields: string[], fieldMentions: Array<Mention<FieldItem>>): ExtractedQuestion["rank"] | undefined {
        const top = /\b(top|highest|largest|biggest|maximum|max|best|most|leading)\b/i.test(normalized);
        const bottom = /\b(bottom|lowest|smallest|minimum|min|least|worst|weakest|poorest)\b/i.test(normalized);
        if (!top && !bottom) return undefined;
        const limit = Number(normalized.match(/\b(?:top|bottom)\s+(\d{1,3})\b/i)?.[1] || NaN);
        return {
            direction: bottom ? "bottom" : "top",
            limit: Number.isFinite(limit) ? Math.max(1, Math.min(100, limit)) : 5,
            dimensionField: this.rankFieldFromMentions(normalized, fieldMentions) || fields[0] || this.rankFieldFromWords(normalized)
        };
    }

    private rankFieldFromMentions(normalized: string, fieldMentions: Array<Mention<FieldItem>>): string | undefined {
        if (!fieldMentions.length) return undefined;
        const connectorIndex = ` ${normalized} `.search(/\s(?:by|with|using|for|in|under|within|inside)\s/);
        const candidates = fieldMentions
            .filter((mention) => connectorIndex < 0 || mention.start <= connectorIndex)
            .filter((mention) => fieldKind(mention.item.name) !== "filter")
            .sort((a, b) => a.start - b.start || b.normalized.length - a.normalized.length);
        return candidates.length ? canonicalFieldName(candidates[0].item) : undefined;
    }

    private rankFieldFromWords(normalized: string): string | undefined {
        if (/\btenant|tenants|brand|brands|shop|shops|store|stores\b/i.test(normalized)) return "Assigned Tenant Name";
        if (/\bunit|units|space|spaces\b/i.test(normalized)) return "Unit";
        if (/\bcategory|categories|sales category|sales categories\b/i.test(normalized)) return "Assigned Sales Category";
        if (/\bgroup|groups|department|departments\b/i.test(normalized)) return "Assigned Group";
        if (/\bzone|zones|region|regions\b/i.test(normalized)) return "Zone";
        if (/\bfloor|floors|level|levels\b/i.test(normalized)) return "Floor";
        return undefined;
    }

    private extractChartType(normalized: string): ExtractedQuestion["chartType"] {
        if (/\bbar\s+(?:chart|graph)?\b|\bin\s+bar\b/i.test(normalized)) return "bar";
        if (/\bcolumn\s+(?:chart|graph)?\b/i.test(normalized)) return "column";
        if (/\bline\s+(?:chart|graph)?\b/i.test(normalized)) return "line";
        if (/\bpie\s+(?:chart|graph)?\b/i.test(normalized)) return "pie";
        if (/\bdonut\s+(?:chart|graph)?\b|\bdoughnut\s+(?:chart|graph)?\b/i.test(normalized)) return "donut";
        if (/\barea\s+(?:chart|graph)\b/i.test(normalized)) return "area";
        if (/\bmatrix|pivot|cross\s*tab|crosstab\b/i.test(normalized)) return "matrix";
        if (/\btable|tabular\b/i.test(normalized)) return "table";
        return undefined;
    }

    private extractCountTarget(normalized: string, fields: string[]): string | undefined {
        if (!/\bhow\s+many|count|number\s+of|total\s+number\b/i.test(normalized)) return undefined;
        if (fields.length) return fields[0];
        return this.rankFieldFromWords(normalized);
    }

    private extractPercentileTarget(normalized: string, fields: string[]): string | undefined {
        if (!/\bbenchmark|benchmarks|percentile|percentiles|statistics|statistic|statics|tenant concentration|concentration\b/i.test(normalized)) return undefined;
        if (fields.length) return fields[0];
        return this.rankFieldFromWords(normalized) || "Assigned Tenant Name";
    }

    private inferIntent(
        normalized: string,
        measures: string[],
        fields: string[],
        filters: ExtractedFilterSlot[],
        rank: ExtractedQuestion["rank"],
        chartType: ExtractedQuestion["chartType"],
        countTarget?: string,
        percentileTarget?: string
    ): ExtractedIntent {
        if (countTarget) return "count";
        if (percentileTarget) return "percentile";
        if (rank) return "rank";
        if (/\bcompare|vs|versus|against\b/i.test(normalized)) return "compare";
        if (/\blist\b/i.test(normalized) && (fields.length || filters.length)) return "list";
        if (/\b(?:which|what|show|display)\b/i.test(normalized)
            && /\b(?:assigned\s+tenant\s+name|assigned\s+tenant|tenant\s+names?|tenants?|brands?|shops?|stores?|units?|unit\s+names?|unit\s+ids?)\b/i.test(normalized)
            && (filters.length || /\b(?:in|inside|within|under|for)\b/i.test(normalized))) return "list";
        if (chartType && chartType !== "matrix" && chartType !== "table" && (measures.length || fields.length || filters.length)) return "chart";
        if (measures.length && fields.length) return "matrix";
        if (fields.length && /\b(matrix|pivot|cross\s*tab|crosstab|table|rows?|columns?|cols?|by|with|across)\b/i.test(normalized)) return "matrix";
        if (measures.length && filters.length) return "lookup";
        return "unknown";
    }

    private inferAxes(normalized: string, fields: string[], explicit: { rows: string[]; columns: string[] }): { rows: string[]; columns: string[] } {
        if (explicit.rows.length || explicit.columns.length) {
            const fallbackRows = explicit.rows.length ? explicit.rows : fields.filter((field) => explicit.columns.indexOf(field) < 0).slice(0, 1);
            return { rows: fallbackRows.slice(0, 5), columns: explicit.columns.slice(0, 4) };
        }
        if (!fields.length) return { rows: [], columns: [] };
        return { rows: fields.slice(0, 5), columns: [] };
    }

    private confidence(
        intent: ExtractedIntent,
        measures: string[],
        fields: string[],
        filters: ExtractedFilterSlot[],
        axes: { rows: string[]; columns: string[] },
        rank: ExtractedQuestion["rank"],
        chartType: ExtractedQuestion["chartType"],
        countTarget?: string,
        percentileTarget?: string
    ): number {
        if (intent === "unknown") return 0.2;
        if (countTarget) return 0.92;
        if (percentileTarget) return 0.9;
        if (intent === "chart" && chartType) return measures.length || fields.length ? 0.92 : 0.84;
        if (rank && (measures.length || fields.length)) return 0.9;
        if (measures.length && (fields.length || filters.length)) return axes.rows.length || axes.columns.length ? 0.94 : 0.88;
        if (intent === "matrix" && fields.length) return axes.rows.length || axes.columns.length ? 0.88 : 0.84;
        if (filters.length && fields.length) return 0.84;
        return 0.7;
    }
}

function uniqueNums(values: number[]): number[] {
    return Array.from(new Set((values || []).map(Number).filter((value) => Number.isFinite(value) && value >= 0)));
}
