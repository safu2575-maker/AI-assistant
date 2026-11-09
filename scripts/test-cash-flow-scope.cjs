const assert=require('node:assert/strict');
const {cashQuestion,cashValuesQuestion,answerCashFlow,cashPostings}=require('../.tmp/test/cashFlowQuery');
const {loadCashLinks}=require('../.tmp/test/cashFlowLoad');
const {traceCash,cashKey}=require('../.tmp/test/cashFlow');
const {FieldParameterTrial}=require('../.tmp/test/fieldParameterTrial');
(async()=>{
const fields=['company','document','clearing','account','accountDescription','date','currency','item','Branch'];
const setup={fields:Object.fromEntries(fields.filter(f=>f!=='Branch').map(f=>[f,f])),measure:'Amount',rules:[]};
const config={fields:fields.map(name=>({name,table:'Journal',column:name,type:name==='date'?'date':'text'})),alwaysFilter:{field:'currency',values:['SAR']}};
let plan;const load=async p=>{plan=p;return {text:''};};
await answerCashFlow(cashQuestion(setup,'9720',{phase:'starts',filters:[{field:'Branch',values:['A','B']}],from:'2026-10-01',to:'2026-10-31',currency:'SAR'}),config,['Amount'],load);
assert.equal(plan.cashFlowRowLimit,5000);assert.deepEqual(plan.filters.find(f=>f.target.column==='Branch').values,['A','B']);assert.ok(!plan.filters.some(f=>f.target.column==='accountDescription'),'Explicit starting filters must not receive a hidden bank-description restriction');assert.ok(plan.filters.find(f=>f.target.column==='date').conditions);
await answerCashFlow(cashQuestion(setup,'9720',{phase:'links',link:{field:'document',values:['001','002']},filters:[{field:'Branch',values:['A']}],from:'2026-10-01',to:'2026-10-31',currency:'SAR'}),config,['Amount'],load);
assert.ok(!plan.filters.some(f=>['Branch','date','accountDescription'].includes(f.target.column)));assert.deepEqual(plan.filters.find(f=>f.target.column==='company').values,['9720']);assert.deepEqual(plan.filters.find(f=>f.target.column==='currency').values,['SAR']);
await answerCashFlow(cashValuesQuestion('Branch','company',['9720','9760']),config,[],load);assert.equal(plan.cashFlowRowLimit,201);assert.deepEqual(plan.groups,['Branch']);assert.deepEqual(plan.filters.find(f=>f.target.column==='company').values,['9720','9760']);
await assert.rejects(()=>answerCashFlow(cashQuestion(setup,'9720',{phase:'starts',filters:[{field:'company',values:['9760']}]}),config,['Amount'],load),/conflicts/);
await assert.rejects(()=>answerCashFlow(cashQuestion(setup,'9720',{phase:'links',link:{field:'Branch',values:['A']}}),config,['Amount'],load),/mapped document/);
await answerCashFlow(cashQuestion(setup,'9720',{phase:'starts',filters:[{field:'date',values:['2026-09-01','2026-10-01']}],from:'2026-10-01',to:'2026-10-31'}),config,['Amount'],load);assert.equal(plan.filters.filter(f=>f.target.column==='date').length,1);assert.deepEqual(plan.filters.find(f=>f.target.column==='date').values,['2026-10-01T00:00:00.000Z']);
await answerCashFlow(cashQuestion(setup,'9720',{phase:'starts',filters:[]}),config,['Amount'],load);assert.ok(plan.filters.find(f=>f.target.column==='accountDescription').values.includes('Bank'));
const posting=(document,item,amount,clearing='',accountDescription='Vendor')=>({company:'9720',year:'',document,item,account:'',accountDescription,amount,clearing,currency:'SAR',date:'2026-09-01'});
const data=[posting('1','1',-100,'','Bank'),posting('1','2',100,'201'),posting('2','1',-100,'201'),posting('2','2',100,'202'),posting('3','1',-100,'202'),posting('3','2',100,'','Expense')];
data[0].date='2026-10-01';const queries=[];
const transport=async q=>{const r=JSON.parse(decodeURIComponent(q.slice(';cashflow:'.length)));queries.push(r);assert.equal(r.company,'9720');assert.equal(r.phase,'links');assert.equal(r.from,undefined);return {rows:data.filter(p=>r.link.values.includes(p[r.link.field])),complete:true};};

const {sameCashPostingAmount}=require('../.tmp/test/cashFlowAmount');
assert.ok(sameCashPostingAmount(-154570.2,-154570.19999999998));
assert.ok(sameCashPostingAmount(0.3,0.1+0.2));
for(const [a,b] of [[-154570.2,-154570.21],[1,1.000001],[1e12,1e12+0.01],[NaN,NaN],[Infinity,Infinity],[-1e-16,1e-16]])assert.equal(sameCashPostingAmount(a,b),false);
const original={...data[0],amount:-154570.2};
const repeated=await loadCashLinks(setup,'9720','SAR',[original],async()=>({rows:[{...original,amount:-154570.19999999998}],complete:true}),()=>true,()=>{});
assert.equal(repeated.rows.length,1);assert.equal(repeated.rows[0],original);assert.equal(repeated.rows[0].amount,-154570.2);
await assert.rejects(()=>loadCashLinks(setup,'9720','SAR',[original],async()=>({rows:[{...original,amount:-154570.21}],complete:true}),()=>true,()=>{}),/Posting amounts changed/);

const graph=await loadCashLinks(setup,'9720','SAR',[data[0]],transport,()=>true,()=>{});assert.equal(graph.rows.length,6);assert.ok(graph.complete);assert.ok(queries.length<10);
const result=traceCash(graph.rows,[],{company:'9720',currency:'SAR',allDates:true,from:'',to:'',startKeys:[cashKey(data[0])],complete:true});assert.equal(result.payments,100);assert.equal(result.allocations[0].path.length,6);
const capped=await loadCashLinks(setup,'9720','SAR',[data[0]],async()=>({rows:[],complete:false}),()=>true,()=>{});assert.equal(capped.complete,false);
await assert.rejects(()=>loadCashLinks(setup,'9720','SAR',[data[0]],async()=>({rows:[{...data[0],amount:data[0].amount+1}],complete:true}),()=>true,()=>{}),error=>{assert.match(error.message,/Posting amounts changed/);const detail=JSON.parse(error.message.split('Conflict: ')[1]);assert.equal(detail.previousAmount,data[0].amount);assert.equal(detail.returnedAmount,data[0].amount+1);assert.equal(detail.document,data[0].document);return true;});
let active=true;await assert.rejects(()=>loadCashLinks(setup,'9720','SAR',[data[0]],async()=>{active=false;return {rows:data,complete:true};},()=>active,()=>{}),/cancelled/);
const other=await loadCashLinks(setup,'9760','SAR',[{...data[0],company:'9760'}],transport2,()=>true,()=>{});async function transport2(){return {rows:data,complete:true};}assert.equal(other.rows.length,1,'cross-company responses cannot join a trace');
const trial=Object.create(FieldParameterTrial.prototype);trial.requestConfig=config;
const cols=['company','document','clearing','Amount'].map((displayName,i)=>({displayName,roles:i===3?{measures:true}:{categories:true}}));
const native={metadata:{columns:cols},table:{columns:cols,rows:Array.from({length:6000},(_,i)=>['9720',String(i),null,-1])}};
const answer=trial.answer(native,{groups:['company','document','clearing'],measures:['Amount'],filters:[],summary:[],cashFlowData:true,cashFlowRowLimit:5000});assert.equal(answer.table.rows.length,5000);assert.equal(answer.table.modelResultComplete,false);
trial.boundedCashFlow=true;assert.equal(trial.canFetchMoreData(),false);trial.pending={plan:{}};assert.equal(trial.canFetchMoreData(),true);
const simple={fields:{company:'company',document:'document',clearing:'clearing'},measure:'Amount',rules:[]};
const a=cashPostings(answer.table,simple),b=cashPostings({...answer.table,rows:answer.table.rows.slice(1),modelGroupValues:answer.table.modelGroupValues.slice(1),modelRawRows:answer.table.modelRawRows.slice(1)},simple);assert.equal(cashKey(a[1]),cashKey(b[0]),'synthetic posting keys remain stable across query batches');

const groupedSetup={fields:{company:'company',document:'document',clearing:'clearing',account:'account'},measure:'Amount',rules:[],displayColumns:['Posting Key','Posting Date','Doc Type','Amount']};
const groupedColumns=['company','document','clearing','account','Posting Key','Posting Date','Doc Type','Amount'];
const raw=[['2396','1500005798','1500005798','160500','31','2026-01-01T00:00:00Z','KZ',58244.54],['2396','1500005798','1500005798','160500','21','2026-01-01T00:00:00Z','KZ',-50]];
const tableFor=(values,columns=groupedColumns)=>({columns,rows:values.map(r=>r.map(String)),rowIndices:values.map(()=>[]),modelGroupValues:values.map(r=>r.map((v,i)=>columns[i]==='Amount'?null:v)),modelRawRows:values.map(r=>r.map((v,i)=>columns[i]==='Amount'?v:null))});
const grouped=cashPostings(tableFor(raw),groupedSetup);assert.notEqual(cashKey(grouped[0]),cashKey(grouped[1]));
const reorder=[7,6,5,4,3,2,1,0];const reordered=cashPostings(tableFor(raw.map(r=>reorder.map(i=>r[i])),reorder.map(i=>groupedColumns[i])),{...groupedSetup,displayColumns:[...groupedSetup.displayColumns].reverse()});assert.deepEqual(grouped.map(cashKey),reordered.map(cashKey));
const changed=raw.map(r=>[...r]);changed[0][7]=1;assert.equal(cashKey(grouped[0]),cashKey(cashPostings(tableFor(changed),groupedSetup)[0]),'Amount must not affect identity');
for(const column of [4,5,6]){const distinct=raw.map(r=>[...r]);distinct[1]=[...distinct[0]];distinct[1][column]='different';assert.notEqual(...cashPostings(tableFor(distinct),groupedSetup).map(cashKey));}
const formatted=tableFor(raw);formatted.rows=formatted.rows.map(r=>r.map(()=> 'same display'));assert.deepEqual(cashPostings(formatted,groupedSetup).map(cashKey),grouped.map(cashKey),'Raw group values override display formatting');
const groupedGraph=await loadCashLinks(groupedSetup,'2396','',[grouped[0]],async()=>({rows:grouped,complete:true}),()=>true,()=>{});assert.equal(groupedGraph.rows.length,2,'Repeated lookups deduplicate only identical grouped postings');
await assert.rejects(()=>loadCashLinks(groupedSetup,'2396','',[grouped[0]],async()=>({rows:cashPostings(tableFor(changed),groupedSetup),complete:true}),()=>true,()=>{}),/Posting amounts changed/);
const explicit={...groupedSetup,fields:{...groupedSetup.fields,item:'Posting Key'}};assert.equal(cashPostings(tableFor(raw),explicit)[0].item,'31','Mapped line item remains authoritative');

const {cashRunSummary}=require('../.tmp/test/qna/cashFlowReport');const roots=[1,2,3,4,5].map(n=>posting(String(n),'1',-100));const allocations=[{root:cashKey(roots[0]),status:'Resolved'},{root:cashKey(roots[1]),status:'Resolved'},{root:cashKey(roots[1]),status:'Missing link'},{root:cashKey(roots[2]),status:'Allocation unclear'}];const report={roots,result:{allocations},verified:new Set(roots.slice(0,3).map(cashKey)),finished:new Set(roots.slice(0,4).map(cashKey)),conflict:false};assert.deepEqual(cashRunSummary(report),{completed:1,partial:1,unresolved:1,unverified:1,pending:1,estimated:0});assert.equal(cashRunSummary({...report,conflict:true}).unverified,5);
console.log('Cash-flow scope: model predicates, separate link scope, bounded values/rows, graph batching, cross-company isolation, cancellation and stable keys passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
