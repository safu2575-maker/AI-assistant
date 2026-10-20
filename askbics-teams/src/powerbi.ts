import { Answer, Model, Plan, UserError, buildDax, column, literal } from './model.js';

export async function queryPowerBi(model: Model, plan: Plan, userToken: string, fetcher: typeof fetch = fetch): Promise<Answer> {
  const result = await executePowerBi(model, buildDax(plan, model), userToken, fetcher);
  const value = (v: unknown): string | number | null => v === null || v === undefined ? null : typeof v === 'number' || typeof v === 'string' ? v : String(v);
  const rows = result.slice(0, 10).map(r => plan.dimension ? [value(r['[Category]']), value(r['[Value]'])] : [value(r['[Value]'])]);
  return {
    title: plan.dimension ? `${plan.measure.name} by ${plan.dimension.name}` : `Total ${plan.measure.name}`,
    model: model.name, columns: plan.dimension ? [plan.dimension.name, plan.measure.name] : [plan.measure.name], rows,
    context: `${plan.year ? `Year: ${plan.year}` : 'All periods'}${plan.filter ? ` · ${plan.filter.dimension.name}: ${plan.filter.value}` : ''} · ${plan.top ? `Top ${plan.top}` : result.length > 10 ? 'Top 10 shown; more categories exist' : 'Returned results'} · Power BI report slicers are not applied`,
    demo: false, generatedAt: new Date().toISOString(), reportUrl: model.reportUrl
  };
}
export async function searchValues(model: Model, field: string, search: string, token: string, fetcher: typeof fetch = fetch): Promise<Array<{ title: string; value: string }>> {
  const d = model.dimensions.find(d => d.name === field);
  if (!d || typeof search !== 'string' || search.length > 100) throw new UserError('Choose an available field and a shorter search.');
  const c = column(d.table, d.column);
  // VALUES retains the caller's RLS. Literal FIND avoids wildcard expansion.
  const dax = `EVALUATE TOPN(15, SELECTCOLUMNS(FILTER(VALUES(${c}), NOT(ISBLANK(${c})) && CONTAINSSTRING(${c} & "", ${literal(search.replace(/~/g, '~~').replace(/\*/g, '~*').replace(/\?/g, '~?'))})), "Value", ${c}), [Value], ASC) ORDER BY [Value] ASC`;
  const rows = await executePowerBi(model, dax, token, fetcher);
  return rows.slice(0, 15).filter(r => r['[Value]'] !== null && r['[Value]'] !== undefined).map(r => ({ title: String(r['[Value]']), value: String(r['[Value]']) }));
}
export async function executePowerBi(model: Model, dax: string, userToken: string, fetcher: typeof fetch = fetch): Promise<Record<string, unknown>[]> {
  if (!userToken) throw new UserError('Sign in with your Microsoft work account first.');
  if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(model.datasetId)) throw new UserError('The Power BI dataset has not been configured.');
  const response = await fetcher(`https://api.powerbi.com/v1.0/myorg/datasets/${model.datasetId}/executeQueries`, {
    method: 'POST', headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ queries: [{ query: dax }], serializerSettings: { includeNulls: true } }),
    signal: AbortSignal.timeout(25000)
  });
  if (response.status === 401) throw new UserError('Your Power BI sign-in needs renewing. Use /signout and then ask again.');
  if (response.status === 403) throw new UserError('Power BI denied access. Ask your administrator to check model Read/Build permissions and the query tenant setting.');
  if (response.status === 429) throw new UserError('Power BI is busy. Please wait briefly and try again.');
  if (!response.ok) throw new UserError('Power BI could not complete this query. Check the configured model fields or try again later.');
  const payload = await response.json() as { error?: unknown; results?: Array<{ error?: unknown; tables?: Array<{ error?: unknown; rows?: Record<string, unknown>[] }> }> };
  if (payload.error || payload.results?.some(r => r.error || r.tables?.some(t => t.error))) throw new UserError('Power BI returned an incomplete or failed result. No answer was displayed.');
  const result = payload.results?.[0]?.tables?.[0]?.rows;
  if (!Array.isArray(result)) throw new UserError('Power BI returned an unexpected response.');
  return result;
}

