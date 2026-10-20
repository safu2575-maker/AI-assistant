// Actual connection routes and UI with synthetic Microsoft/Power BI transport only.
import express from 'express';
import { chromium } from 'playwright-core';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { tableFromArrays, RecordBatchStreamWriter } from 'apache-arrow';
import { mountTab } from '../dist/src/tab.js';
import { model, fixture } from './visual-fixture.mjs';
process.env.STATE_KEY = randomBytes(32).toString('hex');
const directory = await mkdtemp(join(tmpdir(),'askbics-connection-ui-'));
const id = '22222222-2222-2222-2222-222222222222', f = fixture();
let denyDiscovery = false;
const fetcher = async (url, init) => {
  url = String(url);
  assert.equal(init.headers.Authorization, 'Bearer fixture-token');
  if (url.includes('/groups?')) return Response.json({ value: [{ id: '33333333-3333-3333-3333-333333333333', name: 'InfoBICS Finance' }] });
  if (url.endsWith('/datasets')) return Response.json({ value: [{ id, name: 'Manager actual data' }] });
  if (url.endsWith(`/datasets/${id}`)) return Response.json({ id, name: 'Manager actual data' });
  if (url.endsWith('/executeDaxQueries')) {
    if (denyDiscovery) return new Response('', {status:403});
    const rows = [...model.measures.map(m=>({Kind:'measure',Name:m.name,Table:'Retail',Type:'Decimal',Format:'#,0.00'})), ...model.dimensions.map(d=>({Kind:'column',Name:d.name,Table:d.table,Type:d.type,Format:''}))];
    const table = tableFromArrays(Object.fromEntries(Object.keys(rows[0]).map(k=>[k, rows.map(r=>r[k])])));
    return new Response(await RecordBatchStreamWriter.writeAll(table).toUint8Array());
  }
  return f.fetcher(url.replace(id, model.datasetId),init);
};
const app = express(); app.use(express.json());
// The fixture runs on loopback HTTP; production correctly requires its configured HTTPS Origin.
app.use((q,r,next)=>{if(/^http:\/\/127\.0\.0\.1:\d+$/.test(q.headers.origin||''))q.headers.origin='https://test.example';next();});
app.get('/ask/teams.js',(_q,r)=>r.type('js').send('window.microsoftTeams={app:{initialize:async()=>{},notifySuccess:()=>{}},authentication:{authenticate:async()=>{}}};'));
app.post('/ask/api/login',(_q,r)=>r.json({state:'test',proof:'test',url:'about:blank'}));
app.post('/ask/api/login-result',(_q,r)=>r.json({session:'fixture'}));
const state = mountTab(app,{clientId:'client',tenantId:'tenant',clientSecret:'secret',model},'https://test.example',fetcher,directory);
state.sessions.set('fixture',{token:'fixture-token',identity:'tenant:manager',model,userKey:`tenant:manager:${model.datasetId}`,expires:Date.now()+3600000,busy:false,lastSearch:0});
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}), errors=[];
page.on('pageerror',e=>errors.push(e.message));

await mkdir('test-output',{recursive:true});
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/ask/`);
  await page.getByRole('button',{name:'Continue with Microsoft'}).click();
  await page.getByRole('button',{name:'Connect data',exact:true}).click();
  await page.getByRole('button',{name:'Connect another model'}).click();
  await page.getByLabel('Workspace',{exact:true}).selectOption('33333333-3333-3333-3333-333333333333');
  await page.getByLabel('Semantic model',{exact:true}).selectOption(id);
  await page.getByRole('button',{name:'Discover fields'}).click();
  await page.getByRole('heading',{name:'Review your connection'}).waitFor();
  await page.getByText('Review fields and advanced settings',{exact:true}).click();
  await page.getByLabel('Calendar date',{exact:true}).selectOption('Date');
  await page.getByLabel('Year field',{exact:true}).selectOption('Year');
  await page.screenshot({path:'test-output/connection-review.png'});
  await page.getByRole('button',{name:'Test and connect'}).click();
  await page.locator('.askbics-qna__subtitle').filter({hasText:'Manager actual data'}).waitFor();
  assert.equal(state.sessions.get('fixture').model.datasetId,id);
  const input=page.locator('.askbics-qna__input');await input.fill('Show total Rent Measure');await input.press('Escape');await page.locator('.askbics-qna__form button[type=submit]').click();
  await page.locator('.askbics-qna__request-status').waitFor({state:'hidden'});
  await page.screenshot({path:'test-output/connection-answer.png'});
  assert.ok((await page.locator('#visual').innerText()).includes('1,000'));
  await page.getByRole('button',{name:'Connect data',exact:true}).click();
  await page.screenshot({path:'test-output/connections.png'});
  await page.locator('.connection-row').filter({hasText:'Fixture'}).getByRole('button',{name:'Switch to this model'}).click();
  await page.locator('.askbics-qna__subtitle').filter({hasText:'Fixture'}).waitFor();
  assert.equal(state.sessions.get('fixture').model.datasetId,model.datasetId);
  await page.getByRole('button',{name:'Connect data',exact:true}).click();
  await page.getByRole('button',{name:'Connect another model'}).click();
  denyDiscovery=true;
  await page.getByLabel('Power BI model link').fill(`https://app.powerbi.com/groups/me/modeling/${id}/modelView`);
  await page.getByRole('button',{name:'Use model link'}).click();
  await page.getByRole('button',{name:'Enter fields manually'}).click();
  await page.getByRole('button',{name:'Add measure',exact:true}).click();
  await page.getByLabel('Measure display name',{exact:true}).fill('Rent Measure');
  await page.getByLabel('Power BI measure name',{exact:true}).fill('Rent Measure');
  await page.getByRole('button',{name:'Test and connect'}).click();
  await page.locator('.askbics-qna__subtitle').filter({hasText:'My Power BI model'}).waitFor();
  assert.equal(state.sessions.get('fixture').model.datasetId,id);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({errors,connected:true,switched:true,manualFallback:true}));
} catch(e) { console.log(JSON.stringify({errors,body:await page.locator('body').innerText()}));await page.screenshot({path:'test-output/connection-failure.png'});throw e; } finally { await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true}); }
