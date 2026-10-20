import { Answer } from './model.js';
const format = (v: string | number | null) => v === null ? '—' : typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : v;
export function answerCard(answer: Answer) {
  return {
    $schema: 'https://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4',
    body: [
      { type: 'TextBlock', text: answer.demo ? 'askBICS · DEMO DATA' : 'askBICS', size: 'Small', isSubtle: true },
      { type: 'TextBlock', text: answer.title, weight: 'Bolder', size: 'Medium', wrap: true },
      { type: 'TextBlock', text: answer.context, size: 'Small', wrap: true, isSubtle: true },
      ...(answer.rows.length ? [{ type: 'FactSet', facts: answer.rows.map(row => ({
        title: answer.columns.length > 1 ? format(row[0]) : answer.columns[0], value: format(row[row.length - 1])
      })) }] : [{ type: 'TextBlock', text: 'No results for this selection.', wrap: true }]),
      { type: 'TextBlock', text: `Source: ${answer.model} · Queried ${answer.generatedAt}`, size: 'Small', wrap: true, isSubtle: true }
    ],
    ...(answer.reportUrl ? { actions: [{ type: 'Action.OpenUrl', title: 'Open Power BI', url: answer.reportUrl }] } : {})
  };
}

/** Teams chat is a summary; the Ask tab renders the complete original visual UI. */
export function visualAnswerCard(answer: { text: string; kpi?: { title: string; value: string }; table?: { columns: string[]; rows: string[][]; modelTotals?: string[] } }, model: string, appId: string, handoff?: string) {
  const table = answer.table;
  const text = (value: string) => String(value).slice(0, 250);
  const tableRow = (row: string[], bold = false) => ({ type: 'ColumnSet', columns: row.slice(0, 6).map(value => ({ type: 'Column', width: 'stretch', items: [{ type: 'TextBlock', text: text(value), wrap: true, ...(bold ? { weight: 'Bolder' } : {}) }] })) });
  return { $schema: 'https://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4', body: [
    { type: 'TextBlock', text: 'askBICS', size: 'Small', isSubtle: true },
    { type: 'TextBlock', text: text(answer.text), weight: 'Bolder', wrap: true },
    ...(answer.kpi ? [{ type: 'FactSet', facts: [{ title: answer.kpi.title, value: answer.kpi.value }] }] : []),
    ...(table ? [tableRow(table.columns, true), ...table.rows.slice(0, 8).map(row => tableRow(row)), ...(table.modelTotals ? [tableRow(table.modelTotals, true)] : []), ...(table.rows.length > 8 || table.columns.length > 6 ? [{ type: 'TextBlock', text: 'Preview only. Open Ask for the complete answer.', wrap: true, isSubtle: true }] : [])] : []),
    { type: 'TextBlock', text: `Source: ${model}. Report/page slicers are not applied.`, wrap: true, isSubtle: true, size: 'Small' }
  ], actions: [{ type: 'Action.OpenUrl', title: 'Open Ask · tables, matrices and charts', url: `https://teams.microsoft.com/l/entity/${appId}/ask${handoff ? '?context=' + encodeURIComponent(JSON.stringify({ subEntityId: handoff })) : ''}` }] };
}
