import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoModel, planQuestion, buildDax, UserError } from '../src/model.js';
import { demoAnswer } from '../src/demo-data.js';
import { queryPowerBi } from '../src/powerbi.js';
import { allowedConversation } from '../src/config.js';
import { answerCard } from '../src/cards.js';
import { createDemoServer } from '../src/demo.js';

test('total is evaluated at total context; grouped questions use configured columns', () => {
  const total = buildDax(planQuestion('Show total Work items in 2025', demoModel), demoModel);
  assert.equal(total, 'EVALUATE ROW("Value", CALCULATE([Work Item Count], TREATAS({2025}, \'Calendar\'[Year])))');
  const grouped = buildDax(planQuestion('Show Work items by Team', demoModel), demoModel);
  assert.match(grouped, /TOPN\(11,/); assert.match(grouped, /SUMMARIZECOLUMNS\('Teams'\[Name\]/);
});
test('aliases resolve and ranking remains bounded', () => {
  assert.equal(planQuestion('top 2 teams by items in 2025', demoModel).top, 2);
  for (const q of ['top 0 Team by items', 'top 999 Team by items']) assert.throws(() => planQuestion(q, demoModel), UserError);
});
test('unsupported filters, missing fields and arbitrary DAX never become queries', () => {
  for (const q of ['EVALUATE Customers', 'Show total Work items for secret team', 'Show Sales by Rent', 'Compare with last year', '']) {
    assert.throws(() => planQuestion(q, demoModel), UserError);
  }
  assert.throws(() => planQuestion('Show total items in 2025', { ...demoModel, year: undefined }), UserError);
});
test('model identifiers are escaped', () => {
  const model = { ...demoModel, measures: [{ name: 'Items', modelName: 'A]B' }] };
  assert.match(buildDax(planQuestion('total Items', model), model), /\[A\]\]B\]/);
});
test('demo has deterministic totals and year filtering', () => {
  assert.deepEqual(demoAnswer('total items').rows, [[4280]]);
  assert.deepEqual(demoAnswer('total items in 2025').rows, [[2420]]);
  assert.deepEqual(demoAnswer('top 2 Team by items in 2025').rows, [['Customer support', 1040], ['Operations', 760]]);
  assert.equal(demoAnswer('total items').demo, true);
});
test('private chat and tenant checks fail closed', () => {
  assert.equal(allowedConversation('msteams', 'tenant', 'personal', 'tenant'), true);
  assert.equal(allowedConversation('msteams', 'other', 'personal', 'tenant'), false);
  assert.equal(allowedConversation('msteams', 'tenant', 'channel', 'tenant'), false);
  assert.equal(allowedConversation('emulator', 'tenant', 'personal', 'tenant'), false);
  assert.equal(allowedConversation('msteams', undefined, 'personal', 'tenant'), false);
});
const model = { ...demoModel, datasetId: '12345678-1234-1234-1234-123456789abc' };
const plan = planQuestion('Show items by Team', model);
const fakeFetch = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
test('missing identity cannot reach Power BI', async () => {
  let called = false;
  await assert.rejects(queryPowerBi(model, plan, '', (async () => { called = true; return new Response(); }) as typeof fetch));
  assert.equal(called, false);
});
test('delegated token is sent only to the configured Power BI endpoint', async () => {
  const request = (async (url, init) => {
    assert.equal(url, `https://api.powerbi.com/v1.0/myorg/datasets/${model.datasetId}/executeQueries`);
    assert.equal((init?.headers as Record<string,string>).Authorization, 'Bearer test-token');
    assert.ok(!String(init?.body).includes('impersonatedUserName'));
    return new Response(JSON.stringify({ results: [{ tables: [{ rows: [{ '[Category]': 'A', '[Value]': 0 }] }] }] }));
  }) as typeof fetch;
  const answer = await queryPowerBi(model, plan, 'test-token', request);
  assert.deepEqual(answer.rows, [['A', 0]]); assert.equal(answer.demo, false);
});
test('HTTP 200 with errors or partial result is rejected', async () => {
  for (const payload of [{ error: {} }, { results: [{ error: {} }] }, { results: [{ tables: [{ error: {}, rows: [] }] }] }, {}]) {
    await assert.rejects(queryPowerBi(model, plan, 'test', fakeFetch(payload)), UserError);
  }
});
test('permission, sign-in and rate-limit errors are safe and useful', async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(queryPowerBi(model, plan, 'test', fakeFetch({ secret: 'never-display' }, status)), error => error instanceof UserError && !error.message.includes('never-display'));
  }
});
test('large breakdowns disclose the row limit and preserve blanks', async () => {
  const rows = Array.from({ length: 11 }, (_, i) => ({ '[Category]': `Team ${i}`, '[Value]': i ? i : null }));
  const answer = await queryPowerBi(model, plan, 'test', fakeFetch({ results: [{ tables: [{ rows }] }] }));
  assert.equal(answer.rows.length, 10); assert.equal(answer.rows[0][1], null); assert.match(answer.context, /more categories/);
  assert.equal(answerCard(answer).version, '1.4');
});
test('demo HTTP endpoint is local, origin-checked, and serves working questions', async () => {
  const server = createDemoServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number }; const origin = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(origin)).status, 200);
    assert.equal((await fetch(`${origin}/api/demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    const result = await fetch(`${origin}/api/demo`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'total items' }) });
    assert.equal(result.status, 200); assert.deepEqual((await result.json()).rows, [[4280]]);
    assert.equal((await fetch(`${origin}/api/messages`, { method: 'POST' })).status, 404);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
