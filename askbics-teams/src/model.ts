export interface Measure { name: string; modelName: string; aliases?: string[]; formatString?: string }
export interface Dimension { name: string; table: string; column: string; aliases?: string[]; numeric?: boolean; type?: 'text' | 'number' | 'date' }
export interface Model {
  name: string; datasetId: string; reportUrl?: string;
  measures: Measure[]; dimensions: Dimension[]; year?: { table: string; column: string };
  time?: { dateField?: string; yearField?: string; monthField?: string; monthIndexField?: string; monthIndexBase?: 0 | 1 };
}
export interface Plan { measure: Measure; dimension?: Dimension; top?: number; year?: number; filter?: { dimension: Dimension; value: string | number } }
export interface Answer {
  title: string; model: string; columns: string[]; rows: Array<Array<string | number | null>>;
  context: string; demo: boolean; generatedAt: string; reportUrl?: string;
}
export class UserError extends Error {}
export const demoModel: Model = {
  name: 'Demo · Service operations', datasetId: 'demo-only',
  measures: [{ name: 'Work items', modelName: 'Work Item Count', aliases: ['items'] }],
  dimensions: [{ name: 'Team', table: 'Teams', column: 'Name', aliases: ['teams'] },
    { name: 'Year', table: 'Calendar', column: 'Year' }],
  year: { table: 'Calendar', column: 'Year' }
};
const normal = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');
function resolve<T extends { name: string; aliases?: string[] }>(text: string, items: T[]): T {
  const found = items.filter(x => [x.name, ...(x.aliases || [])].some(n => normal(n) === normal(text)));
  if (found.length !== 1) throw new UserError(`Please choose an available field: ${items.map(x => x.name).join(', ')}.`);
  return found[0];
}
export function examples(model: Model): string[] {
  const m = model.measures[0]?.name, d = model.dimensions[0]?.name;
  return m ? [`Show total ${m}`, ...(d ? [`Show ${m} by ${d}`, `Show top 5 ${d} by ${m}`] : [])] : [];
}
/** Deliberately constrained pilot grammar: never execute user-supplied DAX. */
export function planQuestion(question: string, model: Model): Plan {
  if (!question.trim() || question.length > 500) throw new UserError('Enter a question between 1 and 500 characters.');
  let q = question.trim().replace(/[?.]$/, '');
  let filter: Plan['filter'];
  const filterMatch = /\s+where\s+(.+?)\s*=\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?)$/i.exec(q);
  if (filterMatch) {
    const dimension = resolve(filterMatch[1], model.dimensions);
    const raw = JSON.parse(filterMatch[2]) as string | number;
    filter = { dimension, value: filterValue(dimension, raw, model) };
    q = q.slice(0, filterMatch.index);
  }
  let year: number | undefined;
  const yearMatch = /\s+in\s+(\d{4})$/i.exec(q);
  if (yearMatch) {
    if (!model.year) throw new UserError('This dataset does not have a configured year field.');
    year = Number(yearMatch[1]);
    if (year < 1900 || year > 2200) throw new UserError('Use a year between 1900 and 2200.');
    q = q.slice(0, yearMatch.index);
  }
  let match = /^(?:show\s+)?total\s+(.+)$/i.exec(q);
  if (match) return { measure: resolve(match[1], model.measures), year, filter };
  match = /^(?:show\s+)?top\s+(\d+)\s+(.+)\s+by\s+(.+)$/i.exec(q);
  if (match) {
    const top = Number(match[1]);
    if (top < 1 || top > 10) throw new UserError('For chat, choose a top count between 1 and 10.');
    return { measure: resolve(match[3], model.measures), dimension: resolve(match[2], model.dimensions), top, year, filter };
  }
  match = /^(?:show\s+)?(.+)\s+by\s+(.+)$/i.exec(q);
  if (match) return { measure: resolve(match[1], model.measures), dimension: resolve(match[2], model.dimensions), year, filter };
  throw new UserError(`This pilot supports totals, breakdowns and top results. Try: ${examples(model).join('; ')}. You can add “in 2025” when a year field is configured.`);
}
export const column = (table: string, name: string) => `'${table.replace(/'/g, "''")}'[${name.replace(/]/g, ']]')}]`;
export const literal = (v: string | number) => typeof v === 'number' ? String(v) : `"${v.replace(/"/g, '""')}"`;
export function filterValue(d: Dimension, value: unknown, model: Model): string | number {
  if (typeof value !== 'string' && typeof value !== 'number') throw new UserError('Choose a filter value.');
  if (String(value).length > 200 || String(value).trim() === '') throw new UserError('Choose a value between 1 and 200 characters.');
  if (d.numeric || (model.year?.table === d.table && model.year.column === d.column)) {
    if (!/^-?\d+(\.\d+)?$/.test(String(value)) || !Number.isFinite(Number(value))) throw new UserError('This field needs a numeric value.');
    return Number(value);
  }
  return String(value);
}
export function guidedPlan(data: Record<string, unknown>, model: Model): Plan {
  const measure = resolve(String(data.measure || ''), model.measures);
  const dimension = data.dimension ? resolve(String(data.dimension), model.dimensions) : undefined;
  const plan: Plan = { measure, dimension };
  if (data.year) {
    const year = Number(data.year);
    if (!model.year || !Number.isInteger(year) || year < 1900 || year > 2200) throw new UserError('Choose a year between 1900 and 2200.');
    plan.year = year;
  }
  if (data.filterField) {
    const d = resolve(String(data.filterField), model.dimensions);
    plan.filter = { dimension: d, value: filterValue(d, data.filterValue, model) };
  } else if (data.filterValue) throw new UserError('Choose a filter field first.');
  return plan;
}
export function buildDax(plan: Plan, model: Model): string {
  const measure = `[${plan.measure.modelName.replace(/]/g, ']]')}]`;
  const filters: string[] = [];
  if (plan.year !== undefined && model.year) filters.push(`TREATAS({${plan.year}}, ${column(model.year.table, model.year.column)})`);
  if (plan.filter) filters.push(`TREATAS({${literal(plan.filter.value)}}, ${column(plan.filter.dimension.table, plan.filter.dimension.column)})`);
  const filter = filters.join(', ');
  if (!plan.dimension) return `EVALUATE ROW("Value", ${filter ? `CALCULATE(${measure}, ${filter})` : measure})`;
  const group = column(plan.dimension.table, plan.dimension.column);
  const grouped = `SUMMARIZECOLUMNS(${group}, ${filter ? filter + ', ' : ''}"Value", ${measure})`;
  const selected = `SELECTCOLUMNS(${grouped}, "Category", ${group}, "Value", [Value])`;
  // Fetch one extra row for ordinary breakdowns so an incomplete list is never silently presented as complete.
  const count = plan.top || 11;
  return `EVALUATE TOPN(${count}, ${selected}, [Value], DESC, [Category], ASC) ORDER BY [Value] DESC, [Category] ASC`;
}
