import { Model, UserError } from './model.js';
import { ConnectionBook } from './connections.js';
import { ReportState } from './report-state.js';
/** Identity must come from authenticated Entra or the SDK-verified personal Teams activity. */
export async function selectedModel(storage: ReportState | undefined, identity: string, fallback: Model): Promise<Model> {
  if (!storage) throw new UserError('Saved connections are unavailable. Contact your administrator.');
  const book = await storage.read(`${identity}:connections`) as ConnectionBook | null;
  if (!book?.selected || book.selected === fallback.datasetId) return fallback;
  const model = book.models.find(m => m.datasetId === book.selected);
  if (!model) throw new UserError('Your selected model is unavailable. Open Ask and choose a connection.');
  return model;
}
export function chatIdentity(tenant: string, oid?: string): string {
  if (!oid || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(oid)) throw new UserError('Your Teams identity could not be confirmed. Reopen askBICS in your organisation account.');
  return `${tenant.toLowerCase()}:${oid.toLowerCase()}`;
}
