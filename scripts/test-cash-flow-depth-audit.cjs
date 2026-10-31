const assert=require('node:assert/strict');
const {traceCash,cashKey}=require('../.tmp/test/cashFlow');
const {loadCashLinks}=require('../.tmp/test/cashFlowLoad');
const p=(d,item,account,amount,clearing='')=>({company:'T',year:'2026',currency:'USD',date:'2026-01-01',document:d,item,account,amount,clearing,clearingYear:'2026'});
const chain=n=>Array.from({length:n},(_,i)=>[p('D'+i,'1',i?'A'+(i-1):'BANK',-100,i?'C'+(i-1):''),p('D'+i,'2',i===n-1?'END':'A'+i,100,i===n-1?'':'C'+i)]).flat();
const scope=rows=>({company:'T',currency:'USD',allDates:true,from:'',to:'',complete:true,startKeys:[cashKey(rows[0])]});
(async()=>{
for(const n of [1,3,10,20,21,30,50]){
 const rows=chain(n);const r=traceCash(rows,[],scope(rows));
 assert.equal(r.allocations.reduce((s,a)=>s+Math.abs(a.amount),0),100,'No amount disappears');
 if(n<=20){assert.equal(r.unresolved,0);assert.equal(r.allocations[0].path.length,2*n);assert.equal(r.allocations[0].path.at(-1).document,'D'+(n-1));}
 else {assert.equal(r.unresolved,100);assert.equal(r.allocations[0].status,'Processing limit reached');}
 let calls=0;
 const loaded=await loadCashLinks({fields:{document:'document',clearing:'clearing'},measure:'Amount',rules:[]},'T','USD',[rows[0]],async q=>{calls++;const a=JSON.parse(decodeURIComponent(q.slice(';cashflow:'.length)));return {rows:rows.filter(p=>a.link.values.includes(p[a.link.field])),complete:true};},()=>true,()=>{});
 console.log(JSON.stringify({documents:n,engineStatus:r.allocations[0].status,pathRows:r.allocations[0].path.length,loadedRows:loaded.rows.length,loaderComplete:loaded.complete,queries:calls}));
 if(n<=20){assert.equal(loaded.complete,true);assert.equal(loaded.rows.length,rows.length);}
}
// Shuffle branch order: exact splits must retain all terminal amounts and identities.
const split=[p('PAY','1','BANK',-100),p('PAY','2','V',100,'C'),...[60,30,10].flatMap((amount,i)=>[p('I'+i,'1','V',-amount,'C'),p('I'+i,'2','EXP',amount)])];
for(let k=0;k<30;k++){const shuffled=[...split].sort((a,b)=>((Number(a.item)+a.document.length+k)%7)-((Number(b.item)+b.document.length+k)%7));const r=traceCash(shuffled,[],scope(split));assert.equal(r.unresolved,0);assert.deepEqual(r.allocations.map(a=>a.amount).sort((a,b)=>a-b),[-60,-30,-10]);}
// Closed ring returns to start: terminate with unresolved cash, never success.
const ring=chain(5);ring[0]={...ring[0],account:'LOOP',clearing:'R'};ring[ring.length-1]={...ring.at(-1),account:'LOOP',clearing:'R'};
const cyclic=traceCash(ring,[],scope(ring));assert.equal(cyclic.unresolved,100);assert.equal(cyclic.allocations[0].status,'Cycle detected');
console.log('Deep-chain boundaries, loaded closure, split permutations and closed-cycle conservation passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
