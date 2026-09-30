import { MatrixQuery, MatrixValueMode } from "./matrixQueryBuilder";

export type AssistantIntent = "lookup" | "compare" | "rank" | "list" | "summary" | "formula" | "help" | "trend" | "filter" | "explain" | "matrix" | "unknown";

export type AssistantEntityKind = "tenant" | "unit" | "category" | "group" | "zone" | "layer" | "floor" | "bookmark" | "filter" | "context";

export type AssistantMetricKind = "dynamic" | "builtin";

export interface AssistantRow {
    idx: number;
    shapeKey: string;
    tenant: string;
    unitId: string;
    combinedUnit: string;
    category: string;
    group: string;
    area: number | null;
    visibleOnMap?: boolean;
    floors: string[];
    filters: Record<string, string>;
}

export interface AssistantMetric {
    key: string;
    name: string;
    kind: AssistantMetricKind;
    aliases: string[];
    role?: string;
    formatHint?: "number" | "percentage" | "text" | "date";
    isCustomKpi?: boolean;
    isNonAdditive?: boolean;
    aggregationHint?: AssistantMeasureAggregation;
    formula?: string;
    description?: string;
    dependsOn?: string[];
    usedBy?: string[];
    decimalPlaces?: number | null;
    showInSuggestions?: boolean;
    higherIsBetter?: boolean;
}

export interface AssistantEntity {
    id: string;
    kind: AssistantEntityKind;
    label: string;
    aliases: string[];
    indices: number[];
    meta?: Record<string, string>;
}

export interface AssistantScope {
    label: string;
    indices: number[];
}

export interface AssistantMatrixConfig {
    fallbackRows?: string[];
    fallbackColumns?: string[];
    fallbackValues?: string[];
    allowedRows?: string[];
    allowedColumns?: string[];
    allowedValues?: string[];
    valueByIntent?: Record<string, string>;
    allowAutoColumns?: boolean;
    allowMultipleValues?: boolean;
    hideZerosByDefault?: boolean;
    showGrandTotalByDefault?: boolean;
    cardinalityMatrixThresholdPct?: number;
    cardinalityMaxColumnValues?: number;
    cardinalityLowToHighHierarchy?: boolean;
    cardinalityFallbackEnabled?: boolean;
}

export type AssistantMeasureAggregation =
    | "visual"
    | "sum"
    | "average"
    | "weightedAverage"
    | "min"
    | "max"
    | "earliestDate"
    | "latestDate"
    | "count"
    | "distinctCount"
    | "text";

export interface AssistantDataDictionaryMeasure {
    key: string;
    actualName: string;
    enabled: boolean;
    displayName?: string;
    synonyms?: string[];
    aggregation?: AssistantMeasureAggregation;
    weightBy?: string;
    showInSuggestions?: boolean;
}

export interface AssistantDataDictionaryField {
    key: string;
    actualName: string;
    enabled: boolean;
    displayName?: string;
    synonyms?: string[];
    roles?: Array<"row" | "column" | "filter" | "mention">;
    showValuesInMention?: boolean;
    maxColumnCardinality?: number;
}

export interface AssistantDataDictionaryConfig {
    measures?: AssistantDataDictionaryMeasure[];
    fields?: AssistantDataDictionaryField[];
}

export interface AssistantDiagnosticsConfig {
    enabled?: boolean;
    showPlannerExplanation?: boolean;
    superAdminOnly?: boolean;
    logs?: AssistantDiagnosticsLogEntry[];
}

export interface AssistantDiagnosticsLogEntry {
    timestamp: string;
    question: string;
    engineQuestion?: string;
    selectedTokens?: Array<{ type: SelectedAssistantTokenType; label: string; id?: string }>;
    intent?: string;
    measures?: string[];
    fields?: string[];
    rows?: string[];
    columns?: string[];
    filters?: string[];
    planner?: string;
    plannerReasons?: string[];
    notes?: string[];
    finalQuery?: unknown;
    answerType?: string;
    confidence?: number;
    performanceTimings?: Record<string, number>;
    measureAccessMode?: string;
    measureAccessGroups?: string[];
    measureAccessMeasureCount?: number;
    clarificationAsked?: boolean;
    resultCount?: number;
    result?: "answered" | "clarification" | "failed";
    error?: string;
}

