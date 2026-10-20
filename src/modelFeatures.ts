import { QnaTable } from "./qna/types";
import { ModelMatrixData } from "./modelMatrix";

export function modelHierarchy(source: QnaTable, model: ModelMatrixData, groups: string[], measures: string[]): QnaTable {
    if (groups.length < 2 || !model.hierarchy.some(row => row.branch)) return source;
    const branches = model.hierarchy.filter(row => row.branch);
    if (branches.every(row => model.hierarchy.filter(child => child.parent === row.key).length === 1)) return source;
    const nodes = model.hierarchy;
    const measureIndices = measures.map(name => model.table.columns.findIndex(column => column.displayName === name) - groups.length);
    if (measureIndices.some(index => index < 0)) return source;
    const rowSelections = nodes.map(node => {
        const path = JSON.parse(node.key).map(String) as string[];
        return source.rows.flatMap((row, index) => path.every((value, column) => row[column] === value) ? source.modelRowSelections?.[index] || [] : []);
    });
    return { ...source, columns: [groups.join(" > "), ...measures],
        rows: nodes.map(node => [node.label, ...measureIndices.map(index => node.values[index] == null ? "—" : String(node.values[index]))]),
        rowIndices: nodes.map(() => []), modelSelections: undefined, modelRowSelections: rowSelections,
        modelCellSelections: rowSelections.map(selection => [selection, ...measures.map(() => selection)]),
        modelTotals: source.modelTotals ? ["Grand Total", ...source.modelTotals.slice(groups.length)] : undefined,
        matrix: { levels: nodes.map(node => node.depth), keys: nodes.map(node => node.key), parentKeys: nodes.map(node => node.parent), hasChildren: nodes.map(node => node.branch), rowHeader: groups.join(" > "), levelNames: groups }
    };
}

/** Append a separately evaluated period measure, including its model total and selection context. */
export function appendPeriodResult(source: QnaTable, result: QnaTable, sourceColumn: number, kind: "YTD" | "TTM" | "% of revenue", measure: string, groupCount: number): QnaTable {
    const measureColumn = result.columns.indexOf(measure);
    if (measureColumn < 0) throw new Error(`The model did not return ${measure}.`);
    const lookup = new Map(result.rows.map((row, index) => [JSON.stringify(row.slice(0, groupCount)), index]));
    const existingYtd = source.ytdColumns?.find(item => item.sourceColumn === sourceColumn);
    const derivedColumn = kind === "TTM" && existingYtd ? existingYtd.ytdColumn + 1 : sourceColumn + 1;
    const shift = (column: number) => column >= derivedColumn ? column + 1 : column;
    const insert = <T>(values: T[], value: T): T[] => [...values.slice(0, derivedColumn), value, ...values.slice(derivedColumn)];
    const prepared = source as QnaTable & {
        __percentageColumns?: Array<{sourceColumn: number; grandColumn: number; parentColumn?: number}>;
        __visiblePercentageColumns?: number[]; __calculatedColumns?: number[]; __hiddenCalculatedColumns?: number[];
        __calculationSources?: Record<number, number>;
        __calculationDefinitions?: Record<number, {name: string; formula: string; format: string; sourceColumn: number}>;
    };
    const shiftedMetadata = {
        __percentageColumns: prepared.__percentageColumns?.map(item => ({sourceColumn: shift(item.sourceColumn), grandColumn: shift(item.grandColumn), parentColumn: item.parentColumn === undefined ? undefined : shift(item.parentColumn)})),
        __visiblePercentageColumns: prepared.__visiblePercentageColumns?.map(shift),
        __calculatedColumns: prepared.__calculatedColumns?.map(shift),
        __hiddenCalculatedColumns: prepared.__hiddenCalculatedColumns?.map(shift),
        __calculationSources: prepared.__calculationSources && Object.fromEntries(Object.entries(prepared.__calculationSources).map(([column, value]) => [shift(Number(column)), shift(value)])),
        __calculationDefinitions: prepared.__calculationDefinitions && Object.fromEntries(Object.entries(prepared.__calculationDefinitions).map(([column, value]) => [shift(Number(column)), {...value, sourceColumn: shift(value.sourceColumn)}]))
    };
    const matchedRows = source.rows.map(row => lookup.get(JSON.stringify(row.slice(0, groupCount))));
    const selections = matchedRows.map(index => {
        return index === undefined ? [] : result.modelCellSelections?.[index]?.[measureColumn] || result.modelRowSelections?.[index] || [];
    });
    const derivedName = `${source.columns[sourceColumn]} ${kind}`;
    return { ...source, ...shiftedMetadata, columns: insert(source.columns, derivedName),
        revenueColumns: kind === "% of revenue" ? [...(source.revenueColumns || []), {source: source.columns[sourceColumn], column: derivedName}] : source.revenueColumns,
        rows: source.rows.map((row, rowIndex) => {
            if (/^(?:grand )?total$/i.test(row[0])) return insert(row, result.modelTotals?.[measureColumn] || "—");
            const index = matchedRows[rowIndex];
            return insert(row, index === undefined ? "—" : result.rows[index][measureColumn]);
        }),
        modelCellSelections: source.rows.map((_, index) => insert(source.modelCellSelections?.[index] || source.columns.map(() => []), selections[index])),
        modelTotals: source.modelTotals ? insert(source.modelTotals, result.modelTotals?.[measureColumn] || "—") : undefined,
        modelPeriods: source.modelPeriods?.map(item => ({...item, sourceColumn: shift(item.sourceColumn)})),
        hiddenColumns: source.hiddenColumns?.map(shift),
        cellIndices: source.cellIndices?.map(row => insert(row, [])),
        selectionFieldsByColumn: source.selectionFieldsByColumn && insert(source.selectionFieldsByColumn, source.selectionFieldsByColumn[sourceColumn] || []),
        ytdColumns: [...(source.ytdColumns || []).map(item => ({sourceColumn: shift(item.sourceColumn), ytdColumn: shift(item.ytdColumn)})), ...(kind === "YTD" ? [{sourceColumn, ytdColumn: derivedColumn}] : [])],
        ttmColumns: [...(source.ttmColumns || []).map(item => ({sourceColumn: shift(item.sourceColumn), ttmColumn: shift(item.ttmColumn)})), ...(kind === "TTM" ? [{sourceColumn, ttmColumn: derivedColumn}] : [])]
    };
}
