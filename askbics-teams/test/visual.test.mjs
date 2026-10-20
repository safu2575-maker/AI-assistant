import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReportState } from '../dist/src/report-state.js';
import { visualSession } from '../dist/src/visual-service.js';
import { UserError } from '../dist/src/model.js';
import { model, fixture } from './visual-fixture.mjs';
const {ModelSession} = createRequire(import.meta.url)('../dist/visual-server.cjs');
const service = () => {const f=fixture(); return {...f, session:new ModelSession(model,'fixture-token',f.fetcher)};};
test('original parser answers bare measure and the exact screenshot question',async()=>{
 const {session,queries}=service();
 assert.equal((await session.answer('rent measure')).kpi.value,'1,000');
 const answer=await session.answer('show Home Living by Year Rent Measure');
 assert.deepEqual(answer.table.rows,[['2025','100'],['2026','200']]);
 assert.equal(answer.table.modelTotals.at(-1),'300');
 assert.ok(queries.some(q=>q.includes('TREATAS({"Home Living"}')));
});
test('matrix marginal totals are model evaluations, including non-additive measures',async()=>{
 const {session,queries}=service();
 const answer=await session.answer('Matrix; rows: Assigned Group; columns: City; values: Sales Measure');
 assert.ok(answer.table.modelPivot);
 const furniture=answer.table.rows.find(r=>r[0]==='Furniture');
 assert.equal(furniture.at(-1),'30'); // average(10,20,60), never sum of cell averages
 assert.equal(answer.table.modelTotals.at(-1),'45');
 assert.ok(queries.filter(q=>q.includes('SUMMARIZECOLUMNS')).length>=3);
});
test('rows-only matrix returns model-evaluated hierarchy subtotals',async()=>{
 const {session}=service(); const a=await session.answer('Matrix; rows: Assigned Group > City; columns: ; values: Sales Measure');
 assert.ok(a.table.matrix); assert.ok(a.table.rows.some(r=>r[0]==='Furniture'&&r[1]==='30'));
});
test('charts retain raw numeric values and ranking removes full-model total',async()=>{
 const {session}=service(); const a=await session.answer('show Rent Measure by City as bar chart');
 assert.equal(a.chart.type,'bar'); assert.deepEqual(a.chart.values,[700,300]);
 const ranked=await session.answer('top 1 City by Rent Measure'); assert.equal(ranked.table.rows.length,1); assert.equal(ranked.table.modelTotals,undefined);
});
test('unmapped targets and unsupported questions fail without executing arbitrary DAX',async()=>{
 const {fetcher,queries}=fixture(); const session=visualSession(model,'fixture-token',fetcher);
 await assert.rejects(session.answer('EVALUATE SecretTable'),UserError);
 assert.ok(!queries.some(q=>q.includes('SecretTable')));
 await assert.rejects(session.dictionary('SecretTable'),UserError);
});
test('saved reports survive restart, remain per-user and reject tampering',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'askbics-state-')); const key=Buffer.alloc(32,7);
 try { const store=new ReportState(key,dir); await store.write('tenant:userA:model',{draft:'private question',savedReports:[{name:'Rent'}]});
  assert.equal(await store.read('tenant:userB:model'),null);
  assert.equal((await new ReportState(key,dir).read('tenant:userA:model')).draft,'private question');
  const file=join(dir,(await readdir(dir))[0]); const bytes=await readFile(file); assert.ok(!bytes.includes(Buffer.from('private question'))); bytes[30]^=1; await writeFile(file,bytes); await assert.rejects(store.read('tenant:userA:model'));
 } finally { await rm(dir,{recursive:true,force:true}); }
});
test('cross filters are allowlisted, intersect existing predicates, and reach model totals',async()=>{
 const {session,queries}=service();
 const field=model.dimensions.find(d=>d.name==='City');
 await session.answer('Show total Rent Measure',{},undefined,false,[[{table:field.table,column:field.column,value:'East'}]]);
 assert.ok(queries.some(q=>q.includes('CALCULATE(')&&q.includes('KEEPFILTERS(FILTER(')&&q.includes('== "East"')));
 const before=queries.length;
 await assert.rejects(session.answer('Show total Rent Measure',{},undefined,false,[[{table:'Unknown',column:'Secret',value:'x'}]]),/unavailable field/);
 assert.equal(queries.length,before);
 await session.answer('show Home Living by Year Rent Measure',{},undefined,false,[[{table:field.table,column:field.column,value:'East'}]]);
 assert.ok(queries.some(q=>q.includes('TREATAS({"Home Living"}')&&q.includes('KEEPFILTERS(FILTER(')));
});

test('percentage of revenue replaces only the revenue dimension and calculates totals from amounts',async()=>{
 const {session,queries}=service();
 const settings={revenue:{field:'Assigned Group',value:'Furniture'}};
 const answer=await session.answer('Rent Measure by Assigned Group as percentage of revenue',settings);
 assert.ok(answer.table.rows.some(r=>r[0]==='Furniture'&&r[1]==='100.00%'));
 assert.ok(answer.table.rows.some(r=>r[0]==='Fashion'&&r[1]==='66.67%'));
 assert.equal(answer.table.modelTotals.at(-1),'166.67%');
 assert.ok(queries.some(q=>q.includes('TREATAS({"Furniture"}')));
 const filtered=await session.answer('Rent Measure by Assigned Group in 2026 as percentage of revenue',settings);
 assert.equal(filtered.table.modelTotals.at(-1),'180.00%');
 await assert.rejects(session.answer('Rent Measure as percentage of revenue'),/Configure/);
 const missing=await session.answer('Rent Measure as percentage of revenue',{revenue:{field:'Assigned Group',value:'Missing'}});
 assert.equal(missing.kpi.value,'—');
});

test('revenue numerator and denominator retain identical YTD and TTM date windows',async()=>{
 for(const period of ['YTD February 2026','TTM February 2026']) {
  const {fetcher,queries}=fixture(); const session=new ModelSession({...model,dimensions:[...model.dimensions,{name:'MonthIndex',table:'Retail',column:'MonthIndex',type:'number'}],time:{monthIndexField:'MonthIndex',monthIndexBase:1}},'fixture-token',fetcher);
  await session.answer('Rent Measure by Assigned Group '+period+' as percentage of revenue',{revenue:{field:'Assigned Group',value:'Furniture'}});
  const totals=queries.filter(q=>q.startsWith('EVALUATE ROW('));
  const normal=totals.find(q=>!q.includes('TREATAS({"Furniture"}'));
  const revenue=totals.find(q=>q.includes('TREATAS({"Furniture"}'));
  assert.ok(normal&&revenue);
  const dates=q=>q.match(/TREATAS\(\{[^}]+\}, 'Retail'\[MonthIndex\]\)/g);
  assert.ok(dates(normal)?.length); assert.deepEqual(dates(normal),dates(revenue));
 }
});
