export type QnaChartType = "bar" | "column" | "line" | "area" | "pie" | "donut" | "stackedBar" | "stackedColumn" | "combo" | "waterfall" | "scatter" | "treemap" | "funnel" | "gauge" | "bullet" | "heatmap" | "smallMultiples" | "kpiTrend" | "sparkline";
export type QnaAggregation = "sum" | "average" | "min" | "max" | "count" | "distinctCount";

export interface QnaField {
    key: string;
    name: string;
    values: string[];
    uniqueValues: Array<{ label: string; indices: number[] }>;
}

export interface QnaMeasure {
    key: string;
    name: string;
    values: Array<number | null>;
    formatHint: "number" | "percentage" | "date";
    formatString?: string;
    modelTotal?: number;
}

export interface QnaContext {
    rowCount: number;
    fields: QnaField[];
    measures: QnaMeasure[];
    selectedIndices: number[];
    formatValue(measure: QnaMeasure, value: number): string;
}

export interface QnaTable {
    columns: string[];
    rows: string[][];
    rowIndices: number[][];
    cellIndices?: number[][][];
    selectionFieldsByColumn?: string[][];
    matrix?: { levels: number[]; keys: string[]; parentKeys: Array<string | undefined>; hasChildren: boolean[]; rowHeader: string };
}

export interface QnaLayoutSettings {
    conversationMode: "history" | "latest";
    cardinalityFallbackEnabled: boolean;
    cardinalityMatrixThresholdPct: number;
    cardinalityMaxColumnValues: number;
    cardinalityLowToHighHierarchy: boolean;
    autocompleteFields?: string[];
    autocompleteMeasures?: string[];
    synonyms?: Record<string, string[]>;
    synonymEnabled?: Record<string, boolean>;
}

export interface QnaChart {
    type: QnaChartType;
    title: string;
    labels: string[];
    values: number[];
    valueLabels: string[];
    totalLabel?: string;
    valueFormat?: string;
    formatHint?: QnaMeasure["formatHint"];
    rowIndices: number[][];
    series?: Array<{ name: string; values: number[]; valueLabels: string[] }>;
    axisTitle?: string;
}

export interface QnaResponse {
    text: string;
    kpi?: { title: string; value: string; subtitle?: string };
    table?: QnaTable;
    chart?: QnaChart;
    suggestions?: string[];
}

export interface QnaAutocompleteItem {
    label: string;
    detail: string;
}
