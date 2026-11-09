const assert=require('node:assert/strict');
const {pageCashFlow}=require('../.tmp/test/cashFlowPaging');
const {answerCashFlow,cashQuestion}=require('../.tmp/test/cashFlowQuery');
(async()=>{
const setup={fields:{company:'Company',document:'Document',item:'Item',clearing:'Clearing'},measure:'Amount',rules:[]};
const config={fields:['Company','Document','Item','Clearing'].map(name=>({name,table:'J',column:name,type:'text'}))};
const data=Array.from({length:6200},(_,i)=>({company:'C',year:'2026',document:String(i),item:'1',currency:'',amount:i+1,clearing:'X'}));
for(const phase of ['starts','links']){
 let calls=0;const question=cashQuestion(setup,'C',phase==='starts'?{phase,filters:[]}:{phase,link:{field:'Clearing',values:['X']}});
 const result=await pageCashFlow(question,async q=>{let plan;await answerCashFlow(q,config,['Amount'],async p=>{plan=p;return {text:''}});calls++;const map={Company:'company',Document:'document',Item:'item',Clearing:'clearing'};const matching=data.filter(row=>plan.filters.every(f=>f.operator==='NotIn'?!f.values.includes(row[map[f.target.column]]):f.values.includes(row[map[f.target.column]])));const rows=matching.slice(0,5000);return {rows,complete:matching.length<=5000,groups:rows.map(row=>({Company:row.company,Document:row.document,Item:row.item,Clearing:row.clearing}))};},()=>true,()=>{});
 assert.equal(result.complete,true);assert.equal(result.rows.length,6200);assert.equal(new Set(result.rows.map(p=>p.document)).size,6200);assert.equal(result.rows.reduce((a,p)=>a+p.amount,0),6200*6201/2);assert.ok(calls>1&&calls<20);
}
const q=cashQuestion(setup,'C',{phase:'starts',filters:[]});
const unresolved=await pageCashFlow(q,async()=>({rows:[data[0]],groups:[{Document:'same'}],complete:false}),()=>true,()=>{});assert.equal(unresolved.complete,false);assert.match(unresolved.reason,/cannot separate/);
// Equal-within-precision rows are still invalid overlaps across disjoint partitions.
for(const [amount,message] of [[-154570.19999999998,/Overlapping/],[-154570.21,/Posting amounts changed/]]){
 let calls=0;await assert.rejects(()=>pageCashFlow(q,async()=>{calls++;return calls===1?{rows:[],complete:false,groups:[{Document:'A'},{Document:'B'}]}:{rows:[{...data[0],amount:calls===2?-154570.2:amount}],complete:true};},()=>true,()=>{}),message);
}
let active=true;await assert.rejects(()=>pageCashFlow(q,async()=>{active=false;return {rows:[],complete:true}},()=>active,()=>{}),/cancelled/);
await assert.rejects(()=>answerCashFlow(';cashflow:'+encodeURIComponent(JSON.stringify({...JSON.parse(decodeURIComponent(q.slice(';cashflow:'.length))),partitions:[{field:'Amount',values:[1],exclude:false}]})),config,['Amount'],async()=>({text:''})),/Invalid/);
let observed;await answerCashFlow(';cashflow:'+encodeURIComponent(JSON.stringify({...JSON.parse(decodeURIComponent(q.slice(';cashflow:'.length))),partitions:[{field:'Document',values:['1'],exclude:true}]})),{...config,alwaysFilter:{field:'Document',values:['1','2']}},['Amount'],async plan=>{observed=plan;return {text:''}});assert.deepEqual(observed.filters.find(f=>f.target.column==='Document').values,['2'],'Always scope is intersected');
const mixed=[null,0,1,'001','002'].map((value,i)=>({...data[i],value}));const mixedResult=await pageCashFlow(q,async text=>{const request=JSON.parse(decodeURIComponent(text.slice(';cashflow:'.length)));const rows=mixed.filter(r=>(request.partitions||[]).every(p=>p.exclude?!p.values.includes(r.value):p.values.includes(r.value)));return {rows:rows.slice(0,2),groups:rows.slice(0,2).map(r=>({Document:r.value})),complete:rows.length<=2}},()=>true,()=>{});assert.equal(mixedResult.rows.length,5);assert.equal(mixedResult.complete,true);
console.log('Cash-flow paging: 6200 starting/link rows, exhaustive partitions, no duplicates, totals, unsplittable scope and cancellation passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
