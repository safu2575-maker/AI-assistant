import { BasicFilter } from "powerbi-models";
import type powerbi from 'powerbi-visuals-api';
import { ParameterConfig, ParameterPlan } from './parameterQuery';
import { QnaResponse, QnaTable } from './qna/types';

/** Defaults for the accounting hierarchy explicitly supported by the setup UI. */
export function revenueChildFields(revenue: {field: string; childFields?: string[]}, fields: string[]): string[] {
    if (revenue.childFields) return revenue.childFields.filter(name => name !== revenue.field);
    const normalize = (name: string) => name.toLowerCase().replace(/[\s_-]/g, "");
    return normalize(revenue.field) === "lineitem"
        ? fields.filter(name => ["details", "gldescription"].includes(normalize(name))) : [];
}

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
    const hierarchy = new Set([field.name, ...revenueChildFields(revenue!, config.fields.map(item => item.name))]);
    const denominatorGroups = plan.groups.filter(name => !hierarchy.has(name));
    const target = { table: field.table, column: field.column };
    const hierarchyTargets = config.fields.filter(item => hierarchy.has(item.name));
    const isHierarchyTarget = (target: any) => hierarchyTargets.some(item => target?.table === item.table && target?.column === item.column);
    const raw: ParameterPlan = { ...plan, presentation: 'table', totalOnly: false, rank: undefined };
    const loadTotals = async (query: ParameterPlan): Promise<QnaTable | undefined> => {
        const table = (await load(query)).table;
        if (!table) return table;
        if (query.groups.length === 0 && table.rows.length === 1) {
            table.modelRawTotals = table.modelRawRows?.[0];
        } else if (plan.measures.some((_, i) => table.modelRawTotals?.[query.groups.length + i] == null)) {
            const scalar = (await load({...query, groups: []})).table;
            if (scalar?.rows.length === 1) table.modelRawTotals = [...query.groups.map(() => null), ...(scalar.modelRawRows?.[0] || plan.measures.map(() => null))];
        }
        return table;
    };
    const numerator = await loadTotals(raw);
    const filters = plan.filters.flatMap(filter => {
        if (!Array.isArray(filter.target)) return isHierarchyTarget(filter.target) ? [] : [filter];
        const retained = filter.target.map((target, index) => isHierarchyTarget(target) ? -1 : index).filter(index => index >= 0);
        if (retained.length === filter.target.length) return [filter];
        if (!retained.length) return [];
        const tuple = filter as any;
        if (tuple.operator !== "In" || !Array.isArray(tuple.values)) throw new Error("This combined accounting filter cannot be separated safely. Use individual field filters for Percentage of Revenue.");
        const values = [...new Map(tuple.values.map((row: any[]) => {
            const value = retained.map(index => row[index]); return [JSON.stringify(value), value];
        })).values()];
        return [{...filter, target: retained.map(index => (filter.target as any[])[index]), values} as any];
    });
    let revenueValue: string | number = revenue.value;
    if (field.type === 'number') { revenueValue = Number(revenue.value); if (!Number.isFinite(revenueValue)) throw new Error('Revenue value must be numeric for this field.'); }
    const denominator = await loadTotals({ ...raw, groups: denominatorGroups, filters: [...filters, new BasicFilter(target, "In", [revenueValue]).toJSON()] });
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
