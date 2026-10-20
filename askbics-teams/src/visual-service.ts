import { createRequire } from 'node:module';
import { Model, UserError } from './model.js';
export interface VisualSession {
  answer(question: string, settings?: Record<string, unknown>, time?: Record<string, unknown>, refresh?: boolean, selections?: unknown): Promise<any>;
  dictionary(field: string): Promise<{ values: string[]; limited: boolean }>;
}
const require = createRequire(import.meta.url);
export function visualSession(model: Model, token: string, fetcher: typeof fetch = fetch): VisualSession {
  const { ModelSession, UserError: BundledUserError } = require('../visual-server.cjs');
  const service = new ModelSession(model, token, fetcher);
  const run = async (operation: () => Promise<any>) => { try { return await operation(); } catch (e) { if (e instanceof BundledUserError) throw new UserError((e as Error).message); throw e; } };
  return { answer: (question, settings, time, refresh, selections) => run(() => service.answer(question, settings, time, refresh, selections)), dictionary: field => run(() => service.dictionary(field)) };
}
