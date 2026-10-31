import { QnaTable } from './types';
import { formatPowerBiValue } from '../dataAdapter';

/** Aggregate only explicitly additive, complete model results, never formatted cells. */
export function reuseTransactionSummary(table: QnaTable, field: string, measure: string): QnaTable | undefined {
    if (table.modelResultComplete !== true || !table.summaryAdditiveMeasures?.includes(measure)) return undefined;
    const group = table.columns.indexOf(field), value = table.columns.indexOf(measure);
    if (group < 0 || group >= (table.analysisGroupCount ?? 0) || value < 0) return undefined;
    const groups = new Map<string, {member: string | number | boolean | null; label: string; amount: number | null}>();
    for (let i = 0; i < table.rows.length; i++) {
        const member = table.modelGroupValues?.[i]?.[group], amount = table.modelRawRows?.[i]?.[value];
        if (member === undefined || amount === undefined || (amount !== null && !Number.isFinite(amount))) return undefined;
        const key = JSON.stringify(member);
        const entry = groups.get(key) || {member, label: table.rows[i][group], amount: null};
        if (amount !== null) entry.amount = (entry.amount ?? 0) + amount;
        groups.set(key, entry);
    }
    const entries = [...groups.values()];
    return {columns: [field, measure], rows: entries.map(e => [e.label, e.amount === null ? '—' : formatPowerBiValue(e.amount, table.modelFormats?.[value])]),
        modelTotals: ['Grand Total', entries.some(e=>e.amount!==null)?formatPowerBiValue(entries.reduce((sum,e)=>sum+(e.amount??0),0),table.modelFormats?.[value]):'—'],
        rowIndices: entries.map(() => []), modelRawRows: entries.map(e => [null, e.amount]),
        modelGroupValues: entries.map(e => [e.member]), modelResultComplete: true};
}
