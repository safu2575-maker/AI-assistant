import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Model } from './model.js';
const guid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const required = (key: string) => { const value = env[key]?.trim(); if (!value || value.startsWith('REPLACE_')) throw new Error(`Configure ${key} in askbics-teams/.env.`); return value; };
  const tenantId = required('TENANT_ID'), clientId = required('CLIENT_ID');
  if (!guid.test(tenantId) || !guid.test(clientId)) throw new Error('TENANT_ID and CLIENT_ID must be Microsoft GUIDs.');
  const clientSecret = required('CLIENT_SECRET'), connection = required('POWERBI_OAUTH_CONNECTION');
  const model = JSON.parse(readFileSync(resolve(required('MODEL_CONFIG')), 'utf8')) as Model;
  if (!model.name || !guid.test(model.datasetId) || !Array.isArray(model.measures) || !model.measures.length || !Array.isArray(model.dimensions)) throw new Error('Configure a dataset ID, name, measures and dimensions in the model configuration.');
  for (const m of model.measures) if (!m.name || !m.modelName) throw new Error('Each measure needs name and modelName.');
  for (const d of model.dimensions) if (!d.name || !d.table || !d.column) throw new Error('Each dimension needs name, table and column.');
  if (model.year && (!model.year.table || !model.year.column)) throw new Error('The year field needs table and column; it must be a numeric year column.');
  if (model.reportUrl && !/^https:\/\/app\.powerbi\.com\//.test(model.reportUrl)) throw new Error('reportUrl must be an HTTPS app.powerbi.com URL.');
  const port = Number(env.PORT || 3978);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1–65535.');
  return { tenantId, clientId, clientSecret, connection, model, port };
}
export function allowedConversation(channel: string, tenant: string | undefined, kind: string | undefined, expectedTenant: string): boolean {
  return channel === 'msteams' && tenant?.toLowerCase() === expectedTenant.toLowerCase() && kind === 'personal';
}
