import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { demoModel, guidedPlan, buildDax, planQuestion } from '../src/model.js';
import { searchValues } from '../src/powerbi.js';
import { mountTab, tabOrigin } from '../src/tab.js';
import { guidedCard } from '../src/guided.js';
const model = { ...demoModel, datasetId: '12345678-1234-1234-1234-123456789abc' };
test('guided filters accept only configured fields and escape DAX values', () => {
  const value = 'A"}), EVALUATE Secrets //';
  const p = guidedPlan({ measure: 'items', dimension: 'Team', filterField: 'Team', filterValue: value, year: '2025' }, model);
  assert.match(buildDax(p, model), /TREATAS\(\{"A""\}\), EVALUATE Secrets \/\/"\}, 'Teams'\[Name\]\)/);
  assert.throws(() => guidedPlan({ measure: 'items', filterField: 'Secret', filterValue: 'x' }, model));
  assert.throws(() => guidedPlan({ measure: 'items', filterField: 'Year', filterValue: '2025 OR 1' }, model));
  assert.throws(() => guidedPlan({ measure: 'items', filterValue: 'orphan' }, model));
  assert.equal(guidedPlan({ measure: 'items', filterField: 'Year', filterValue: '2025' }, model).filter?.value, 2025);
});
test('typed filter grammar matches guided filter semantics', () => {
  const q = 'Show items by Team in 2025 where Team = "A \\"quoted\\" team"';
  const p = planQuestion(q, model);
  assert.equal(p.filter?.value, 'A "quoted" team'); assert.equal(p.year, 2025);
  assert.throws(() => planQuestion('total items where Team = "x" EVALUATE Secret', model));
});
test('value search is user-scoped, bounded and escapes wildcard and string input', async () => {
  let calls = 0;
  const fetcher = (async (_url: unknown, init: RequestInit) => {
    calls++; assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer user-token');
    const dax = JSON.parse(String(init.body)).queries[0].query;
    assert.match(dax, /TOPN\(15/); assert.match(dax, /VALUES\('Teams'\[Name\]\)/); assert.ok(dax.includes('"a""~*~?"'));
    return new Response(JSON.stringify({ results: [{ tables: [{ rows: [{ '[Value]': 'Allowed team' }] }] }] }));
  }) as typeof fetch;
  assert.deepEqual(await searchValues(model, 'Team', 'a"*?', 'user-token', fetcher), [{ title: 'Allowed team', value: 'Allowed team' }]);
  await assert.rejects(searchValues(model, 'Secret', 'a', 'user-token', fetcher));
  await assert.rejects(searchValues(model, 'Team', 'a', '', fetcher)); assert.equal(calls, 1);
});
test('card uses dependent dynamic values and explicit submit action', () => {
  const card = JSON.stringify(guidedCard(model)); assert.ok(card.includes('associatedInputs')); assert.ok(card.includes('Action.ResetInputs')); assert.ok(card.includes('guidedAsk'));
});
test('tab authentication enforces origin, expiry, one-time PKCE and private session redemption', async () => {
  assert.throws(() => tabOrigin('http://example.com')); assert.throws(() => tabOrigin('https://example.com/path'));
  const app = express(); let calls = 0, nonce = '';
  const state = mountTab(app, { clientId: 'client', clientSecret: 'secret', tenantId: 'tenant', model }, 'https://pilot.example', (async (_url, init) => {
    calls++; assert.ok(String(init?.body).includes('code_verifier=')); return new Response(JSON.stringify({ access_token: 'private-powerbi-token', expires_in: 3600, id_token: `header.${Buffer.from(JSON.stringify({ tid: 'tenant', aud: 'client', oid: 'user-one', nonce, iss: 'https://login.microsoftonline.com/tenant/v2.0', exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url')}.signature` }));
  }) as typeof fetch);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const port = (server.address() as { port: number }).port;
  const post = (path: string, body: unknown, token = '', origin = 'https://pilot.example') => fetch(`http://127.0.0.1:${port}/ask/api/${path}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('model', {})).status, 401);
    assert.equal((await post('login', {}, '', 'https://evil.example')).status, 403);
    const login = await (await post('login', {})).json() as { state: string; proof: string };
    nonce = login.state;
    assert.equal((await post('login-result', { state: login.state, proof: 'wrong' })).status, 401);
    const start = await fetch(`http://127.0.0.1:${port}/ask/auth/authorize?state=${login.state}`, { redirect: 'manual' });
    assert.ok(start.headers.get('location')?.includes('code_challenge_method=S256'));
    await fetch(`http://127.0.0.1:${port}/ask/auth/callback?state=${login.state}&code=test`, { redirect: 'manual' });
    const result = await (await post('login-result', login)).json() as { session: string };
    assert.ok(result.session); assert.ok(!JSON.stringify(result).includes('private-powerbi-token'));
    assert.equal((await post('model', {}, result.session)).status, 200);
    assert.equal((await post('login-result', login)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/ask/auth/callback?state=${login.state}&code=test`)).status, 400);
    assert.equal(calls, 1);
    state.sessions.get(result.session)!.expires = Date.now() - 1;
    assert.equal((await post('model', {}, result.session)).status, 401);
    const sdk = await fetch(`http://127.0.0.1:${port}/ask/teams.js`); assert.equal(sdk.status, 200);
    assert.match(sdk.headers.get('content-security-policy') || '', /frame-ancestors/);
  } finally { await new Promise<void>(r => server.close(() => r())); }
});
