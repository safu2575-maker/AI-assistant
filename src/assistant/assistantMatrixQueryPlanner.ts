import { AssistantAnswerContext, AssistantMatrixConfig, AssistantMetric } from "./assistantTypes";
import { MatrixQuery, normalizeMatrixQuery } from "./matrixQueryBuilder";
import { ExtractedQuestion } from "./assistantQuestionSlotExtractor";
import { isDimensionMetric } from "./assistantMetricResolver";

export interface PlannedMatrixQuery {
    query: MatrixQuery;
    rows: string[];
    columns: string[];
    values: string[];
    filterTexts: string[];
    defaultValue: boolean;
    totalsMode?: "show" | "hide";
}

export function defaultMatrixConfig(): AssistantMatrixConfig {
    return {
        fallbackRows: ["Assigned Group"],
        fallbackColumns: [],
        fallbackValues: ["Sum of Area"],
        allowedRows: ["Assigned Group", "Assigned Sales Category", "Assigned Tenant Name", "Unit", "Zone", "Floor", "Layer"],
        allowedColumns: ["Assigned Sales Category", "Assigned Group", "Zone", "Floor", "Layer"],
        allowedValues: ["Sum of Area", "Area", "Units", "Sales/Sqm", "Rent/Sqm", "OCR", "Occupancy", "Vacant units", "Occupied units"],
        valueByIntent: {
            area: "Sum of Area",
            sqm: "Sum of Area",
            sales: "Sales/Sqm",
            rent: "Rent/Sqm",
            ocr: "OCR",
            occupancy: "Occupancy",
            units: "Units"
        },
        allowAutoColumns: true,
        allowMultipleValues: true,
        hideZerosByDefault: false,
        showGrandTotalByDefault: true,
        cardinalityMatrixThresholdPct: 25,
        cardinalityMaxColumnValues: 5,
        cardinalityLowToHighHierarchy: true,
        cardinalityFallbackEnabled: true
    };
}

function normalizePlannerText(value: string): string {
    return ` ${String(value || "")
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()} `;
}

function sameSlotText(a: string, b: string): boolean {
    return normalizePlannerText(a) === normalizePlannerText(b);
}

function isDimensionLikeMetric(metric: AssistantMetric): boolean {
    return isDimensionMetric(metric);
}

export class MatrixQueryPlanner {
    constructor(private readonly ctx: AssistantAnswerContext) {}