export interface AssistantAnswerContext {
    rows: AssistantRow[];
    metrics: AssistantMetric[];
    entities: AssistantEntity[];
    bookmarkMeasureGroups?: Array<{
        id: string;
        name: string;
        metricKeys: string[];
        metricGroups?: Array<{ name: string; metricKeys: string[] }>;
    }>;
    activeFloorName?: string;
    selectedIndices?: number[];
    heatmapSelectedKeys?: string[];
    fieldNames?: string[];
    matrixConfig?: AssistantMatrixConfig;
    dataDictionary?: AssistantDataDictionaryConfig;
    measureAccess?: {
        mode: "all" | "bookmarkGroups";
        groups?: string[];
        measureCount?: number;
        message?: string;
    };
    getMetricValue(metricKey: string, indices: number[]): number;
    formatMetricValue(metricKey: string, value: number): string;
    formatNumber(value: number, options?: { maximumFractionDigits?: number }): string;
}

export interface ParsedAssistantQuestion {
    raw: string;
    normalized: string;
    tokens: string[];
    intent: AssistantIntent;
    detectedIntent?: ParsedAssistantIntentDetection;
    plannerSource?: "slot" | "legacy";
    requestedFields?: ParsedAssistantFieldSlots;
    fieldResolutions?: AssistantFieldResolution[];
    metricPhrases: string[];
    entityPhrases: string[];
    explicitMetricPhrase?: string;
    explicitEntityPhrases?: string[];
    compareEntityPhrases?: string[];
    explicitScopes?: ParsedAssistantScope[];
    breakdown?: ParsedAssistantBreakdown;
    filters?: {
        areaMin?: number;
        areaMax?: number;
        floorPhrase?: string;
        nearPhrase?: string;
        includeFilters?: ParsedAssistantFilter[];
        excludeFilters?: ParsedAssistantFilter[];
    };
    debug?: boolean;
    limit?: number;
    direction?: "top" | "bottom";
    chartType?: "bar" | "column" | "donut" | "line" | "area";
    averageComparison?: { operator: "above" | "below" | "compare" };
    metricThreshold?: { metricPhrase: string; operator: "above" | "below"; value: number };
    crossMetric?: {
        dimensionType: "tenant" | "unit" | "category" | "group" | "zone";
        firstMetricPhrase: string;
        firstDirection: "high" | "low";
        secondMetricPhrase: string;
        secondDirection: "high" | "low";
    };
    topBottom?: ParsedTopBottomQuery;
    matrix?: ParsedAssistantMatrix;
    offset?: number;
    hasExplicitSelections?: boolean;
    explicitSelectedEntityKeys?: string[];
    explicitSelectedEntityLabels?: string[];
}

export interface ParsedAssistantIntentDetection {
    intent: AssistantIntent;
    confidence: number;
    reasons: string[];
}

export interface ParsedAssistantFieldSlots {
    rows: string[];
    columns: string[];
    values: string[];
    metrics: string[];
    entities: string[];
    filters: string[];
}

export interface AssistantFieldResolution {
    role: "row" | "column" | "value" | "metric" | "entity" | "filter";
    phrase: string;
    status: "resolved" | "ambiguous" | "missing";
    confidence: number;
    matchedName?: string;
    matchedKind?: string;
    suggestions?: string[];
}

export interface ParsedAssistantFilter {
    phrase: string;
    type?: "tenant" | "unit" | "category" | "group" | "zone" | "floor" | "layer" | "bookmark" | "metricCondition";
    matchedEntityIds?: string[];
    matchedIndices?: number[];
    metricCondition?: {
        metricPhrase: string;
        operator: ">" | ">=" | "<" | "<=" | "=";
        value: number;
    };
}

export interface ParsedAssistantScope {
    kind?: "category" | "group" | "filter" | "zone" | "floor" | "layer" | "context";
    phrase: string;
}

export interface ParsedAssistantBreakdown {
    dimensions: Array<"tenant" | "unit" | "category" | "group" | "zone" | "floor" | "layer">;
}

export interface ParsedTopBottomQuery {
    direction: "top" | "bottom";
    limit: number;
    dimensionType: "tenant" | "unit" | "category" | "group" | "zone" | "floor" | "layer" | "bookmark" | "filter";
    dimensionField?: string;
    metricPhrase: string;
    perArea?: boolean;
    metricCondition?: {
        operator: ">" | ">=" | "<" | "<=" | "=";
        value: number;
        rawText: string;
    };
}

