import {
    AssistantAnswerContext,
    AssistantEntity,
    AssistantMetric,
    AssistantRow
} from "./assistantTypes";
import {
    AssistantPlannerRegressionCase,
    AssistantPlannerRegressionExpectation,
    assistantPlannerRegressionCases
} from "./assistantRegressionCases";
import { ExtractedQuestion, QuestionSlotExtractor } from "./assistantQuestionSlotExtractor";
import { defaultMatrixConfig, MatrixQueryPlanner } from "./assistantMatrixQueryPlanner";
import { ChartQueryPlanner, CountQueryPlanner, ListQueryPlanner } from "./assistantQueryPlanners";

export interface AssistantPlannerRegressionActual {
    intent: string;
    confidence: number;
    measures: string[];
    rows: string[];
    columns: string[];
    fields: string[];
    filters: string[];
    chartType?: string;
    rankDirection?: "top" | "bottom";
    reasons: string[];
}

export interface AssistantPlannerRegressionMismatch {
    property: keyof AssistantPlannerRegressionExpectation;
    expected: string[];
    actual: string[];
}

export interface AssistantPlannerRegressionResult {
    question: string;
    passed: boolean;
    actual: AssistantPlannerRegressionActual;
    expected: AssistantPlannerRegressionExpectation;
    mismatches: AssistantPlannerRegressionMismatch[];
}

export interface AssistantPlannerRegressionSummary {
    passed: boolean;
    total: number;
    passedCount: number;
    failedCount: number;
    results: AssistantPlannerRegressionResult[];
}

export interface AssistantPlannerRegressionOptions {
    context?: AssistantAnswerContext;
    cases?: AssistantPlannerRegressionCase[];
    throwOnFailure?: boolean;
}

type FieldName = "Assigned Tenant Name" | "Unit" | "Assigned Sales Category" | "Assigned Group" | "Zone" | "Floor";

