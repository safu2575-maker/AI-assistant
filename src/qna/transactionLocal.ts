import { QnaTable } from './types';
import { formatPowerBiValue } from '../dataAdapter';

export type TransactionSelection = Map<string, Set<string>>;

/** Never sum ratios, custom KPIs, partial results, or formatted display values. */
export function filterTransactionRows(table: QnaTable, selection: TransactionSelection, except?: string): QnaTable | undefined {
    if (table.modelResultComplete !== true) return undefined;
    const count = table.analysisGroupCount ?? 0;
    const filters = [...selection].filter(([field]) => field !== except);
    const columns = filters.map(([field]) => table.columns.indexOf(field));
    if (columns.some(index => index < 0 || index >= count)) return undefined;
    for (let column = count; column < table.columns.length; column++) {
        if (!table.summaryAdditiveMeasures?.includes(table.columns[column])) return undefined;
        if (table.rows.some((_, i) => { const value = table.modelRawRows?.[i]?.[column]; return value === undefined || value !== null && !Number.isFinite(value); })) return undefined;
    }
    if (table.rows.some((_, i) => columns.some(column => table.modelGroupValues?.[i]?.[column] === undefined))) return undefined;
    const indices = table.rows.map((_, i) => i).filter(i => filters.every(([, values], f) => values.has(JSON.stringify(table.modelGroupValues![i][columns[f]]))));
    const pick = <T>(values?: T[]) => values && indices.map(i => values[i]);
    const rawTotals = table.columns.map((_, column) => column < count ? null : indices.reduce<number | null>((sum, i) => {
        const value = table.modelRawRows![i][column];
        return value === null ? sum : (sum ?? 0) + value;
    }, null));
    return {...table, drillScopes: table.drillScopes?.map(scope=>({...scope, summaryFilters:filters.map(([field,values])=>({field,values:[...values].map(value=>JSON.parse(value))}))})), rows: pick(table.rows)!, rowIndices: pick(table.rowIndices)!, modelRawRows: pick(table.modelRawRows),
        modelGroupValues: pick(table.modelGroupValues), modelSelections: pick(table.modelSelections),
        modelRowSelections: pick(table.modelRowSelections), modelCellSelections: pick(table.modelCellSelections), cellIndices: pick(table.cellIndices),
        transactionExcludedRows: table.transactionExcludedRows && indices.flatMap((source, i) => table.transactionExcludedRows!.includes(source) ? [i] : []),
        transactionReviewRows: table.transactionReviewRows && Object.fromEntries(indices.flatMap((source, i) => table.transactionReviewRows![source] ? [[i, table.transactionReviewRows![source]]] : [])),
        modelRawTotals: rawTotals, modelTotals: rawTotals.map((value, column) => column < count ? column === 0 ? 'Grand Total' : '' : value === null ? '—' : formatPowerBiValue(value, table.modelFormats?.[column]))};
}
