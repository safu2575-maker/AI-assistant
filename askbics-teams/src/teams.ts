import { App, ExpressAdapter } from '@microsoft/teams.apps';
import express from 'express';
import { randomBytes } from 'node:crypto';
import { ReportState } from './report-state.js';
import { selectedModel, chatIdentity } from './selected-model.js';
import { MessageActivity } from '@microsoft/teams.api';
import { loadConfig, allowedConversation } from './config.js';
import { examples, guidedPlan, UserError } from './model.js';
import { queryPowerBi, searchValues } from './powerbi.js';
import { answerCard, visualAnswerCard } from './cards.js';
import { visualSession, VisualSession } from './visual-service.js';
import { guidedCard } from './guided.js';
import { mountTab } from './tab.js';

const config = loadConfig();
const storage = process.env.STATE_KEY ? new ReportState(Buffer.from(process.env.STATE_KEY, 'hex')) : undefined;
const web = express();
web.disable('x-powered-by');
if (process.env.TAB_ORIGIN) mountTab(web, config, process.env.TAB_ORIGIN);
// SDK verifies inbound Bot Service authentication. Never enable unauthenticated requests here.
const app = new App({ clientId: config.clientId, clientSecret: config.clientSecret,
  tenantId: config.tenantId, applicationIdUri: `api://botid-${config.clientId}`, httpServerAdapter: new ExpressAdapter(web) });
const powerbi = app.addOAuthFlow(config.connection, { oauthCardText: 'Sign in to access your authorised Power BI data.', signInButtonText: 'Sign in with Microsoft' });
powerbi.onSignInComplete(async ctx => {
  await ctx.send('You are signed in. Please send your question again. Type /help for examples.');
});
// One in-flight question per user. Tokens and answers are never persisted in this pilot.
const busy = new Set<string>();
const visualSessions = new Map<string, { token: string; modelKey: string; expires: number; session: VisualSession }>();
app.on('card.search', async ctx => {
  const a = ctx.activity;
  if (!allowedConversation(a.channelId, a.channelData?.tenant?.id, a.conversation.conversationType, config.tenantId)) return { status: 403 };
  const token = await powerbi.getToken(ctx);
  if (!token) return { status: 401 };
  const data = a.value as unknown as { dataset?: string; queryText?: string; data?: { filterField?: string } };
  if (!data.dataset?.startsWith('model-values:') || !data.data?.filterField) return { status: 200, body: { statusCode: 200, type: 'application/vnd.microsoft.search.searchResponse', value: { results: [] } } };
  const key = `${config.tenantId}:${a.from.id}`;
  if (busy.has(key)) return { status: 429 };
  busy.add(key);
  try {
    const model = await selectedModel(storage, chatIdentity(config.tenantId, a.from.aadObjectId), config.model);
    if (data.dataset !== `model-values:${model.datasetId}`) return { status: 409 };
    const results = await searchValues(model, data.data.filterField, data.queryText || '', token);
    return { status: 200, body: { statusCode: 200, type: 'application/vnd.microsoft.search.searchResponse', value: { results } } };
  } catch { return { status: 500 }; } finally { busy.delete(key); }
});
app.on('message', async ctx => {
  const activity = ctx.activity;
  if (!allowedConversation(activity.channelId, activity.channelData?.tenant?.id, activity.conversation.conversationType, config.tenantId)) {
    await ctx.send('This pilot is available only in a private askBICS chat in the configured organisation.');
    return;
  }
  const question = (activity.text || '').trim();
  if (/^\/?signout$/i.test(question)) { visualSessions.delete(`${config.tenantId}:${activity.from.id}`); await powerbi.signOut(ctx); await ctx.send('Signed out.'); return; }
  if (/^\/?signin$/i.test(question)) { if (await powerbi.signIn(ctx)) await ctx.send('You are signed in. Ask a question.'); return; }
  const key = `${config.tenantId}:${activity.from.id}`;
  if (busy.has(key)) { await ctx.send('Your previous question is still running. Please wait for its answer.'); return; }
  busy.add(key);
  try {
    const data = activity.value as Record<string, unknown> | undefined;
    const token = await powerbi.signIn(ctx);
    if (!token) return;
    const identity = chatIdentity(config.tenantId, activity.from.aadObjectId);
    const model = await selectedModel(storage, identity, config.model);
    if (/^\/?(?:ask|suggestions|build)$/i.test(question)) { await ctx.send(new MessageActivity().addAttachments({ contentType: 'application/vnd.microsoft.card.adaptive', content: guidedCard(model) })); return; }
    if (/^\/?(?:help|hello|hi|start)$/i.test(question)) { await ctx.send(`Welcome to askBICS. Source: ${model.name}.\n\n${examples(model).join('\n\n')}\n\nChoose data in Ask to change the model for Ask and personal Chat.`); return; }
    await ctx.send({ type: 'typing' });
    let card;
    if (data?.action === 'guidedAsk') {
      if (data.datasetId !== model.datasetId) throw new UserError('Your model changed. Type /ask to get a fresh question card.');
      card = answerCard(await queryPowerBi(model, guidedPlan(data, model), token));
    }
    else {
      for (const [id, value] of visualSessions) if (value.expires < Date.now()) visualSessions.delete(id);
      let cached = visualSessions.get(key);
      if (!cached || cached.token !== token || cached.modelKey !== JSON.stringify(model)) {
        if (visualSessions.size >= 100) visualSessions.delete(visualSessions.keys().next().value!);
        cached = { token, modelKey: JSON.stringify(model), expires: Date.now() + 30 * 60_000, session: visualSession(model, token) }; visualSessions.set(key, cached);
      }
      const answer = await cached.session.answer(question);
      const handoff = randomBytes(24).toString('hex');
      await storage!.write(`${identity}:handoff:${handoff}`, { datasetId: model.datasetId, question, expires: Date.now() + 15 * 24 * 3600000 });
      card = visualAnswerCard(answer, model.name, config.clientId, handoff);
    }
    await ctx.send(new MessageActivity().addAttachments({ contentType: 'application/vnd.microsoft.card.adaptive', content: card }));
  } catch (error) {
    // Never send/log provider payloads, raw queries, credentials or stack traces.
    await ctx.send(error instanceof UserError ? error.message : 'The request could not complete. Please try again or contact your askBICS administrator.');
  } finally { busy.delete(key); }
});
await app.initialize();
await new Promise<void>((resolve, reject) => {
  const server = web.listen(config.port, () => { console.log(`askBICS bot and Ask tab listening on port ${config.port}`); resolve(); });
  server.once('error', reject);
});
