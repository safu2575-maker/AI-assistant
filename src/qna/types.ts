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

export type ModelSelection = Array<{ table: string; column?: string; hierarchy?: string; hierarchyLevel?: string; dateDay?: boolean; value: string | number | boolean }>;
export interface QnaTable {
    modelPeriods?: Array<{ sourceColumn: number; period: string; question: string; measure: string; groupCount: number }>;
    modelRowSelections?: ModelSelection[][];
    modelCellSelections?: ModelSelection[][][];
    modelSelections?: ModelSelection[];
    modelSnapshot?: boolean;
    modelEditor?: { rows: string[]; columns: string[]; measures: string[]; filters: Array<{ field: string; values: string[] }> };
    modelPivot?: { rowFields: string[]; columnField: string; columnFields?: string[]; columnValues: string[]; measures: string[] };
    modelTotals?: string[];
    modelRawRows?: Array<Array<number | null>>;
    modelRawTotals?: Array<number | null>;
    modelFormats?: Array<string | undefined>;
    backgroundFields?: string[];
    columns: string[];
    rows: string[][];
    rowIndices: number[][];
    cellIndices?: number[][][];
    selectionFieldsByColumn?: string[][];
    hiddenColumns?: number[];
    ytdColumns?: Array<{ sourceColumn: number; ytdColumn: number }>;
    ttmColumns?: Array<{ sourceColumn: number; ttmColumn: number }>;
    matrix?: { levels: number[]; keys: string[]; parentKeys: Array<string | undefined>; hasChildren: boolean[]; rowHeader: string; levelNames?: string[] };
}

export interface QnaLayoutSettings {
    conversationMode: "history" | "latest";
    cardinalityFallbackEnabled: boolean;
    cardinalityMatrixThresholdPct: number;
    cardinalityMaxColumnValues: number;
    cardinalityLowToHighHierarchy: boolean;
    autocompleteFields?: string[];
    autocompleteMeasures?: string[];
    defaultMeasure?: string;
    additiveMeasures?: string[];
    synonyms?: Record<string, string[]>;
    synonymEnabled?: Record<string, boolean>;
}

export interface QnaChart {
    groupNames?: string[];
    groupValues?: string[][];
    subtitle?: string;
    periodDetails?: string[];
    modelRowSelections?: ModelSelection[][];
    backgroundFields?: string[];
    type: QnaChartType;
    title: string;
    labels: string[];
    values: number[];
    valueLabels: string[];
    totalLabel?: string;
    valueFormat?: string;
    formatHint?: QnaMeasure["formatHint"];
    rowIndices: number[][];
    series?: Array<{ name: string; values: number[]; valueLabels: string[]; rowIndices?: number[][] }>;
    axisTitle?: string;
}

export interface QnaResponse {
    modelQuery?: boolean;
    text: string;
    kpi?: { title: string; value: string; subtitle?: string };
    table?: QnaTable;
    chart?: QnaChart;
    suggestions?: string[];
}

export interface QnaAutocompleteItem {
    label: string;
    detail: string;
    originalName?: string;
}
