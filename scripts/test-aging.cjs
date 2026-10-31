const assert=require('node:assert/strict');
const {defaultAgingBuckets,validateAging,agingDateFilters,answerAging}=require('../.tmp/test/aging');
const fields=[{name:'Customer',table:'Data',column:'Customer',type:'text'},{name:'Due',table:'Data',column:'Due',type:'date'},{name:'As Of',table:'Snapshot',column:'Date',type:'date'}];
const setup={name:'Customer',dateField:'Due',basis:'Due date',measure:'Balance',group:'Customer',asOfField:'As Of',defaultDate:'',display:'detailed',buckets:defaultAgingBuckets()};
const config={enabled:true,table:'Parameter',column:'Parameter',options:fields.map(f=>f.name),fields,aging:[setup]};
const matches=(value,filter)=>filter.conditions.every(c=>c.operator==='IsBlank'?value==null:c.operator==='IsNotBlank'?value!=null:c.operator==='GreaterThanOrEqual'?value>=c.value:value<c.value);
for(const age of [-50000,-1,0,30,31,60,61,90,91,120,121,180,181,365,366,100000]){
 const date=new Date(Date.parse('2026-09-30')-age*86400000).toISOString();
 assert.equal(setup.buckets.filter(b=>agingDateFilters({table:'Data',column:'Due'},'2026-09-30',b).every(f=>matches(date,f))).length,1,`One band for ${age}`);
}
validateAging([setup],fields.map(f=>f.name),['Balance']);
const bad=structuredClone(setup);bad.buckets[2].min=30;assert.throws(()=>validateAging([bad],fields.map(f=>f.name),['Balance']),/gaps or overlaps/);
(async()=>{
 let calls=[];
 const load=async plan=>{calls.push(plan);return {text:'',modelQuery:true,table:{columns:['Customer','Balance'],rows:[['A','7']],rowIndices:[[]],modelSelections:[[{table:'Data',column:'Customer',value:'A'}]],modelTotals:['Grand Total','99'],modelResultComplete:true}};};
 const answer=await answerAging('Show Customer aging as of 2026-09-30',config,['Balance'],load);
 assert.equal(calls.length,10);assert.equal(answer.table.rows.length,1);assert.equal(answer.table.modelTotals[1],'99');assert.equal(answer.table.columns.at(-2),'Date unavailable');
 assert.ok(answer.table.agingScopes['0–30'].inheritedFilters.some(f=>f.target.column==='Due'));
 assert.ok(calls.every(p=>p.filters.some(f=>f.target.table==='Snapshot')));
 calls=[];const summary=await answerAging('Show Customer aging as of 2026-09-30 summary',config,['Balance'],load);assert.equal(calls.length,8);assert.ok(summary.table.columns.includes('31–90'));assert.equal(setup.buckets[2].max,60);
 await assert.rejects(()=>answerAging('Show Customer aging as of 2026-09-30',{...config,aging:[{...setup,asOfField:''}]},['Balance'],load),/Historical/);
 await assert.rejects(()=>answerAging('Show Customer aging as of 2026-09-30',config,['Balance'],async()=>({table:{rows:[],modelResultComplete:false}})),/incomplete/);
 assert.equal(await answerAging('Show Balance by Customer',config,['Balance'],load),undefined);
 console.log('Aging boundaries, model totals, summary bands, drill filters and historical safeguards passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
