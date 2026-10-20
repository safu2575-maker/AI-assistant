import { createRequire } from 'node:module';
import { RecordBatchReader, compressionRegistry, CompressionType } from 'apache-arrow';
import { Model, UserError } from './model.js';
import { executePowerBi } from './powerbi.js';
const lz4 = createRequire(import.meta.url)('lz4js');
compressionRegistry.set(CompressionType.LZ4_FRAME, { decode: (bytes: Uint8Array) => {
  if (lz4.decompressBound(bytes) > 32 * 1024 * 1024) throw new Error('Metadata exceeds limit');
  return lz4.decompress(bytes);
} });
export const guid = (v: unknown): v is string => typeof v === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(v);
const base = 'https://api.powerbi.com/v1.0/myorg';
export type Connection = Model & { workspaceId: string; workspaceName?: string };
export type ConnectionBook = { models: Connection[]; selected?: string };
export function powerBiError(status: number): UserError {
  return new UserError(status === 401 ? 'Your Power BI sign-in expired. Sign out and sign in again.' : status === 403 ? 'Power BI denied access. Ask for Read and Build permissions on this model, and check the query tenant settings. Workspace browsing also needs Workspace.Read.All consent.' : status === 429 ? 'Power BI is busy. Wait a minute and retry.' : 'Power BI could not read this model. Check access and that the semantic model supports metadata queries.');
}
export async function catalogue(path: string, token: string, fetcher: typeof fetch = fetch) {
  const r = await fetcher(base + path, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw powerBiError(r.status);
  return await r.json() as any;
}
export async function workspaces(token: string, fetcher: typeof fetch = fetch) {
  const result = [{ id: 'me', name: 'My workspace' }];
  for (let skip = 0; skip < 10000; skip += 1000) {
    const data = await catalogue(`/groups?$top=1000&$skip=${skip}`, token, fetcher);
    if (!Array.isArray(data.value)) throw new UserError('Power BI returned an invalid workspace list.');
    result.push(...data.value.filter((x: any) => guid(x.id)).map((x: any) => ({ id: x.id, name: String(x.name) })));
    if (data.value.length < 1000) return result;
  }
  throw new UserError('Too many workspaces to list. Paste your model link instead.');
}
export function workspacePath(id: unknown) {
  if (id !== 'me' && !guid(id)) throw new UserError('Choose a workspace.');
  return id === 'me' ? '' : `/groups/${id}`;
}
export async function datasets(workspace: string, token: string, fetcher: typeof fetch = fetch) {
  const data = await catalogue(`${workspacePath(workspace)}/datasets`, token, fetcher);
  if (!Array.isArray(data.value)) throw new UserError('Power BI returned an invalid model list.');
  return data.value.filter((x: any) => guid(x.id)).map((x: any) => ({ id: x.id, name: String(x.name) }));
}
export async function metadataRows(response: Response): Promise<Record<string, unknown>[]> {
  if (!response.ok) throw powerBiError(response.status);
  if (!response.body) throw new UserError('Power BI returned no metadata.');
  const reader = response.body.getReader(), parts: Uint8Array[] = []; let length = 0;
  for (;;) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > 16 * 1024 * 1024) { await reader.cancel(); throw new UserError('Model metadata is too large.'); } parts.push(value); }
  const bytes = Buffer.concat(parts); const rows: Record<string, unknown>[] = []; let streams = 0;
  try {
    for (const stream of RecordBatchReader.readAll(bytes)) {
      streams++;
      if (stream.schema.metadata.get('IsError')?.toLowerCase() === 'true') throw new Error('Power BI metadata error');
      for (const batch of stream) for (const row of batch) { rows.push(row.toJSON()); if (rows.length > 5000) throw new Error('Too many fields'); }
    }
    if (!streams) throw new Error('No stream');
  } catch { throw new UserError('Automatic field discovery is unavailable for this model. Check Read/Build permissions and the XMLA/query tenant settings, or use the manual field setup below.'); }
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/^\[|\]$/g, ''), v])));
}
export function modelFromMetadata(name: string, datasetId: string, workspaceId: string, rows: Record<string, unknown>[]): Connection {
  const measures = rows.filter(r => r.Kind === 'measure').map(r => ({ name: String(r.Name), modelName: String(r.Name), formatString: String(r.Format || '') }));
  const names = new Set(measures.map(m => m.name.toLowerCase()));
  const columns = rows.filter(r => r.Kind === 'column');
  const dimensions = columns.map(r => {
    let label = String(r.Name);
    if (names.has(label.toLowerCase()) || columns.filter(x => String(x.Name).toLowerCase() === label.toLowerCase()).length > 1) label = `${r.Table} · ${r.Name}`;
    while (names.has(label.toLowerCase())) label += ' (field)'; names.add(label.toLowerCase());
    const type: 'text' | 'number' | 'date' = /date/i.test(String(r.Type)) ? 'date' : /int|decimal|double|currency|number/i.test(String(r.Type)) ? 'number' : 'text';
    return { name: label, table: String(r.Table), column: String(r.Name), type, numeric: type === 'number' };
  });
  return validateConnection({ name, datasetId, workspaceId, measures, dimensions });
}
export async function discover(workspaceId: string, datasetId: string, token: string, fetcher: typeof fetch = fetch): Promise<Connection> {
  if (!guid(datasetId)) throw new UserError('Choose a semantic model.');
  const item = await catalogue(`${workspacePath(workspaceId)}/datasets/${datasetId}`, token, fetcher);
  // Only fixed metadata queries; never accept DAX from the browser. Exclude hidden fields and formulas.
  const query = `EVALUATE UNION(SELECTCOLUMNS(FILTER(INFO.VIEW.MEASURES(), NOT([IsHidden])), "Kind", "measure", "Name", [Name], "Table", [Table], "Type", [DataType], "Format", [FormatString]), SELECTCOLUMNS(FILTER(INFO.VIEW.COLUMNS(), NOT([IsHidden])), "Kind", "column", "Name", [Name], "Table", [Table], "Type", [DataType], "Format", ""))`;
  const response = await fetcher(`${base}/datasets/${datasetId}/executeDaxQueries`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, queryTimeout: 25, resultSetRowCountLimit: 5001 }), signal: AbortSignal.timeout(30000) });
  return modelFromMetadata(String(item.name), datasetId, workspaceId, await metadataRows(response));
}
export function validateConnection(value: any): Connection {
  const text = (s: any, label: string) => { if (typeof s !== 'string' || !s.trim() || s.length > 256 || /[\x00-\x1f]/.test(s)) throw new UserError(`Enter a valid ${label} (up to 256 characters).`); return s.trim(); };
  if (!guid(value?.datasetId)) throw new UserError('Invalid semantic model ID.'); workspacePath(value.workspaceId);
  if (!Array.isArray(value.measures) || !value.measures.length || value.measures.length > 200 || !Array.isArray(value.dimensions) || value.dimensions.length > 500) throw new UserError('Select 1–200 measures and up to 500 fields. Create an explicit measure in Power BI if the model has none.');
  const names = new Set<string>(); const unique = (s: any) => { const n = text(s, 'display name'); if (names.has(n.toLowerCase())) throw new UserError(`Use a unique display name for ${n}.`); names.add(n.toLowerCase()); return n; };
  const model: Connection = { name: text(value.name, 'connection name'), datasetId: value.datasetId, workspaceId: value.workspaceId,
    measures: value.measures.map((m: any) => ({ name: unique(m.name), modelName: text(m.modelName, 'measure name'), ...(typeof m.formatString === 'string' && m.formatString.length <= 256 ? { formatString: m.formatString } : {}) })),
    dimensions: value.dimensions.map((d: any) => { if (!['text', 'number', 'date'].includes(d.type)) throw new UserError('Choose a field type.'); return { name: unique(d.name), table: text(d.table, 'table name'), column: text(d.column, 'column name'), type: d.type, numeric: d.type === 'number' }; }) };
  model.time = {};
  for (const key of ['dateField', 'yearField'] as const) if (value.time?.[key]) {
    const d = model.dimensions.find(d => d.name === value.time[key]);
    if (!d || d.type !== (key === 'dateField' ? 'date' : 'number')) throw new UserError(`Choose a valid ${key === 'dateField' ? 'date' : 'numeric year'} field.`);
    model.time[key] = d.name; if (key === 'yearField') model.year = { table: d.table, column: d.column };
  }
  return model;
}
export async function verifyConnection(model: Model, token: string, fetcher: typeof fetch = fetch) {
  // Validates every configured identifier without fetching business rows. Permission checks use the caller's token.
  const measure = (name: string) => `[${name.replace(/]/g, ']]')}]`;
  const refs = model.measures.map(m => `IF(FALSE(), ${measure(m.modelName)}, 0)`);
  const { column } = await import('./model.js');
  refs.push(...model.dimensions.map(d => `IF(FALSE(), COUNTROWS(VALUES(${column(d.table, d.column)})), 0)`));
  await executePowerBi(model, `EVALUATE ROW(${refs.map((r, i) => `"Check${i}", ${r}`).join(', ')})`, token, fetcher);
}
