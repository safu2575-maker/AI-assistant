import { QnaTable } from "./qna/types";
import { compareTimeLabels } from "./qna/timeLayout";
import { wideCategoryFields, COLUMN_LAYOUT_NOTICE } from './columnLayout';

/** Pivot already aggregated model cells. Never sum cells to manufacture totals. */
export function pivotModelTable(source: QnaTable, groupingCount: number, rowTotals?: Map<string, string[]>, rowCount = groupingCount - 1, timeFields: string[] = []): QnaTable {
    if (groupingCount < 2 || rowCount >= groupingCount) return source;
    const move = wideCategoryFields(source.columns.slice(rowCount, groupingCount), source.rows.map(row => row.slice(rowCount, groupingCount)), timeFields).map(i => i + rowCount);
    if (move.length) {
        const retained = source.columns.slice(rowCount, groupingCount).map((_, i) => i + rowCount).filter(i => !move.includes(i));
        const order = [...Array.from({length:rowCount}, (_,i)=>i), ...move, ...retained, ...source.columns.slice(groupingCount).map((_,i)=>i+groupingCount)];
        const reorder = <T>(values: T[]) => order.map(i=>values[i]);
        const adjusted:QnaTable = {...source, columns:reorder(source.columns), rows:source.rows.map(reorder),
            modelRawRows:source.modelRawRows?.map(reorder), modelRawTotals:source.modelRawTotals&&reorder(source.modelRawTotals),
            modelTotals:source.modelTotals&&reorder(source.modelTotals), modelFormats:source.modelFormats&&reorder(source.modelFormats),
            modelEvaluatedTotals:source.modelEvaluatedTotals&&reorder(source.modelEvaluatedTotals),
            modelGroupValues:source.modelGroupValues?.map(row=>order.slice(0,groupingCount).map(i=>row[i])),
            modelSelections:source.modelSelections?.map(row=>row.length===groupingCount?order.slice(0,groupingCount).map(i=>row[i]):row),
            modelCellSelections:source.modelCellSelections?.map(reorder), cellIndices:source.cellIndices?.map(reorder)};
        const result = retained.length ? pivotModelTable(adjusted, groupingCount, undefined, rowCount+move.length, timeFields) : adjusted;
        result.columnLayoutNotice = COLUMN_LAYOUT_NOTICE;
        if(source.modelEditor)result.modelEditor={...source.modelEditor,rows:adjusted.columns.slice(0,rowCount+move.length),columns:adjusted.columns.slice(rowCount+move.length,groupingCount)};
        return result;
    }
    const keys=source.rows.map(row=>JSON.stringify(row.slice(0,groupingCount)));
    const counts=new Map<string,number>();keys.forEach(key=>counts.set(key,(counts.get(key)||0)+1));
    const duplicateRows=keys.flatMap((key,index)=>(counts.get(key)||0)>1?[index]:[]);
    if(duplicateRows.length)return {...source,duplicateRows,modelEditor:source.modelEditor?{...source.modelEditor,rows:source.columns.slice(0,groupingCount),columns:[]}:undefined};
    const pivotIndex = rowCount;
    const columnLabel = (row: string[]) => row.slice(pivotIndex, groupingCount).join(" · ");
    const measureNames = source.columns.slice(groupingCount);
    const columnValues = Array.from(new Set(source.rows.map(columnLabel))).sort(compareTimeLabels);
    const groups = new Map<string, { labels: string[]; cells: Map<string, string[]>; firstIndex: number; rowIndices: number[]; cellIndices: Map<string, number> }>();
    for (const [index, row] of source.rows.entries()) {
        const labels = row.slice(0, pivotIndex); const key = JSON.stringify(labels);
        let group = groups.get(key);
        if (!group) { group = { labels, cells: new Map(), firstIndex: index, rowIndices: [], cellIndices: new Map() }; groups.set(key, group); }
        const column = columnLabel(row);
        group.rowIndices.push(index);
        group.cellIndices.set(column, index);
        if (group.cells.has(column)) throw new Error("The model returned duplicate matrix cells. Add the missing grouping field before displaying this matrix.");
        group.cells.set(column, row.slice(groupingCount));
    }
    const hasTotals = !!rowTotals?.size;
    const rows = [...groups.values()].map(group => [...group.labels, ...columnValues.flatMap(value => group.cells.get(value) || measureNames.map(() => "—")), ...(hasTotals ? rowTotals!.get(JSON.stringify(group.labels)) || measureNames.map(() => "—") : [])]);
    const columns = [...source.columns.slice(0, pivotIndex), ...columnValues.flatMap(value => measureNames.map(name => measureNames.length === 1 ? value : `${value} ${name}`)), ...(hasTotals ? measureNames.map(name => measureNames.length === 1 ? "Total" : `${name} Total`) : [])];
    const modelSelections = [...groups.values()].map(group => { const index = group.firstIndex; return source.modelSelections?.[index]?.slice(0, pivotIndex) || []; });
    const modelRowSelections = [...groups.values()].map(group => group.rowIndices.flatMap(index => source.modelRowSelections?.[index] || []));
    const modelCellSelections = [...groups.values()].map((group, groupIndex) => [...group.labels.map(() => modelRowSelections[groupIndex]), ...columnValues.flatMap(value => measureNames.map(() => (source.modelRowSelections?.[group.cellIndices.get(value)!] || []).slice())), ...(hasTotals ? measureNames.map(() => modelRowSelections[groupIndex]) : [])]);
    return { columns, rows, modelSelections, modelRowSelections, modelCellSelections, rowIndices: rows.map(() => []), modelPivot: { rowFields: source.columns.slice(0, pivotIndex), columnField: source.columns[pivotIndex], columnFields: source.columns.slice(pivotIndex, groupingCount), columnValues, measures: measureNames }, modelTotals: hasTotals && source.modelTotals ? ["Grand Total", ...Array(pivotIndex - 1).fill(""), ...Array(columnValues.length * measureNames.length).fill("—"), ...source.modelTotals.slice(groupingCount)] : undefined };
}
