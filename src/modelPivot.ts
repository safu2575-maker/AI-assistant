import { QnaTable } from "./qna/types";
import { compareTimeLabels } from "./qna/timeLayout";

/** Pivot already aggregated model cells. Never sum cells to manufacture totals. */
export function pivotModelTable(source: QnaTable, groupingCount: number, rowTotals?: Map<string, string[]>, rowCount = groupingCount - 1): QnaTable {
    if (groupingCount < 2 || rowCount >= groupingCount) return source;
    const pivotIndex = rowCount;
    const columnLabel = (row: string[]) => row.slice(pivotIndex, groupingCount).join(" · ");
    const measureNames = source.columns.slice(groupingCount);
    const columnValues = Array.from(new Set(source.rows.map(columnLabel))).sort(compareTimeLabels);
    const groups = new Map<string, { labels: string[]; cells: Map<string, string[]> }>();
    for (const row of source.rows) {
        const labels = row.slice(0, pivotIndex); const key = JSON.stringify(labels);
        let group = groups.get(key);
        if (!group) { group = { labels, cells: new Map() }; groups.set(key, group); }
        if (group.cells.has(columnLabel(row))) throw new Error("The model returned duplicate matrix cells. Add the missing grouping field before displaying this matrix.");
        group.cells.set(columnLabel(row), row.slice(groupingCount));
    }
    const hasTotals = !!rowTotals?.size;
    const rows = [...groups.values()].map(group => [...group.labels, ...columnValues.flatMap(value => group.cells.get(value) || measureNames.map(() => "—")), ...(hasTotals ? rowTotals!.get(JSON.stringify(group.labels)) || measureNames.map(() => "—") : [])]);
    const columns = [...source.columns.slice(0, pivotIndex), ...columnValues.flatMap(value => measureNames.map(name => measureNames.length === 1 ? value : `${value} ${name}`)), ...(hasTotals ? measureNames.map(name => measureNames.length === 1 ? "Total" : `${name} Total`) : [])];
    const modelSelections = [...groups.values()].map(group => { const index = source.rows.findIndex(row => JSON.stringify(row.slice(0, pivotIndex)) === JSON.stringify(group.labels)); return source.modelSelections?.[index]?.slice(0, pivotIndex) || []; });
    const modelRowSelections = [...groups.values()].map(group => source.rows.flatMap((row, index) => JSON.stringify(row.slice(0, pivotIndex)) === JSON.stringify(group.labels) ? source.modelRowSelections?.[index] || [] : []));
    const modelCellSelections = [...groups.values()].map((group, groupIndex) => [...group.labels.map(() => modelRowSelections[groupIndex]), ...columnValues.flatMap(value => measureNames.map(() => source.rows.flatMap((row, index) => JSON.stringify(row.slice(0, pivotIndex)) === JSON.stringify(group.labels) && columnLabel(row) === value ? source.modelRowSelections?.[index] || [] : []))), ...(hasTotals ? measureNames.map(() => modelRowSelections[groupIndex]) : [])]);
    return { columns, rows, modelSelections, modelRowSelections, modelCellSelections, rowIndices: rows.map(() => []), modelPivot: { rowFields: source.columns.slice(0, pivotIndex), columnField: source.columns[pivotIndex], columnFields: source.columns.slice(pivotIndex, groupingCount), columnValues, measures: measureNames }, modelTotals: hasTotals && source.modelTotals ? ["Grand Total", ...Array(pivotIndex - 1).fill(""), ...Array(columnValues.length * measureNames.length).fill("—"), ...source.modelTotals.slice(groupingCount)] : undefined };
}
