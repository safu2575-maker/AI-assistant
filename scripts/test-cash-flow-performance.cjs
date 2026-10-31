const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {traceCash,cashKey}=require('../.tmp/test/cashFlow');
const {loadCashLinks}=require('../.tmp/test/cashFlowLoad');
const {cashFlowSteps}=require('../.tmp/test/qna/cashFlowCharts');
const scope={company:'9720',currency:'SAR',allDates:true,from:'',to:'',complete:true};
const posting=(document,item,account,amount,clearing='')=>({company:'9720',year:'2026',currency:'SAR',date:'',document,item,account,amount,clearing});
(async()=>{
 // Many partial payments share one clearing group and one invoice: allocations must not be reused.
 const count=4000,rows=[],starts=[];
 for(let i=0;i<count;i++){const bank=posting('P'+i,'1','Bank',-1);starts.push(cashKey(bank));rows.push(bank,posting('P'+i,'2','Vendor',1,'C'));}
 rows.push(posting('Invoice','1','Vendor',-count,'C'),posting('Invoice','2','Expense',count));
 let reads=0;for(const p of rows){const value=p.amount;Object.defineProperty(p,'amount',{get(){reads++;return value;},enumerable:true});}
 const begin=performance.now(),result=traceCash(rows,[],{...scope,startKeys:starts});
 assert.equal(result.roots,count);assert.equal(result.payments,count);assert.equal(result.unresolved,0);assert.equal(result.allocations.length,count);
 assert.ok(result.allocations.every(a=>a.amount===-1&&a.path.length===4&&a.account==='Expense'));
 assert.ok(reads<1000000,`Shared clearing groups were repeatedly scanned: ${reads} amount reads`);
 const chain=result.allocations[0].path,steps=cashFlowSteps(chain);
 assert.deepEqual(steps.map(g=>g.length),[1,2,1]);assert.deepEqual(steps.flat(),chain);
 assert.equal(cashFlowSteps(chain.map(p=>({...p,account:''}))).length,4,'Do not guess account identity');
 assert.equal(cashFlowSteps([chain[1],{...chain[2],company:'other'}]).length,2);
 assert.equal(cashFlowSteps([chain[1],{...chain[2],currency:'USD'}]).length,2);
 console.log(`Cash-flow shared group: ${rows.length} postings, ${count} payments, ${(performance.now()-begin).toFixed(1)}ms; ${reads} amount reads.`);
 // A virtual million-row model only materializes requested document rows; the visual never receives the ledger.
 const sourceRows=1000000,rootCount=2000,roots=Array.from({length:rootCount},(_,i)=>posting(String(i),'1','Bank',-1));
 let calls=0,returned=0;
 const graph=await loadCashLinks({fields:{document:'Document',clearing:'Clearing'},measure:'Amount',rules:[]},'9720','SAR',roots,async q=>{
  const request=JSON.parse(decodeURIComponent(q.slice(';cashflow:'.length)));calls++;
  assert.equal(request.company,'9720');assert.equal(request.phase,'links');assert.equal(request.link.field,'Document');assert.ok(request.link.values.length<=40);
  const rows=request.link.values.flatMap(doc=>Number(doc)<sourceRows/2?[posting(doc,'1','Bank',-1),posting(doc,'2','Expense',1)]:[]);
  returned+=rows.length;return {rows,complete:true};
 },()=>true,()=>{});
 assert.equal(graph.rows.length,rootCount*2);assert.equal(returned,rootCount*2);assert.equal(calls,50);assert.equal(graph.complete,true);
 const bounded=traceCash(graph.rows,[],{...scope,startKeys:roots.map(cashKey)});assert.equal(bounded.payments,rootCount);assert.equal(bounded.unresolved,0);
 console.log(`Cash-flow million-row synthetic source: ${returned} scoped rows returned in ${calls} batches; no full-ledger load.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
