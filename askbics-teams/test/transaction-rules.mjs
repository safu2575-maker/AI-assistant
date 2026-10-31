import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {model,fixture} from './visual-fixture.mjs';
const {ModelSession}=createRequire(import.meta.url)('../dist/visual-server.cjs');
const f=fixture(),session=new ModelSession(model,'fixture-token',f.fetcher);
const settings={alwaysFilter:{field:'Year',values:['2026']},customKpis:[{id:'ratio',name:'Rent ratio',formula:'DIVIDE([Rent Measure], [Sales Measure])',format:'percentage',decimals:2,enabled:true}],analysis:{draft:{transactionFields:['Assigned Tenant Name'],transactionRule:{name:'Exclude large rent',enabled:true,keyField:'Assigned Tenant Name',formula:'[Rent Measure] > 300'}}}};
const question=view=>';transactions:'+encodeURIComponent(JSON.stringify([{question:'Show Rent ratio',transactionRuleView:view}]));
for(const [view,names,total] of [['included',['Bright Home','Home Living'],12.5],['excluded',['Style'],400/90],['all',['Bright Home','Home Living','Style'],900/(170/3)]]){
 const answer=await session.answer(question(view),settings);
 assert(answer.table,JSON.stringify(answer));assert.deepEqual(answer.table.rows.map(r=>r[0]).sort(),names);assert.equal(answer.table.modelRawTotals[1],total);assert.equal(answer.transactionRule.view,view);
 if(view==='all')assert.deepEqual(answer.table.transactionExcludedRows.map(i=>answer.table.rows[i][0]),['Style']);
}
assert(f.queries.every(q=>q.includes("'Retail'[Year]")),'Always filters must reach rule probes, details, and totals');
console.log('Teams transaction rules: measure predicates, hidden dependencies, custom ratio model totals, All-row highlighting and Always filters passed.');