function clean(value: unknown): string {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function normalize(value: unknown): string {
    return clean(value)
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9/%]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
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

function stripFilterPrefix(value: string): string {
    return clean(value).replace(/^(?:include|exclude)\s+/i, "");
}

function matchesExpected(expected: string[] | undefined, actual: string[]): boolean {
    if (!expected || !expected.length) return true;
    const actualKeys = actual.map(normalize);
    return expected.every((item, index) => actualKeys[index] === normalize(item));
}

function mismatch(
    property: keyof AssistantPlannerRegressionExpectation,
    expected: string[] | undefined,
    actual: string[]
): AssistantPlannerRegressionMismatch | null {
    if (!expected || !expected.length || matchesExpected(expected, actual)) return null;
    return { property, expected, actual };
}

function valueMismatch(
    property: keyof AssistantPlannerRegressionExpectation,
    expected: string | undefined,
    actual: string | undefined
): AssistantPlannerRegressionMismatch | null {
    if (!expected || normalize(expected) === normalize(actual || "")) return null;
    return { property, expected: [expected], actual: actual ? [actual] : [] };
}

function metric(name: string, aliases: string[] = [], formatHint: AssistantMetric["formatHint"] = "number"): AssistantMetric {
    return {
        key: `metric::${normalize(name)}`,
        name,
        kind: "dynamic",
        aliases,
        role: "heatmap",
        formatHint,
        aggregationHint: /expiry|date/i.test(name) ? "min" : "sum"
    };
}

function makeRow(
    idx: number,
    tenant: string,
    unit: string,
    category: string,
    group: string,
    zone: string,
    floor: string,
    area: number
): AssistantRow {
    return {
        idx,
        shapeKey: unit,
        tenant,
        unitId: unit,
        combinedUnit: unit,
        category,
        group,
        area,
        visibleOnMap: true,
        floors: [floor],
        filters: {
            "Assigned Tenant Name": tenant,
            "Unit": unit,
            "Assigned Sales Category": category,
            "Assigned Group": group,
            "Zone": zone,
            "Floor": floor
        }
    };
}

function entityFromRows(rows: AssistantRow[], field: FieldName, kind: AssistantEntity["kind"]): AssistantEntity[] {
    const byValue = new Map<string, number[]>();
    rows.forEach((row) => {
        const value = field === "Assigned Tenant Name"
            ? row.tenant
            : field === "Unit"
                ? row.unitId
                : field === "Assigned Sales Category"
                    ? row.category
                    : field === "Assigned Group"
                        ? row.group
                        : field === "Zone"
                            ? row.filters.Zone
                            : row.floors[0];
        const label = clean(value);
        if (!label) return;
        const key = normalize(label);
        byValue.set(key, (byValue.get(key) || []).concat(row.idx));
    });
    return Array.from(byValue.keys()).map((key) => {
        const indices = byValue.get(key) || [];
        const row = rows[indices[0]];
        const label = field === "Assigned Tenant Name"
            ? row.tenant
            : field === "Unit"
                ? row.unitId
                : field === "Assigned Sales Category"
                    ? row.category
                    : field === "Assigned Group"
                        ? row.group
                        : field === "Zone"
                            ? row.filters.Zone
                            : row.floors[0];
        return {
            id: `${kind}:${key}`,
            kind,
            label,
            aliases: [],
            indices,
            meta: { field }
        };
    });
}

export function createAssistantPlannerRegressionContext(): AssistantAnswerContext {
    const rows = [
        makeRow(0, "Zara", "GC231", "Fashion - Unisex", "Al Fardan", "Zone 3", "Ground", 2680),
        makeRow(1, "Zara Home", "GC238", "Furniture/Home Accessories", "Azadea", "Zone 3", "Ground", 836),
        makeRow(2, "Mango", "FC327", "Fashion - Unisex", "Beside Group", "Zone 1", "1st", 420),
        makeRow(3, "Urban Mart", "B0002122", "Food and Beverage", "Al Futtaim Retail", "Zone 3", "Ground", 1250),
        makeRow(4, "NovaMart", "B0002079", "Department Store", "Al Futtaim Retail", "Zone 2", "Ground", 42705),
        makeRow(5, "IKEA", "FC483", "Department Store", "Al Futtaim Retail", "Zone 1", "1st", 24974),
        makeRow(6, "Pizza Hut", "FC501", "Dining - Restaurants", "Qatar Food Company", "Zone 5", "2nd", 650),
        makeRow(7, "Adidas Originals", "FC502", "Fashion - Footwear/Handbags", "Al Mana", "Zone 3", "Ground", 552),
        makeRow(8, "Nike", "FC503", "Sportswear/Sports Goods", "Apparel", "Zone 4", "Ground", 312)
    ];
    const metrics = [
        metric("Sum of Area", ["sum area", "total area", "area total"]),
        metric("Area", ["sqm", "gla"]),
        metric("Units", ["unit count", "number of units"]),
        metric("Sales/Sqm", ["sales sqm", "sales per sqm", "sales psqm"]),
        metric("Rent/Sqm", ["rent sqm", "rent per sqm"]),
        metric("OCR", ["assigned ocr"]),
        metric("Occupancy"),
        metric("Vacant units"),
        metric("Occupied units"),
        metric("Earliest Lease Expiry2", ["lease expiry", "earliest lease expiry"], "date")
    ];
    const entities = ([] as AssistantEntity[])
        .concat(entityFromRows(rows, "Assigned Tenant Name", "tenant"))
        .concat(entityFromRows(rows, "Unit", "unit"))
        .concat(entityFromRows(rows, "Assigned Sales Category", "category"))
        .concat(entityFromRows(rows, "Assigned Group", "group"))
        .concat(entityFromRows(rows, "Zone", "zone"))
        .concat(entityFromRows(rows, "Floor", "floor"));
    return {
        rows,
        metrics,
        entities,
        fieldNames: ["Assigned Tenant Name", "Unit", "Assigned Sales Category", "Assigned Group", "Zone", "Floor"],
        heatmapSelectedKeys: ["metric::sum of area"],
        matrixConfig: defaultMatrixConfig(),
        getMetricValue(metricKey: string, indices: number[]): number {
            const selectedRows = rows.filter((row) => indices.indexOf(row.idx) >= 0);
            if (/sum of area|area/.test(metricKey)) {
                return selectedRows.reduce((sum, row) => sum + (row.area || 0), 0);
            }
            if (/units/.test(metricKey)) return selectedRows.length;
            return selectedRows.length ? selectedRows.length * 100 : 0;
        },
        formatMetricValue(_metricKey: string, value: number): string {
            return String(value);
        },
        formatNumber(value: number): string {
            return String(value);
        }
    };
}

function plannedFields(extracted: ExtractedQuestion): string[] {
    if (extracted.rank?.dimensionField) return [extracted.rank.dimensionField];
    return extracted.fields || [];
}

function summarizePlannerOutput(ctx: AssistantAnswerContext, question: string): AssistantPlannerRegressionActual {
    const extractor = new QuestionSlotExtractor(ctx);
    const matrixPlanner = new MatrixQueryPlanner(ctx);
    const chartPlanner = new ChartQueryPlanner(ctx);
    const listPlanner = new ListQueryPlanner();
    const countPlanner = new CountQueryPlanner();
    const extracted = extractor.extract(question);
    const matrix = extracted.intent === "matrix" || extracted.chartType === "matrix"
        ? matrixPlanner.plan(extracted)
        : null;
    const chart = extracted.intent === "chart" || (extracted.chartType && extracted.chartType !== "matrix")
        ? chartPlanner.plan(extracted)
        : null;
    const list = extracted.intent === "list" ? listPlanner.plan(extracted) : null;
    const count = extracted.intent === "count" ? countPlanner.plan(extracted) : null;

    return {
        intent: extracted.intent,
        confidence: extracted.confidence,
        measures: unique((matrix?.values || chart?.values || extracted.measures || []).map(clean)),
        rows: unique(matrix?.rows || extracted.axes.rows || []),
        columns: unique(matrix?.columns || extracted.axes.columns || []),
        fields: unique((list ? [list.target] : count ? [count.target] : plannedFields(extracted)).map(clean)),
        filters: unique((matrix?.filterTexts || chart?.filters || list?.filters || count?.filters || extracted.filters.map((filter) => filter.value)).map(stripFilterPrefix)),
        chartType: chart?.chartType || extracted.chartType,
        rankDirection: extracted.rank?.direction,
        reasons: extracted.reasons || []
    };
}

function evaluateCase(ctx: AssistantAnswerContext, testCase: AssistantPlannerRegressionCase): AssistantPlannerRegressionResult {
    const actual = summarizePlannerOutput(ctx, testCase.question);
    const expected = testCase.expected;
    const mismatches = [
        valueMismatch("intent", expected.intent, actual.intent),
        mismatch("measures", expected.measures, actual.measures),
        mismatch("rows", expected.rows, actual.rows),
        mismatch("columns", expected.columns, actual.columns),
        mismatch("fields", expected.fields, actual.fields),
        mismatch("filters", expected.filters, actual.filters),
        valueMismatch("chartType", expected.chartType, actual.chartType),
        valueMismatch("rankDirection", expected.rankDirection, actual.rankDirection)
    ].filter((item): item is AssistantPlannerRegressionMismatch => !!item);
    return {
        question: testCase.question,
        passed: mismatches.length === 0,
        actual,
        expected,
        mismatches
    };
}

export function runAssistantPlannerRegression(options: AssistantPlannerRegressionOptions = {}): AssistantPlannerRegressionSummary {
    const ctx = options.context || createAssistantPlannerRegressionContext();
    const cases = options.cases || assistantPlannerRegressionCases;
    const results = cases.map((testCase) => evaluateCase(ctx, testCase));
    const failed = results.filter((result) => !result.passed);
    const summary = {
        passed: failed.length === 0,
        total: results.length,
        passedCount: results.length - failed.length,
        failedCount: failed.length,
        results
    };
    if (options.throwOnFailure && failed.length) {
        const lines = failed.slice(0, 10).map((result) => {
            const details = result.mismatches
                .map((item) => `${String(item.property)} expected [${item.expected.join(", ")}] actual [${item.actual.join(", ")}]`)
                .join("; ");
            return `${result.question}: ${details}`;
        });
        throw new Error(`Assistant planner regression failed ${failed.length}/${results.length} cases.\n${lines.join("\n")}`);
    }
    return summary;
}
