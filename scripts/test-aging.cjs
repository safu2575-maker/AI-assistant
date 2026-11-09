const assert=require('node:assert/strict');
const {defaultAgingBuckets,validateAging,agingDateFilters,answerAging,todayDate}=require('../.tmp/test/aging');
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
 const current=await answerAging('Show Customer aging',{...config,aging:[{...setup,defaultDate:'2020-01-01'}]},['Balance'],load);
 assert.equal(current.table.agingView.date,todayDate(),'Date-free questions use today even with a legacy fixed default');
 assert.ok(current.text.includes('As of '+todayDate()));
 assert.ok(calls.every(p=>p.filters.some(f=>f.target.table==='Snapshot'&&f.conditions[0].value===todayDate()+'T00:00:00.000Z')));
 const noSnapshot=await answerAging('Show Customer aging summary',{...config,aging:[{...setup,asOfField:''}]},['Balance'],load);assert.equal(noSnapshot.table.agingView.date,todayDate());
 calls=[];
 const answer=await answerAging('Show Customer aging by Customer as of 2026-09-30',config,['Balance'],load);
 assert.equal(calls.length,10);assert.equal(answer.table.rows.length,1);assert.equal(answer.table.modelTotals[1],'99');assert.equal(answer.table.columns.at(-2),'Date unavailable');
 assert.ok(answer.table.agingScopes['0–30'].inheritedFilters.some(f=>f.target.column==='Due'));
 assert.ok(calls.every(p=>p.filters.some(f=>f.target.table==='Snapshot')));
 calls=[];const summary=await answerAging('Show Customer aging by Customer as of 2026-09-30 summary',config,['Balance'],load);assert.equal(calls.length,8);assert.ok(summary.table.columns.includes('31–90'));assert.equal(setup.buckets[2].max,60);
 await assert.rejects(()=>answerAging('Show Customer aging by Customer as of 2026-09-30',{...config,aging:[{...setup,asOfField:''}]},['Balance'],load),/Historical/);
 await assert.rejects(()=>answerAging('Show Customer aging by Customer as of 2026-09-30',config,['Balance'],async()=>({table:{rows:[],modelResultComplete:false}})),/incomplete/);
 assert.equal(await answerAging('Show Balance by Customer',config,['Balance'],load),undefined);
 console.log('Aging boundaries, model totals, summary bands, drill filters and historical safeguards passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});

(async()=>{
 const days=[-1,0,30,31,60,61,90,91,120,121,180,181,365,366,null];
 const dates=days.map(d=>d===null?null:new Date(Date.parse('2026-09-30')-d*86400000).toISOString());
 const raw=dates.map((d,i)=>['A',d]);
 const source={columns:['Customer','Due','Balance'],rows:raw.map((r,i)=>[r[0],r[1]??'',String(i+1)]),rowIndices:raw.map(()=>[]),modelGroupValues:raw,modelRawRows:raw.map((_,i)=>[null,null,i+1]),modelResultComplete:true};
 let calls=0;const load=async p=>{calls++;assert.deepEqual(p.groups,['Customer','Due']);assert(p.filters.some(f=>f.target.table==='Snapshot'));return {table:source};};
 const answer=await answerAging('Show Customer aging by Customer as of 2026-09-30',{...config,aging:[{...setup,additive:true}]},['Balance'],load);
 assert.equal(calls,1);assert.equal(Number(answer.table.modelTotals.at(-1).replaceAll(',','')),120);assert.equal(Number(answer.table.modelTotals.at(-2)),15);
 const {additiveAgingBands}=require('../.tmp/test/agingAdditive');
 const make=s=>additiveAgingBands(s,fields[0],'Due','Balance','2026-09-30',[...setup.buckets,null,undefined]);
 assert.throws(()=>make({...source,modelResultComplete:false}),/incomplete/);
 assert.throws(()=>make({...source,modelRawRows:undefined}),/Raw/);
 assert.throws(()=>make({...source,rows:[...source.rows,source.rows[0]],modelGroupValues:[...raw,raw[0]],modelRawRows:[...source.modelRawRows,source.modelRawRows[0]]}),/duplicate/);
 const bands=make(source);assert.deepEqual(bands.map(b=>b.modelRawTotals[1]),[1,5,9,13,17,21,25,14,15,120]);
 console.log('Additive aging: one query, exact boundaries/totals, snapshot scope and incomplete/raw/duplicate guards passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});

(async()=>{
 validateAging([{...setup,group:''}],fields.map(f=>f.name),['Balance']);
 let calls=0;
 const answer=await answerAging('Show Customer aging as of 2026-09-30',config,['Balance'],async p=>{calls++;assert.equal(p.agingDateField,'Due');assert.deepEqual(p.groups,[]);assert.equal(p.totalOnly,true);return {kpi:{value:'42'}};});
 assert.equal(calls,10);assert.equal(answer.table.agingView.group,'');assert.deepEqual(answer.table.rows[0],['All balances',...Array(10).fill('42')]);assert.deepEqual(answer.table.modelSelections,[[]]);
 const source={columns:['Due','Balance'],rows:[['2026-09-30','5'],['','2']],rowIndices:[[],[]],modelGroupValues:[['2026-09-30'],[null]],modelRawRows:[[null,5],[null,2]],modelResultComplete:true};
 calls=0;const fast=await answerAging('Show Customer aging as of 2026-09-30',{...config,aging:[{...setup,group:'',additive:true}]},['Balance'],async p=>{calls++;assert.deepEqual(p.groups,['Due']);return {table:source};});
 assert.equal(calls,1);assert.equal(fast.table.rows[0].at(-1),'7');assert.equal(fast.table.rows[0].at(-2),'2');
 await assert.rejects(()=>answerAging('Show Customer aging by Missing',config,['Balance'],async()=>{throw Error('Must not load');}),/grouping field/);
 console.log('Ungrouped aging: legacy defaults ignored, scalar model totals, one-query additive totals and explicit grouping validation passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
