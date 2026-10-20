import { BasicFilter } from "powerbi-models";
import type powerbi from 'powerbi-visuals-api';
import { ParameterConfig, ParameterPlan } from './parameterQuery';
import { QnaResponse, QnaTable } from './qna/types';

/** Recognize only an explicit request; configuring Revenue does not change ordinary answers. */
export function revenueQuestion(question: string): { question: string; enabled: boolean } {
    const pattern = /(?:\bas\s+)?(?:\bpercentage|\bpercent|%)\s+of\s+revenue\b/i;
    return { question: question.replace(pattern, ' ').trim(), enabled: pattern.test(question) };
}
export async function revenueRequest(plan: ParameterPlan, config: ParameterConfig,
    load: (plan: ParameterPlan) => Promise<QnaResponse>, render: (view: powerbi.DataView, plan: ParameterPlan) => QnaResponse): Promise<QnaResponse> {
    const revenue = config.revenue, field = config.fields.find(f => f.name === revenue?.field);
    if (!field || (typeof revenue?.value !== "string" || !revenue.value.trim())) throw new Error('Configure the Revenue field and value in Settings > Percentage of Revenue.');
    if (!plan.measures.length || plan.listOnly) throw new Error('Name a measure to calculate Percentage of Revenue.');
    const denominatorGroups = plan.groups.filter(name => name !== field.name);
    const target = { table: field.table, column: field.column };
    // Replacing a tuple containing the revenue dimension could discard other predicates.
    if (plan.filters.some(f => Array.isArray(f.target) && f.target.some(t => t.table === field.table && t.column === field.column))) throw new Error('Use a separate revenue-field filter instead of a combined tuple filter for Percentage of Revenue.');
    const raw: ParameterPlan = { ...plan, presentation: 'table', totalOnly: false, rank: undefined };
    const numerator = (await load(raw)).table;
    const filters = plan.filters.filter(f => !(!Array.isArray(f.target) && (f.target as any).table === target.table && (f.target as any).column === target.column));
    let revenueValue: string | number = revenue.value;
    if (field.type === 'number') { revenueValue = Number(revenue.value); if (!Number.isFinite(revenueValue)) throw new Error('Revenue value must be numeric for this field.'); }
    const denominator = (await load({ ...raw, groups: denominatorGroups, filters: [...filters, new BasicFilter(target, "In", [revenueValue]).toJSON()] })).table;
    if (!numerator || !denominator) throw new Error('Revenue calculation requires model-backed numeric results.');
    const key = (table: QnaTable, row: string[]) => JSON.stringify(denominatorGroups.map(name => row[table.columns.indexOf(name)]));
    const amounts = new Map(denominator.rows.map((row, index) => [key(denominator, row), denominator.modelRawRows?.[index]]));
    const ratio = (n: unknown, d: unknown): number | null => typeof n === 'number' && typeof d === 'number' && Number.isFinite(n) && Number.isFinite(d) && d !== 0 && Number.isFinite(n / d) ? n / d : null;
    const rows = numerator.rows.map((row, index) => [
        ...plan.groups.map((name, i) => numerator.modelSelections?.[index]?.find(v => v.table === config.fields.find(f => f.name === name)?.table && v.column === config.fields.find(f => f.name === name)?.column)?.value ?? numerator.modelRawRows?.[index]?.[i] ?? row[i]),
        ...plan.measures.map((_, i) => ratio(numerator.modelRawRows?.[index]?.[plan.groups.length + i], amounts.get(key(numerator, row))?.[denominatorGroups.length + i]))
    ]);
    if (!numerator.modelRawTotals || !denominator.modelRawTotals) throw new Error('Power BI did not return the totals needed for Percentage of Revenue.');
    const totals = [...plan.groups.map(() => null), ...plan.measures.map((_, i) => ratio(numerator.modelRawTotals![plan.groups.length + i], denominator.modelRawTotals![denominatorGroups.length + i]))];
    const columns = [...plan.groups.map(name => ({ displayName: name, roles: { categories: true } })), ...plan.measures.map(name => ({ displayName: name, roles: { measures: true }, isMeasure: true, format: '0.00%' }))];
    const response = render({ metadata: { columns }, table: { columns, rows, totals } } as powerbi.DataView, plan);
    response.text = `Percentage of Revenue (${field.name} = ${revenue.value}; same period for both amounts). ${response.text || ''} Missing or zero revenue is shown as —.`;
    if (response.kpi) response.kpi.title += ' · % of Revenue';
    return response;
}
