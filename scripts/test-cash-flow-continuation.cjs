const assert=require('node:assert/strict');
const {traceCash,traceCashResumable,cashKey}=require('../.tmp/test/cashFlow');
const {loadCashLinks}=require('../.tmp/test/cashFlowLoad');
const p=(document,item,account,amount,clearing='')=>({company:'T',year:'2026',currency:'USD',date:'2026-01-01',document,item,account,amount,clearing,clearingYear:'2026'});
const chain=n=>Array.from({length:n},(_,i)=>[p('D'+i,'1',i?'A'+(i-1):'BANK',-100,i?'C'+(i-1):''),p('D'+i,'2',i===n-1?'END':'A'+i,100,i===n-1?'':'C'+i)]).flat();
const scope=rows=>({company:'T',currency:'USD',allDates:true,from:'',to:'',complete:true,startKeys:[cashKey(rows[0])]});
const setup={fields:{document:'document',clearing:'clearing'},measure:'Amount',rules:[]};
(async()=>{
for(const n of [3,21,50,100]){
 const rows=chain(n),pauses=[],queries=[];const control={active:()=>true,pause:async c=>pauses.push(c)};
 const loaded=await loadCashLinks(setup,'T','USD',[rows[0]],async q=>{assert.ok(!queries.includes(q),'Must not reload completed queries');queries.push(q);const a=JSON.parse(decodeURIComponent(q.slice(';cashflow:'.length)));return {rows:rows.filter(p=>a.link.values.includes(p[a.link.field])),complete:true};},()=>true,()=>{},control);
 assert.equal(loaded.complete,true);assert.equal(loaded.rows.length,rows.length);
 const result=await traceCashResumable(loaded.rows,[],scope(rows),control);
 assert.equal(result.unresolved,0);assert.equal(result.allocations[0].path.length,2*n);assert.equal(result.allocations[0].path.at(-1).document,'D'+(n-1));assert.equal(result.payments,100);assert.equal(result.allocations[0].amount,-100);
 assert.deepEqual(result,traceCash(loaded.rows,[],{...scope(rows),maxDepth:512,maxSteps:1000000}));
 if(n>20){assert.ok(pauses.some(c=>c.phase==='loading'));assert.ok(pauses.some(c=>c.phase==='tracing'));}
}
// Rejoining sources and splits resume without losing capacities or pending allocations.
const rows=[p('PAY','1','BANK',-100),p('PAY','2','V',55,'C'),p('PAY','3','V',45,'C'),...[60,30,10].flatMap((a,i)=>[p('I'+i,'1','V',-a,'C'),p('I'+i,'2','EXP',a)])];
let count=0;const resumed=await traceCashResumable(rows,[],{...scope(rows),maxDepth:1,maxSteps:2},{active:()=>true,pause:async()=>count++});assert.ok(count);assert.deepEqual(resumed,traceCash(rows,[],scope(rows)));
// Long path pause must actually wait; cancellation must not yield a final result.
let active=true;await assert.rejects(()=>traceCashResumable(chain(50),[],scope(chain(50)),{active:()=>active,pause:async()=>{active=false;}}),/cancelled/);
active=true;await assert.rejects(()=>loadCashLinks(setup,'T','USD',[chain(50)[0]],async q=>{const a=JSON.parse(decodeURIComponent(q.slice(';cashflow:'.length)));return {rows:chain(50).filter(p=>a.link.values.includes(p[a.link.field])),complete:true};},()=>active,()=>{},{active:()=>active,pause:async()=>{active=false;}}),/cancelled/);
// Safety depth remains finite and conserves all unresolved cash.
const deep=chain(270),limited=await traceCashResumable(deep,[],scope(deep),{active:()=>true,pause:async()=>{}});assert.equal(limited.complete,false);assert.equal(limited.unresolved,100);assert.match(limited.allocations[0].status,/Safety depth/);
const ring=chain(30);ring[0]={...ring[0],account:'LOOP',clearing:'R'};ring[ring.length-1]={...ring.at(-1),account:'LOOP',clearing:'R'};const cycle=await traceCashResumable(ring,[],scope(ring),{active:()=>true,pause:async()=>{}});assert.equal(cycle.unresolved,100);assert.equal(cycle.allocations[0].status,'Cycle detected');
console.log('Continuation: 21/50/100 documents, exact paths, no repeated queries, split/group state, cancellation, cycles and 512-transition safety cap passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