export interface ParsedAssistantMatrix {
    intent: "matrix";
    rows: string[];
    columns: string[];
    values: string[];
    filters: string[];
    query?: MatrixQuery;
    defaultValue?: boolean;
    autoAxes?: boolean;
    topN?: number;
    sortByTotal?: "asc" | "desc";
    hideZeros?: boolean;
    valueMode?: MatrixValueMode;
    totalsMode?: "show" | "hide" | "only";
    metricPhrase: string;
    metricPhrases?: string[];
    rowPhrases: string[];
    columnPhrases: string[];
}

export interface AssistantMatch<T> {
    item: T;
    score: number;
}

export interface AssistantAction {
    kind: "select";
    label: string;
    indices: number[];
}

export interface AssistantClarification {
    kind: "compare" | "entity";
    originalQuestion?: string;
    originalEngineQuestion?: string;
    resolvedEntityLabels?: string[];
    unresolvedEntityPhrase: string;
    remainingEntityPhrases: string[];
    choices: string[];
    choiceTokens?: SelectedAssistantToken[];
}

export type SelectedAssistantTokenType = "tenant" | "unit" | "metric" | "floor" | "category" | "group" | "zone" | "layer" | "filter" | "function" | "example";

export interface SelectedAssistantToken {
    type: SelectedAssistantTokenType;
    id: string;
    label: string;
    indices?: number[];
    metricKey?: string;
    bookmarkGroup?: string;
    fieldName?: string;
}

export interface AssistantAutocompleteItem {
    type: SelectedAssistantTokenType;
    id: string;
    label: string;
    detail?: string;
    subtitle?: string;
    indices?: number[];
    metricKey?: string;
    fieldName?: string;
}

export interface AssistantBenchmarkCandidate {
    label: string;
    indices: number[];
    value: number;
    valueLabel: string;
}

export interface AssistantBenchmarkContext {
    dimensionType: string;
    dimensionLabel: string;
    metricKey: string;
    metricLabel: string;
    metricFormatHint?: AssistantMetric["formatHint"];
    metricDecimalPlaces?: number | null;
    candidates: AssistantBenchmarkCandidate[];
    rankedLabels: string[];
    scopeText?: string;
}

export interface AssistantConfidence {
    intentConfidence: number;
    metricConfidence: number;
    entityConfidence: number;
    overallConfidence: number;
    intent?: AssistantIntent;
    matchedMetric?: string;
    matchedEntity?: string;
    fieldResolutions?: AssistantFieldResolution[];
    reasons?: string[];
}

export interface AssistantResponse {
    text: string;
    handled: boolean;
    debug?: string;
    confidence?: AssistantConfidence;
    performanceTimings?: Record<string, number>;
    suggestions?: string[];
    didYouMean?: string;
    clarification?: AssistantClarification;
    actions?: AssistantAction[];
    autoSelectIndices?: number[];
    benchmarkContext?: AssistantBenchmarkContext;
    table?: {
        columns: string[];
        rows: string[][];
        editableQuery?: {
            fields: string[];
            measures: string[];
            filters?: SelectedAssistantToken[];
            fieldOptions?: string[];
            measureOptions?: string[];
        };
    };
    tables?: Array<{
        title?: string;
        columns: string[];
        rows: string[][];
        editableQuery?: {
            fields: string[];
            measures: string[];
            filters?: SelectedAssistantToken[];
            fieldOptions?: string[];
            measureOptions?: string[];
        };
    }>;
    chart?: {
        type: "bar" | "column" | "donut" | "line" | "area";
        title: string;
        labels: string[];
        values: number[];
        valueLabels: string[];
        series?: Array<{
            name: string;
            labels: string[];
            values: number[];
            valueLabels: string[];
        }>;
    };
    kpi?: {
        title: string;
        value: string;
        rawValue: number;
        metricKey: string;
        metricName: string;
        scopeLabel?: string;
    };
    matrix?: {
        title: string;
        metricName: string;
        metricNames?: string[];
        rowHeader: string;
        columnHeaders: string[];
        query?: MatrixQuery;
        summary?: string[];
        interpretation?: {
            rows: string[];
            columns: string[];
            values: string[];
            filters: string[];
            needsConfirmation: boolean;
        };
        fieldOptions?: {
            rows: string[];
            columns: string[];
            values: string[];
        };
        columns?: Array<{
            key: string;
            label: string;
            level: number;
            hasChildren: boolean;
            parentKey?: string;
            isTotal?: boolean;
        }>;
        rows: Array<{
            key: string;
            label: string;
            level: number;
            hasChildren: boolean;
            parentKey?: string;
            isTotal?: boolean;
            values: string[];
            indices: number[];
        }>;
    };
}
