import express, { Request, Response } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Model, UserError, guidedPlan, planQuestion } from './model.js';
import { queryPowerBi, searchValues } from './powerbi.js';
import { visualSession, VisualSession } from './visual-service.js';
import { ReportState } from './report-state.js';
import { RememberedSessions, SignInRequired } from './remembered-session.js';
import { selectedModel } from './selected-model.js';
import { ConnectionBook, Connection, workspaces, datasets, discover, validateConnection, verifyConnection } from './connections.js';

type Config = { clientId: string; tenantId: string; clientSecret: string; model: Model };
type Pending = { verifier: string; proof: string; expires: number; session?: string; remember?: boolean; remembered?: { secret: string; expires: number }; failed?: boolean };
type Session = { token: string; expires: number; busy: boolean; lastSearch: number; userKey: string; identity: string; model: Model; device?: string; connectionBusy?: boolean; visual?: VisualSession; queue?: Promise<unknown>; queued?: number };
const random = () => randomBytes(32).toString('base64url');
export function tabOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('TAB_ORIGIN must be an HTTPS origin without a path.');
  return url.origin;
}
/** Cookie-free, short-lived pilot sessions. No browser receives the Power BI token. */
export function mountTab(server: express.Express, config: Config, origin: string, fetcher: typeof fetch = fetch, stateDirectory?: string) {
  origin = tabOrigin(origin);
  const pending = new Map<string, Pending>();
  const sessions = new Map<string, Session>();
  const storage = process.env.STATE_KEY ? new ReportState(Buffer.from(process.env.STATE_KEY, 'hex'), stateDirectory) : undefined;
  const remembered = storage ? new RememberedSessions(storage, config, fetcher) : undefined;
  const cleanup = () => {
    const now = Date.now();
    for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
    for (const [k, v] of sessions) if (v.expires < now) sessions.delete(k);
  };
  server.use('/ask', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors https://teams.microsoft.com https://*.teams.microsoft.com https://*.cloud.microsoft https://outlook.office.com https://outlook.office365.com; base-uri 'none'; object-src 'none'");
    next();
  });
  server.use('/ask/api', express.json({ limit: '512kb' }), (req, res, next) => {
    cleanup();
    if (req.method !== 'POST' || req.headers.origin !== origin || !req.is('application/json')) { res.status(403).json({ error: 'Open the Ask tab from the configured Teams app.' }); return; }
    next();
  });
  const failure = (res: Response, error: unknown) => res.status(error instanceof UserError ? 400 : 502).json({ error: error instanceof UserError ? error.message : 'The request could not complete. Please retry or contact your administrator.' });
  server.post('/ask/api/login', (req, res) => {
    if (pending.size >= 100) { res.status(429).json({ error: 'Too many sign-in attempts. Try again shortly.' }); return; }
    const state = random(), proof = random(), verifier = random();
    pending.set(state, { verifier, proof, remember: req.body?.remember === true, expires: Date.now() + 5 * 60_000 });
    res.json({ state, proof, url: `${origin}/ask/auth/start?state=${state}` });
  });
  server.get('/ask/auth/start', (req, res) => {
    cleanup();
    if (!pending.has(String(req.query.state || ''))) { res.status(400).send('Sign-in expired. Close this window and try again.'); return; }
    res.sendFile(resolve('tab/auth-start.html'));
  });
  server.get('/ask/auth/authorize', (req, res) => {
    cleanup();
    const state = String(req.query.state || ''), p = pending.get(state);
    if (!p) { res.status(400).send('Sign-in expired. Close this window and try again.'); return; }
    const params = new URLSearchParams({ client_id: config.clientId, response_type: 'code', redirect_uri: `${origin}/ask/auth/callback`, response_mode: 'query', scope: 'openid profile offline_access https://analysis.windows.net/powerbi/api/Dataset.Read.All https://analysis.windows.net/powerbi/api/Workspace.Read.All', state, nonce: state, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(p.verifier).digest('base64url'), prompt: 'select_account' });
    res.redirect(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/authorize?${params}`);
  });
  server.get('/ask/auth/callback', async (req, res) => {
    cleanup();
    const state = String(req.query.state || ''), p = pending.get(state);
    if (!p || !p.verifier) { res.status(400).send('Invalid or expired sign-in. Close this window and retry.'); return; }
    const verifier = p.verifier; p.verifier = '';
    try {
      if (!req.query.code || req.query.error) throw new Error('Sign-in declined');
      const result = await fetcher(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: `${origin}/ask/auth/callback`, code_verifier: verifier }), signal: AbortSignal.timeout(20_000) });
      const data = await result.json() as { access_token?: string; expires_in?: number; id_token?: string; refresh_token?: string };
      if (!result.ok || !data.access_token || !Number.isFinite(data.expires_in)) throw new Error('Token exchange failed');
      // Identity comes only from Entra's token endpoint after single-use code + PKCE exchange.
      const claims = JSON.parse(Buffer.from(data.id_token?.split('.')[1] || '', 'base64url').toString('utf8'));
      if (claims.tid !== config.tenantId || claims.aud !== config.clientId || claims.nonce !== state || claims.iss !== `https://login.microsoftonline.com/${config.tenantId}/v2.0` || !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000 || typeof claims.oid !== 'string' || !claims.oid) throw new Error('Wrong sign-in identity');
      if (sessions.size >= 100) throw new Error('Session capacity');
      const id = random();
      sessions.set(id, { token: data.access_token, expires: Date.now() + Math.min(Number(data.expires_in) - 60, 3600) * 1000, busy: false, lastSearch: 0, identity: `${claims.tid}:${claims.oid}`, model: config.model, userKey: `${claims.tid}:${claims.oid}:${config.model.datasetId}` });
      if (p.remember && remembered && data.refresh_token) {
        p.remembered = await remembered.create(`${claims.tid}:${claims.oid}`, data.access_token, data.refresh_token, Date.now() + Number(data.expires_in) * 1000);
        sessions.get(id)!.device = p.remembered.secret;
      }
      p.session = id;
    } catch { p.failed = true; }
    res.redirect('/ask/auth-complete.html');
  });
  server.post('/ask/api/login-result', (req, res) => {
    const p = pending.get(req.body?.state);
    if (!p || p.proof !== req.body?.proof) { res.status(401).json({ error: 'Sign-in expired. Please retry.' }); return; }
    if (p.failed) { pending.delete(req.body.state); res.status(401).json({ error: 'Sign-in failed. Check the tab redirect URL in Entra ID and try again.' }); return; }
    if (!p.session) { res.status(202).json({ pending: true }); return; }
    const session = p.session; pending.delete(req.body.state); res.json({ session, remembered: p.remembered, expires: sessions.get(session)?.expires });
  });
  server.post('/ask/api/resume', async (req, res) => {
    try {
      if (!remembered) throw new SignInRequired('Sign in again to continue.');
      const account = await remembered.get(req.body?.secret);
      if (sessions.size >= 100) { res.status(429).json({ error: 'Too many open sessions. Try again shortly.' }); return; }
      const selected = await selectedModel(storage, account.identity, config.model);
      const id = random(), expires = Math.min(account.expires, Date.now() + 3600000);
      sessions.set(id, { token: account.token, expires, device: req.body.secret, identity: account.identity, model: selected, userKey: `${account.identity}:${selected.datasetId}`, busy: false, lastSearch: 0 });
      res.json({ session: id, expires, rememberedUntil: account.expires });
    } catch (e) { res.status(e instanceof SignInRequired ? 401 : 503).json({ error: e instanceof SignInRequired ? e.message : 'Could not restore sign-in. Check your connection and retry.' }); }
  });
  server.use('/ask/api', async (req, res, next) => {
    if (req.path === '/signout') { next(); return; }
    const s = sessions.get(req.headers.authorization?.replace(/^Bearer /, '') || '');
    if (!s?.device || !remembered) { next(); return; }
    try {
      const account = await remembered.get(s.device);
      if (s.token !== account.token) { s.token = account.token; s.visual = undefined; }
      s.expires = Math.min(account.expires, Date.now() + 3600000);
      next();
    } catch (e) {
      if (e instanceof SignInRequired) { sessions.delete(req.headers.authorization?.replace(/^Bearer /, '') || ''); res.status(401).json({ error: e.message }); }
      else res.status(503).json({ error: 'Could not renew Microsoft sign-in. Please retry.' });
    }
  });
  const authorised = (req: Request, res: Response): Session | undefined => {
    const id = req.headers.authorization?.replace(/^Bearer /, '') || '';
    const session = sessions.get(id);
    if (!session || session.expires <= Date.now()) { res.status(401).json({ error: 'Sign in to the Ask tab to continue.' }); return; }
    return session;
  };
  const book = async (s: Session): Promise<ConnectionBook> => {
    if (!storage) throw new UserError('Saved connections need the server STATE_KEY configuration.');
    return (await storage.read(`${s.identity}:connections`) as ConnectionBook) || { models: [] };
  };
  // All mutations serialize across the user's sessions, avoiding lost saved connections.
  const locks = new Map<string, Promise<unknown>>();
  server.use('/ask/api', async (req, res, next) => {
    if (!['/visual-query', '/dictionary', '/values', '/query'].includes(req.path)) { next(); return; }
    const s = authorised(req, res); if (!s) return;
    try {
      const chosen = storage ? await selectedModel(storage, s.identity, config.model) : s.model;
      if (JSON.stringify(chosen) !== JSON.stringify(s.model)) { res.status(409).json({ error: 'Your active model changed in another window. Reload Ask to use the selected model.' }); return; }
      next();
    } catch (e) { failure(res, e); }
  });
  server.post('/ask/api/handoff', async (req, res) => {
    const s = authorised(req, res); if (!s) return;
    try {
      if (!/^[a-f0-9]{48}$/.test(req.body.id || '')) throw new UserError('This answer link is invalid.');
      const handoff = await storage?.read(`${s.identity}:handoff:${req.body.id}`) as { datasetId: string; question: string; expires: number } | null;
      if (!handoff || handoff.expires < Date.now()) throw new UserError('This answer link expired or belongs to another account. Ask the question again.');
      const saved = await book(s);
      const chosen = saved.models.find(m => m.datasetId === handoff.datasetId) || (handoff.datasetId === config.model.datasetId ? config.model : undefined);
      if (!chosen) throw new UserError('This answer’s connection was removed. Reconnect the model first.');
      await verifyConnection(chosen, s.token, fetcher);
      res.json(handoff);
    } catch (e) { failure(res, e); }
  });
  for (const action of ['connections', 'workspaces', 'datasets', 'discover', 'connect', 'select-connection', 'disconnect']) {
    server.post(`/ask/api/${action}`, async (req, res) => {
      const s = authorised(req, res); if (!s) return;
      if (s.connectionBusy || s.busy || s.queued) { res.status(409).json({ error: 'Wait for the current question or connection request to finish.' }); return; }
      s.connectionBusy = true;
      const operation = (locks.get(s.identity) || Promise.resolve()).catch(() => {}).then(async () => {
        if (s.expires <= Date.now() || ![...sessions.values()].includes(s)) throw new UserError('Sign in again to continue.');
        if (action === 'workspaces') return { workspaces: await workspaces(s.token, fetcher) };
        if (action === 'datasets') return { models: await datasets(req.body.workspaceId, s.token, fetcher) };
        if (action === 'discover') return { model: await discover(req.body.workspaceId, req.body.datasetId, s.token, fetcher) };
        const saved = await book(s);
        if (action === 'connections') return { selected: s.model.datasetId, lastSelected: saved.selected, connections: [{ datasetId: config.model.datasetId, name: config.model.name, sample: true }, ...saved.models.filter(m => m.datasetId !== config.model.datasetId).map(m => ({ datasetId: m.datasetId, name: m.name }))] };
        if (action === 'disconnect') {
          if (req.body.datasetId === config.model.datasetId) throw new UserError('The sample connection cannot be removed.');
          saved.models = saved.models.filter(m => m.datasetId !== req.body.datasetId);
          if (saved.selected === req.body.datasetId) throw new UserError('Switch to another connection before removing the active model.');
          await storage!.write(`${s.identity}:connections`, saved);
          if (s.model.datasetId === req.body.datasetId) { s.model = config.model; s.visual = undefined; s.userKey = `${s.identity}:${s.model.datasetId}`; }
          return { ok: true };
        }
        let chosen: Model;
        if (action === 'connect') {
          chosen = validateConnection(req.body.model);
          if (saved.models.length >= 20 && !saved.models.some(m => m.datasetId === chosen.datasetId)) throw new UserError('You can save up to 20 connections. Remove an unused connection first.');
        } else {
          chosen = saved.models.find(m => m.datasetId === req.body.datasetId) || (req.body.datasetId === config.model.datasetId ? config.model : undefined)!;
          if (!chosen) throw new UserError('Choose one of your saved connections.');
        }
        await verifyConnection(chosen, s.token, fetcher);
        if (action === 'connect') saved.models = [...saved.models.filter(m => m.datasetId !== chosen.datasetId), chosen as Connection];
        saved.selected = chosen.datasetId;
        await storage!.write(`${s.identity}:connections`, saved);
        s.model = chosen; s.visual = undefined; s.userKey = `${s.identity}:${chosen.datasetId}`;
        return { ok: true, name: chosen.name };
      });
      locks.set(s.identity, operation);
      try { res.json(await operation); } catch (e) { failure(res, e); } finally { s.connectionBusy = false; if (locks.get(s.identity) === operation) locks.delete(s.identity); }
    });
  }
  server.post('/ask/api/signout', async (req, res) => {
    const id = req.headers.authorization?.replace(/^Bearer /, '') || '';
    const device = sessions.get(id)?.device || req.body?.secret;
    try {
      if (device && remembered) await remembered.revoke(device);
      for (const [key, value] of sessions) if (key === id || (device && value.device === device)) sessions.delete(key);
      res.json({ ok: true });
    } catch { res.status(503).json({ error: 'Sign-out could not complete. Please retry.' }); }
  });
  server.post('/ask/api/model', async (req, res) => {
    const s = authorised(req, res); if (!s) return;
    try {
      const chosen = storage ? await selectedModel(storage, s.identity, config.model) : s.model;
      if (JSON.stringify(chosen) !== JSON.stringify(s.model)) { s.model = chosen; s.visual = undefined; s.userKey = `${s.identity}:${chosen.datasetId}`; }
    } catch (e) { failure(res, e); return; }
    res.json({ datasetId: s.model.datasetId, name: s.model.name, measures: s.model.measures.map(m => ({ name: m.name, aliases: m.aliases, formatString: m.formatString })), dimensions: s.model.dimensions.map(d => ({ name: d.name, aliases: d.aliases, type: d.type, numeric: d.numeric || (d.table === s.model.year?.table && d.column === s.model.year.column) })), time: s.model.time || {}, hasYear: !!s.model.year });
  });
  server.post('/ask/api/state', async (req, res) => {
    const s = authorised(req, res); if (!s) return;
    try {
      if (req.body.datasetId && req.body.datasetId !== s.model.datasetId) throw new UserError('The selected model changed. Reopen the Ask tab.');
      if (!storage) { res.status(503).json({ error: 'Saved reports need the server STATE_KEY configuration.' }); return; }
      if (req.body.state !== undefined) {
        if (!req.body.state || Array.isArray(req.body.state) || typeof req.body.state !== 'object') throw new UserError('Invalid saved settings.');
        await storage.write(s.userKey, req.body.state); res.json({ ok: true });
      } else res.json({ state: await storage.read(s.userKey) });
    } catch (e) { failure(res, e); }
  });
  for (const path of ['dictionary', 'visual-query']) server.post(`/ask/api/${path}`, async (req, res) => {
    const s = authorised(req, res); if (!s) return;
    if (s.connectionBusy) { res.status(409).json({ error: 'Wait for the connection change.' }); return; }
    if (req.body.datasetId && req.body.datasetId !== s.model.datasetId) { res.status(409).json({ error: 'The selected model changed. Reopen the Ask tab.' }); return; }
    if ((s.queued || 0) >= 24) { res.status(429).json({ error: 'Too many pending questions. Wait for current answers.' }); return; }
    s.queued = (s.queued || 0) + 1;
    const operation = (s.queue || Promise.resolve()).then(async () => {
      if (s.expires <= Date.now() || ![...sessions.values()].includes(s)) throw new UserError('Sign in again to continue.');
      s.visual ||= visualSession(s.model, s.token, fetcher);
      return path === 'dictionary' ? s.visual.dictionary(req.body.field) : s.visual.answer(req.body.question, req.body.settings, req.body.time, req.body.refresh === true, req.body.selections);
    });
    s.queue = operation.catch(() => {});
    try { res.json(await operation); } catch (e) { failure(res, e); } finally { s.queued = (s.queued || 1) - 1; }
  });
  server.post('/ask/api/values', async (req, res) => {
    const s = authorised(req, res); if (!s) return;
    if (s.connectionBusy || s.busy || Date.now() - s.lastSearch < 300) { res.status(429).json({ error: 'Please wait briefly before searching again.' }); return; }
    s.lastSearch = Date.now(); s.busy = true;
    try { res.json(await searchValues(s.model, req.body.field, req.body.search, s.token, fetcher)); } catch (e) { failure(res, e); } finally { s.busy = false; }
  });
  server.post('/ask/api/query', async (req, res) => {
    const s = authorised(req, res); if (!s) return;
    if (s.connectionBusy || s.busy) { res.status(429).json({ error: 'Please wait for the current request.' }); return; }
    s.busy = true;
    try {
      const plan = typeof req.body.question === 'string' ? planQuestion(req.body.question, s.model) : guidedPlan(req.body, s.model);
      res.json(await queryPowerBi(s.model, plan, s.token, fetcher));
    } catch (e) { failure(res, e); } finally { s.busy = false; }
  });
  server.get('/ask/teams.js', (_req, res) => res.sendFile(resolve('node_modules/@microsoft/teams-js/dist/umd/MicrosoftTeams.min.js')));
  server.use('/ask', express.static(resolve('tab'), { index: 'index.html', dotfiles: 'deny' }));
  return { pending, sessions }; // Enables isolated tests; never exposed via HTTP.
}
