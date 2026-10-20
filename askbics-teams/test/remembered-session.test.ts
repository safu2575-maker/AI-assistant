import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import express from 'express';
import { RememberedSessions, REMEMBER_MS, SignInRequired } from '../src/remembered-session.js';
import { ReportState } from '../src/report-state.js';
import { mountTab } from '../src/tab.js';
import { demoModel } from '../src/model.js';
const config = { clientId: 'client', clientSecret: 'private-client-secret', tenantId: 'tenant' };
test('remembered sign-in survives restart, rotates refresh tokens once and expires absolutely at 15 days', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'askbics-session-test-')); let now = 1000000, calls = 0;
  const key = randomBytes(32), store = new ReportState(key, dir);
  const fetcher = (async (_url, init) => {
    calls++; assert.equal(new URLSearchParams(String(init?.body)).get('grant_type'), 'refresh_token');
    assert.equal(new URLSearchParams(String(init?.body)).get('refresh_token'), calls === 1 ? 'refresh-one' : 'refresh-two');
    return Response.json({ access_token: 'access-two', refresh_token: 'refresh-two', expires_in: 3600 });
  }) as typeof fetch;
  try {
    const original = new RememberedSessions(store, config, fetcher, () => now);
    const device = await original.create('tenant:alice', 'access-one', 'refresh-one', now + 3600000);
    assert.equal(device.expires, now + REMEMBER_MS);
    const contents = await readFile(join(dir, (await readdir(dir))[0]));
    assert.equal(contents.includes(Buffer.from('refresh-one')), false); assert.equal(contents.includes(Buffer.from(device.secret)), false);
    const restarted = new RememberedSessions(new ReportState(key, dir), config, fetcher, () => now);
    assert.equal((await restarted.get(device.secret)).identity, 'tenant:alice'); assert.equal(calls, 0);
    now += 3590000;
    const results = await Promise.all([restarted.get(device.secret), restarted.get(device.secret)]);
    assert.equal(calls, 1); assert.ok(results.every(r => r.token === 'access-two')); assert.equal(results[0].expires, device.expires);
    now = device.expires;
    await assert.rejects(restarted.get(device.secret), SignInRequired); assert.equal(calls, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('revocation and Microsoft interaction_required end remembered access; transient errors preserve it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'askbics-session-test-')); let status = 503;
  const fetcher = (async () => Response.json({ error: status === 400 ? 'invalid_grant' : 'temporarily_unavailable' }, { status })) as typeof fetch;
  const vault = new RememberedSessions(new ReportState(randomBytes(32), dir), config, fetcher);
  try {
    const device = await vault.create('tenant:alice', 'token', 'refresh', Date.now()-1);
    await assert.rejects(vault.get(device.secret), e => !(e instanceof SignInRequired));
    status = 400; await assert.rejects(vault.get(device.secret), SignInRequired);
    const next = await vault.create('tenant:alice', 'token', 'refresh', Date.now()+3600000);
    await vault.revoke(next.secret); await assert.rejects(vault.get(next.secret), SignInRequired);
    await assert.rejects(vault.get('../other'), SignInRequired);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('auth endpoints restore after server restart and sign-out revokes every session from that device', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'askbics-auth-test-')), previous = process.env.STATE_KEY;
  process.env.STATE_KEY = randomBytes(32).toString('hex'); let nonce = '';
  const fetcher = (async () => Response.json({ access_token: 'private-access', refresh_token: 'private-refresh', expires_in: 3600, id_token: `h.${Buffer.from(JSON.stringify({ tid: 'tenant', aud: 'client', oid: 'alice', nonce, iss: 'https://login.microsoftonline.com/tenant/v2.0', exp: Date.now()/1000+3600 })).toString('base64url')}.s` })) as typeof fetch;
  const instances: any[] = [];
  const boot = async () => {
    const app = express(); const state = mountTab(app, { ...config, model: { ...demoModel, datasetId: '11111111-1111-1111-1111-111111111111' } }, 'https://test.example', fetcher, dir);
    const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r)); instances.push(server);
    const url = `http://127.0.0.1:${(server.address() as any).port}`;
    const post = (path: string, body = {}, token = '') => fetch(`${url}/ask/api/${path}`, { method: 'POST', headers: { Origin: 'https://test.example', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    return { post, url, state };
  };
  try {
    const first = await boot();
    const auth = await (await first.post('login', { remember: true })).json() as any; nonce = auth.state;
    const authorize = await fetch(`${first.url}/ask/auth/authorize?state=${nonce}`, { redirect: 'manual' }); assert.match(authorize.headers.get('location')!, /offline_access/);
    await fetch(`${first.url}/ask/auth/callback?state=${nonce}&code=test`, { redirect: 'manual' });
    const login = await (await first.post('login-result', auth)).json() as any;
    assert.ok(login.remembered.secret); assert.ok(!JSON.stringify(login).includes('private-'));
    const second = await boot();
    const resumed = await (await second.post('resume', { secret: login.remembered.secret })).json() as any;
    assert.ok(resumed.session); assert.equal((await second.post('model', {}, resumed.session)).status, 200);
    const other = await (await second.post('resume', { secret: login.remembered.secret })).json() as any;
    assert.equal((await second.post('signout', {}, resumed.session)).status, 200);
    assert.equal((await second.post('model', {}, other.session)).status, 401);
    assert.equal((await second.post('resume', { secret: login.remembered.secret })).status, 401);
  } finally { for (const server of instances) { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); } await rm(dir,{recursive:true,force:true}); if (previous) process.env.STATE_KEY = previous; else delete process.env.STATE_KEY; }
});