    plan(extracted: ExtractedQuestion): PlannedMatrixQuery | null {
        const config = this.ctx.matrixConfig || defaultMatrixConfig();
        const explicitRows = extracted.axesExplicit?.rows ? (extracted.axes.rows || []) : [];
        const explicitColumns = extracted.axesExplicit?.columns ? (extracted.axes.columns || []) : [];
        const extractedFields = extracted.fields || [];
        const cardinalityLayout = !explicitRows.length && !explicitColumns.length
            ? this.applyCardinalityLayout(extractedFields)
            : null;
        if (!explicitRows.length && !explicitColumns.length && extractedFields.length >= 2 && !cardinalityLayout) {
            return null;
        }
        const initialRows = explicitRows.length
            ? explicitRows
            : cardinalityLayout?.rows?.length
            ? cardinalityLayout.rows
            : extractedFields.filter((field) => explicitColumns.indexOf(field) < 0).slice(0, 1);
        const initialColumnsRaw = explicitColumns.length
            ? explicitColumns
            : cardinalityLayout?.columns?.length
            ? cardinalityLayout.columns
            : (config.allowAutoColumns === false ? [] : extractedFields.filter((field) => initialRows.indexOf(field) < 0));
        const autoColumns = explicitColumns.length
            ? initialColumnsRaw
            : initialColumnsRaw.filter((field) => this.shouldUseFieldAsAutoColumn(field));
        const rejectedAutoColumns = explicitColumns.length
            ? []
            : initialColumnsRaw.filter((field) => !autoColumns.some((column) => sameSlotText(column, field)));
        const rowCandidates = initialRows
            .concat(rejectedAutoColumns)
            .concat(autoColumns.filter((field) =>
                !this.fieldRoleAllowed(field, "column") && this.fieldRoleAllowed(field, "row")
            ));

        let rows = (rowCandidates.length ? rowCandidates : (config.fallbackRows || []))
            .filter((field) => this.fieldAllowed(field, config.allowedRows))
            .filter((field) => this.fieldRoleAllowed(field, "row"))
            .map((field) => this.canonicalAllowedField(field, config.allowedRows));
        let columns = (autoColumns.length ? autoColumns : (explicitColumns.length ? initialColumnsRaw : []))
            .filter((field) => this.fieldAllowed(field, config.allowedColumns))
            .filter((field) => this.fieldRoleAllowed(field, "column"))
            .map((field) => this.canonicalAllowedField(field, config.allowedColumns));

        const valuesFromUser = extracted.measures || [];
        let values = (valuesFromUser.length ? valuesFromUser : [this.configuredFallbackValue(extracted)])
            .filter((value) => !isDimensionLikeMetric({ key: value, name: value, kind: "dynamic", aliases: [] }))
            .filter((value) => this.fieldAllowed(value, config.allowedValues) || this.metricExists(value));

        if (!config.allowMultipleValues) values = values.slice(0, 1);
        values = values.length ? values : [this.configuredFallbackValue(extracted)];
        rows = rows.slice(0, 5);
        columns = columns.filter((column) => !rows.some((row) => sameSlotText(row, column))).slice(0, 4);
        values = Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean))).slice(0, 6);
        if (!rows.length && !columns.length) return null;

        const filterTexts = extracted.filters.map((filter) => `include ${filter.value}`);
        const query = normalizeMatrixQuery({
            rows,
            columns,
            values,
            filters: filterTexts,
            hideZeros: !!config.hideZerosByDefault
        });
        return {
            query,
            rows: query.rows,
            columns: query.columns,
            values: query.values,
            filterTexts: query.filters.map((filter) => filter.type === "include" ? `include ${filter.phrase}` : filter.type === "exclude" ? `exclude ${filter.phrase}` : filter.phrase),
            defaultValue: !valuesFromUser.length,
            totalsMode: config.showGrandTotalByDefault === false ? "hide" : "show"
        };
    }

    private fieldAllowed(field: string, allowed?: string[]): boolean {
        if (!allowed?.length) return true;
        return allowed.some((item) => sameSlotText(item, field));
    }

    private canonicalAllowedField(field: string, allowed?: string[]): string {
        const match = (allowed || []).find((item) => sameSlotText(item, field));
        return match || field;
    }

    private fieldRoleAllowed(field: string, role: "row" | "column" | "filter" | "mention"): boolean {
        const configured = (this.ctx.dataDictionary?.fields || []).filter((item) => item.enabled !== false);
        if (!configured.length) return true;
        const match = configured.find((item) =>
            [item.actualName, item.displayName].concat(item.synonyms || [])
                .filter(Boolean)
                .some((label) => sameSlotText(String(label), field))
        );
        if (!match) return false;
        return (match.roles || []).indexOf(role) >= 0;
    }

    private metricExists(label: string): boolean {
        const clean = normalizePlannerText(label);
        return (this.ctx.metrics || []).some((metric) => {
            if (isDimensionLikeMetric(metric)) return false;
            return [metric.name].concat(metric.aliases || []).some((candidate) => normalizePlannerText(candidate) === clean);
        });
    }

    private configuredFallbackValue(extracted: ExtractedQuestion): string {
        const config = this.ctx.matrixConfig || defaultMatrixConfig();
        const intentText = `${extracted.measures.join(" ")} ${extracted.fields.join(" ")} ${extracted.filters.map((filter) => filter.value).join(" ")}`.toLowerCase();
        const mapped = Object.keys(config.valueByIntent || {}).find((key) => intentText.indexOf(key.toLowerCase()) >= 0);
        const preferred = mapped ? config.valueByIntent![mapped] : undefined;
        const candidates = [preferred].concat(config.fallbackValues || []).filter(Boolean) as string[];
        return candidates.find((candidate) => this.metricExists(candidate)) || candidates[0] || "Area";
    }

    private applyCardinalityLayout(fields: string[]): { rows: string[]; columns: string[] } | null {
        const config = this.ctx.matrixConfig || defaultMatrixConfig();
        if (config.cardinalityFallbackEnabled === false) return null;
        const requested = fields
            .map((field) => String(field || "").trim())
            .filter(Boolean)
            .filter((field, index, arr) => arr.findIndex((candidate) => sameSlotText(candidate, field)) === index);
        if (requested.length < 2) return null;
        const stats = requested
            .map((field) => ({ field, cardinality: this.fieldCardinality(field) }))
            .filter((item) => item.cardinality > 0);
        if (stats.length < 2) return null;
        const highest = Math.max(...stats.map((item) => item.cardinality));
        const thresholdPct = Math.max(1, Math.min(100, Number(config.cardinalityMatrixThresholdPct ?? 25)));
        const matrixThreshold = highest * (thresholdPct / 100);
        const lowCardinalityFields = stats.filter((item) => item.cardinality < highest && item.cardinality <= matrixThreshold);
        const shouldUseCardinalityLayout = lowCardinalityFields.length > 0;
        if (!shouldUseCardinalityLayout) return null;

        const maxColumnValues = Math.max(0, Math.min(1000, Number(config.cardinalityMaxColumnValues ?? 5)));
        const columnCandidate = maxColumnValues > 0
            ? stats
                .filter((item) => item.cardinality <= maxColumnValues && this.fieldRoleAllowed(item.field, "column"))
                .sort((a, b) => a.cardinality - b.cardinality || a.field.localeCompare(b.field, undefined, { sensitivity: "base" }))[0]
            : undefined;
        const columnFields = columnCandidate ? [columnCandidate.field] : [];
        const remaining = stats.filter((item) => !columnFields.some((field) => sameSlotText(field, item.field)));
        const orderedRows = config.cardinalityLowToHighHierarchy === false
            ? remaining.map((item) => item.field)
            : remaining
                .slice()
                .sort((a, b) => a.cardinality - b.cardinality || a.field.localeCompare(b.field, undefined, { sensitivity: "base" }))
                .map((item) => item.field);
        return {
            rows: orderedRows,
            columns: columnFields
        };
    }

    private shouldUseFieldAsAutoColumn(field: string): boolean {
        const config = this.ctx.matrixConfig || defaultMatrixConfig();
        if (config.allowAutoColumns === false) return false;
        if (!this.fieldRoleAllowed(field, "column")) return false;
        const maxColumnValues = Math.max(0, Math.min(1000, Number(config.cardinalityMaxColumnValues ?? 5)));
        if (maxColumnValues <= 0) return false;
        const cardinality = this.fieldCardinality(field);
        return cardinality > 0 && cardinality <= maxColumnValues;
    }

    private fieldCardinality(field: string): number {
        const values = new Set<string>();
        (this.ctx.rows || []).forEach((row) => {
            this.valuesForField(row, field).forEach((value) => {
                const clean = normalizePlannerText(value).trim();
                if (clean && clean !== "n/a" && clean !== "na" && clean !== "none" && clean !== "null" && clean !== "undefined" && clean !== "-") values.add(clean);
            });
        });
        return values.size;
    }

    private valuesForField(row: NonNullable<AssistantAnswerContext["rows"][number]>, field: string): string[] {
        const clean = normalizePlannerText(field);
        const filters = row.filters || {};
        const filterValuesForAliases = (aliases: string[]): string[] => {
            const normalizedAliases = aliases.map((alias) => normalizePlannerText(alias));
            return Object.keys(filters)
                .filter((key) => normalizedAliases.some((alias) => normalizePlannerText(key) === alias))
                .map((key) => String(filters[key] || "").trim())
                .filter(Boolean);
        };
        const fromFilters = Object.keys(filters)
            .filter((key) => normalizePlannerText(key) === clean)
            .map((key) => String(filters[key] || "").trim())
            .filter(Boolean);
        if (fromFilters.length) return fromFilters;
        if (/\btenant|brand|shop|store\b/.test(clean)) return [row.tenant || filterValuesForAliases(["Assigned Tenant Name", "Assigned Tenant", "Tenant Name", "Tenant"])[0] || ""];
        if (/\bunit|space\b/.test(clean)) return [row.unitId || row.combinedUnit || filterValuesForAliases(["Assigned Unit", "Unit", "Unit ID", "Unit Name"])[0] || ""];
        if (/\bcategory|sales category|segment|class|type\b/.test(clean)) return [row.category || filterValuesForAliases(["Assigned Sales Category", "Sales Category", "Category"])[0] || ""];
        if (/\bgroup|department\b/.test(clean)) return [row.group || filterValuesForAliases(["Assigned Group", "Group"])[0] || ""];
        if (/\bfloor|level\b/.test(clean)) return (row.floors || []).filter(Boolean);
        return [];
    }
}
