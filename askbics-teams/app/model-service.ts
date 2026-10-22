import { revenueQuestion } from "../../src/revenue";
import { VisualQueryEngine } from '../generated/visualQueryEngine';
import { ParameterConfig, ParameterPlan } from '../../src/parameterQuery';
import { QnaLayoutSettings, QnaResponse } from '../../src/qna/types';
import { Model, column, literal, UserError } from '../src/model';
import { executePowerBi } from '../src/powerbi';
export { UserError } from '../src/model';

const LIMIT = 10000;
type RichModel = Model & { dimensions: Array<Model['dimensions'][number] & { type?: 'text' | 'number' | 'date' }>; measures: Array<Model['measures'][number] & { formatString?: string }>; time?: ParameterConfig['time'] };
export class ModelSession {
  private dictionaries = new Map<string, string[]>();
  private loading?: Promise<void>;
  private warmedAt = 0;
  private deadline = 0;
  private queryCount = 0;
  constructor(private model: RichModel, private token: string, private fetcher: typeof fetch = fetch) {}
  private query(dax: string) {
    if (this.deadline && (++this.queryCount > 80 || Date.now() >= this.deadline)) throw new UserError('This question needs too many queries. Narrow the date range or grouping and retry.');
    const fetcher: typeof fetch = (url, init) => this.fetcher(url, this.deadline ? { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(Math.max(1, this.deadline - Date.now()))]) } : init);
    return executePowerBi(this.model, dax, this.token, fetcher);
  }
  private config(settings: Partial<QnaLayoutSettings> = {}, time?: ParameterConfig['time']): ParameterConfig {
    const fields = this.model.dimensions.map(d => ({ ...d, type: d.type || (d.numeric || this.model.year?.column === d.column && this.model.year.table === d.table ? 'number' : 'text') as 'text' | 'number' | 'date', values: this.dictionaries.get(d.name) || [] }));
    const aliases = Object.fromEntries([...this.model.measures, ...fields].map(d => [d.name, d.aliases || []]));
    for (const [name, values] of Object.entries(settings.synonyms || {})) {
      if (Object.hasOwn(aliases, name) && Array.isArray(values) && values.length <= 30 && values.every(v => typeof v === 'string' && v.length < 100) && settings.synonymEnabled?.[name] !== false) aliases[name] = [...aliases[name], ...values];
    }
    const setup = time || this.model.time || { yearField: fields.find(f => f.table === this.model.year?.table && f.column === this.model.year.column)?.name };
    // Every target is still resolved from the server allowlist by the original parser/compiler.
    return { analysis: settings.analysis, revenue: settings.revenue, table: 'Teams', column: 'Grouping', enabled: true, options: fields.map(d => d.name), fields, groupAliases: aliases,
      defaultMeasure: this.model.measures.some(m => m.name === settings.defaultMeasure) ? settings.defaultMeasure : undefined,
      additiveMeasures: (settings.additiveMeasures || []).filter(n => this.model.measures.some(m => m.name === n)), time: setup };
  }
  async dictionary(field: string): Promise<{ values: string[]; limited: boolean }> {
    const d = this.model.dimensions.find(d => d.name === field);
    if (!d) throw new UserError('Choose a configured field.');
    if (this.dictionaries.has(field)) return { values: this.dictionaries.get(field)!, limited: false };
    const c = column(d.table, d.column);
    const rows = await this.query(`EVALUATE TOPN(2001, SELECTCOLUMNS(VALUES(${c}), "V", ${c}), [V], ASC) ORDER BY [V] ASC`);
    const values = rows.filter(r => r['[V]'] != null).map(r => String(r['[V]'])).slice(0, 2000);
    // Do not cache incomplete dictionaries as complete. Explicit filters always remain available.
    if (rows.length <= 2000) this.dictionaries.set(field, values);
    return { values, limited: rows.length > 2000 };
  }
  async warm() {
    if (!this.loading) this.loading = (async () => {
      for (const d of this.model.dimensions) if (d.type !== 'date' && !d.numeric && d.type !== 'number') await this.dictionary(d.name);
    })().catch(e => { this.loading = undefined; throw e; });
    return this.loading;
  }
  async answer(question: string, settings: Partial<QnaLayoutSettings> = {}, time?: ParameterConfig['time'], refresh = false, selections: unknown = []): Promise<QnaResponse> {
    if (typeof question !== 'string' || !question.trim() || question.length > 8000) throw new UserError('Enter a question of at most 8000 characters.');
    if (refresh || Date.now() - this.warmedAt > 5 * 60_000) { this.dictionaries.clear(); this.loading = undefined; this.warmedAt = Date.now(); }
    this.deadline = Date.now() + 55_000; this.queryCount = 0;
    try {
    const crossFilter = this.crossFilter(selections);
    await this.warm();
    const config = this.config(settings, time);
    const revenueField = config.fields.find(f => f.name === config.revenue?.field);
    if (revenueQuestion(question).enabled && revenueField && Array.isArray(selections) && selections.some(tuple => Array.isArray(tuple) && tuple.some(v => v.table === revenueField.table && v.column === revenueField.column))) throw new UserError("Clear the cross-filter on the revenue field before calculating Percentage of Revenue.");
    const prefer = (counts: number[]) => settings.cardinalityFallbackEnabled !== false && counts.length > 1 && counts.some(n => n > 0 && n < Math.max(...counts) && n <= Math.max(...counts) * Math.min(100, Math.max(0, Number(settings.cardinalityMatrixThresholdPct ?? 25))) / 100);
    const engine = new VisualQueryEngine(config, this.model.measures.map(m => m.name), (p, c) => this.request(p, c, crossFilter), prefer);
    try { return (await engine.run(question))!; } catch (e) { throw new UserError(e instanceof Error ? e.message : 'Could not interpret the question.'); }
    } finally { this.deadline = 0; }
  }
  private crossFilter(input: unknown): string | undefined {
    if (!Array.isArray(input) || input.length > 100) throw new UserError('Choose at most 100 items to filter.');
    if (!input.length) return;
    const refs = new Set<string>();
    const rows = input.map(row => {
      if (!Array.isArray(row) || !row.length || row.length > 8) throw new UserError('Invalid cross-filter selection.');
      return '(' + row.map(item => {
        const { d, ref } = this.target(item); refs.add(ref);
        if (item.hierarchy || item.hierarchyLevel) throw new UserError('Select a configured field instead of a date hierarchy.');
        const value = this.value(item.value, d.type === 'date');
        return item.dateDay && d.type === 'date' ? `(${ref} >= ${value} && ${ref} < (${value} + 1))` : `(${ref} == ${value})`;
      }).join(' && ') + ')';
    });
    if (refs.size > 8) throw new UserError('Select at most eight fields.');
    const columns = [...refs].map(ref => `ALL(${ref})`);
    return `KEEPFILTERS(FILTER(${columns.length === 1 ? columns[0] : 'CROSSJOIN(' + columns.join(',') + ')'}, ${rows.join(' || ')}))`;
  }
  private target(target: unknown) {
    const t = target as { table?: string; column?: string };
    const d = this.model.dimensions.find(d => d.table === t?.table && d.column === t?.column);
    if (!d) throw new UserError('A filter refers to an unavailable field.');
    return { d, ref: column(d.table, d.column) };
  }
  private value(value: unknown, date = false) {
    if (typeof value === 'number') { if (!Number.isFinite(value)) throw new UserError('Invalid numeric filter.'); return String(value); }
    if (typeof value === 'boolean') return value ? 'TRUE()' : 'FALSE()';
    if (value === null) return 'BLANK()';
    if (typeof value !== 'string' || value.length > 2000) throw new UserError('Invalid filter value.');
    if (date) {
      const parsed = new Date(value); if (!Number.isFinite(parsed.getTime())) throw new UserError('Invalid date filter.');
      return `DATE(${parsed.getUTCFullYear()},${parsed.getUTCMonth()+1},${parsed.getUTCDate()}) + TIME(${parsed.getUTCHours()},${parsed.getUTCMinutes()},${parsed.getUTCSeconds()})`;
    }
    return literal(value);
  }
  private filters(plan: ParameterPlan): string[] {
    return plan.filters.map((raw: any) => {
      if (Array.isArray(raw.target)) {
        const refs = raw.target.map((t: unknown) => this.target(t));
        if (raw.operator !== 'In' || !Array.isArray(raw.values) || raw.values.length > 5000) throw new UserError('Unsupported tuple filter.');
        return `TREATAS({${raw.values.map((row: any[]) => { if (!Array.isArray(row) || row.length !== refs.length) throw new UserError('Invalid tuple.'); return `(${row.map((v, i) => this.value(v.value, refs[i].d.type === 'date')).join(',')})`; }).join(',')}}, ${refs.map((r: any) => r.ref).join(',')})`;
      }
      const { d, ref } = this.target(raw.target);
      if (Array.isArray(raw.values)) {
        if (raw.operator !== 'In' || raw.values.length > 5000) throw new UserError('Unsupported filter operator.');
        return `TREATAS({${raw.values.map((v: unknown) => this.value(v, d.type === 'date')).join(',')}}, ${ref})`;
      }
      if (Array.isArray(raw.conditions) && ['And', 'Or'].includes(raw.logicalOperator)) {
        const operators: Record<string, string> = { GreaterThanOrEqual: '>=', LessThan: '<', GreaterThan: '>', LessThanOrEqual: '<=', Is: '=', IsNot: '<>' };
        return `FILTER(ALL(${ref}), ${raw.conditions.map((c: any) => { if (!operators[c.operator]) throw new UserError('Unsupported date comparison.'); return `(${ref} ${operators[c.operator]} ${this.value(c.value, d.type === 'date')})`; }).join(raw.logicalOperator === 'And' ? ' && ' : ' || ')})`;
      }
      throw new UserError('Unsupported filter; no data was queried.');
    });
  }
  async request(plan: ParameterPlan, config: ParameterConfig, crossFilter?: string): Promise<any> {
    const fields = plan.groups.map(n => { const f = this.model.dimensions.find(f => f.name === n); if (!f) throw new UserError('Unknown grouping field.'); return f; });
    const measures = plan.measures.map(n => { const m = this.model.measures.find(m => m.name === n); if (!m) throw new UserError('Unknown measure.'); return m; });
    if (fields.length > 8 || measures.length > 16) throw new UserError('Choose at most 8 grouping fields and 16 measures.');
    const filters = [...this.filters(plan), ...(crossFilter ? [crossFilter] : [])];
    const measureRef = (m: typeof measures[number]) => `[${m.modelName.replace(/]/g, ']]')}]`;
    const cols = [...fields.map(f => ({ displayName: f.name, queryName: `${f.table}.${f.column}`, roles: { categories: true }, type: { numeric: f.numeric || f.type === 'number', dateTime: f.type === 'date', text: !f.numeric && f.type !== 'number' && f.type !== 'date' } })), ...measures.map(m => ({ displayName: m.name, queryName: m.modelName, roles: { measures: true }, isMeasure: true, format: m.formatString || '#,0.##', type: { numeric: true } }))];
    const totals = measures.length ? await this.query(`EVALUATE ROW(${measures.map((m,i) => `"M${i}", ${filters.length ? `CALCULATE(${measureRef(m)},${filters.join(',')})` : measureRef(m)}`).join(',')})`) : [];
    const totalValues = measures.map((_,i) => totals[0]?.[`[M${i}]`] ?? null);
    const fetchGroups = async (count: number) => {
      const groups = fields.slice(0, count), groupRefs = groups.map(f => column(f.table, f.column));
      const body = `SUMMARIZECOLUMNS(${[...groupRefs, ...filters, ...measures.map((m,i) => `"M${i}", ${measureRef(m)}`)].join(',')})`;
      const selected = `SELECTCOLUMNS(${body}, ${[...groups.map((_,i) => `"G${i}", ${groupRefs[i]}`), ...measures.map((_,i) => `"M${i}", [M${i}]`)].join(',')})`;
      const sort = [...(plan.rank && measures.length ? [`[M0], ${plan.rank.ascending ? 'ASC' : 'DESC'}`] : []), ...groups.map((_,i) => `[G${i}], ASC`)];
      const max = plan.rank ? plan.rank.count : LIMIT + 1;
      const rows = await this.query(`EVALUATE TOPN(${max}, ${selected}, ${sort.join(',')})`);
      if (!plan.rank && rows.length > LIMIT) throw new UserError(`This answer exceeds ${LIMIT.toLocaleString()} rows. Add a filter; no partial answer was displayed.`);
      return rows.map(r => [...groups.map((_,i) => r[`[G${i}]`] ?? null), ...measures.map((_,i) => r[`[M${i}]`] ?? null)]);
    };
    const rows = (plan.totalOnly || !fields.length) ? [[...fields.map(() => null), ...totalValues]] : await fetchGroups(fields.length);
    const view: any = { metadata: { columns: cols }, table: { columns: cols, rows, totals: measures.length ? [...fields.map(() => null), ...totalValues] : undefined } };
    if (plan.presentation === 'matrix' && plan.matrixRowCount === fields.length && fields.length > 1) {
      const levels: any[][] = [];
      for (let depth = 1; depth < fields.length; depth++) levels.push(await fetchGroups(depth));
      levels.push(rows);
      const nodeValues = (v: unknown[]) => Object.fromEntries(v.map((value, i) => [i, { value, valueSourceIndex: i }]));
      const root: any = { children: [], values: nodeValues(totalValues) }, nodes = new Map<string, any>();
      levels.forEach((level, i) => level.forEach(row => { const path = row.slice(0, i + 1), key = JSON.stringify(path); const node: any = { level: i, value: path[i], values: nodeValues(row.slice(i+1)), children: [] }; nodes.set(key, node); (i ? nodes.get(JSON.stringify(path.slice(0,-1))) : root)?.children.push(node); }));
      view.matrix = { rows: { levels: fields.map((_,i) => ({ sources: [cols[i]] })), root }, columns: { levels: [], root: {} }, valueSources: cols.slice(fields.length) };
    }
    return view;
  }
}
