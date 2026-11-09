const assert=require('node:assert/strict');
const fs=require('node:fs');
const {FieldParameterTrial}=require('../.tmp/test/fieldParameterTrial');
const {allCustomKpis}=require('../.tmp/test/calculationGroups');
const {calculationView}=require('../.tmp/test/calculationRequest');
const {planParameterQuestion}=require('../.tmp/test/parameterQuery');
(async()=>{
 const csv=fs.readFileSync('outputs/askbics-expanded-20261025/askBICS_Sample_Retail_Data.csv','utf8').trim().replace(/^\uFEFF/,'').split(/\r?\n/);
 const cells=line=>(line.match(/(?:"(?:[^"]|"")*"|[^,]*)(?:,|$)/g)||[]).filter((v,i,a)=>v||i<a.length-1).map(v=>v.replace(/,$/,'').replace(/^"|"$/g,'').replace(/""/g,'"'));
 const headers=cells(csv.shift());const data=csv.map(line=>Object.fromEntries(cells(line).map((v,i)=>[headers[i],v])));
 const fields=['Year','Assigned Tenant Name','Assigned Sales Category'].map(name=>({name,table:'Retail',column:name,type:name==='Year'?'number':'text',values:[...new Set(data.map(r=>r[name]))]}));
 const group={id:'test',version:1,name:'test',enabled:true,description:'',defaultMeasure:'Rent Measure',defaultField:'Assigned Tenant Name',measures:['Home Living','Nova Fashion'].map((v,i)=>({id:String(i),name:i?'NOVA':'sample',formula:`('${v}')`,enabled:true,description:'',format:'number',decimals:2,total:'recalculate'}))};
 const config={enabled:true,table:'Parameter',column:'Parameter',options:fields.map(f=>f.name),fields,defaultMeasure:'Rent Measure',time:{yearField:'Year'},calculationGroups:[group],customKpis:allCustomKpis({calculationGroups:[group]})};
 const names=['Rent Measure','sample','NOVA'];
 for(const text of ['Rent Measure Nova Fashion','Nova Fashion Rent Measure 2023']){
  const p=planParameterQuestion(text,config,names);assert.deepEqual(p.measures,['Rent Measure']);assert(p.filters.some(f=>f.target.column==='Assigned Tenant Name'&&f.values.includes('Nova Fashion')));
 }
 const trial=Object.create(FieldParameterTrial.prototype);trial.requestConfig=config;
 trial.requestBase=async p=>{
  const records=data.filter(r=>p.filters.every(f=>{const actual=r[f.target.column];return f.operator==='In'?f.values.some(v=>String(v)===actual):f.conditions.every(c=>c.operator==='Is'&&String(c.value)===actual);}));
  const grouped=new Map();for(const r of records){const labels=p.groups.map(g=>g==='Year'?Number(r[g]):r[g]),key=JSON.stringify(labels);if(!grouped.has(key))grouped.set(key,[...labels,0]);grouped.get(key)[labels.length]+=Number(r.Rent);}
  const columns=[...p.groups.map(displayName=>({displayName})),{displayName:'Rent Measure',isMeasure:true,roles:{measures:true}}];
  return trial.answer({metadata:{columns},table:{columns,rows:[...grouped.values()],totals:[...p.groups.map(()=>null),records.reduce((s,r)=>s+Number(r.Rent),0)]}},p);
 };
 const load=p=>p.groups.length?trial.requestBase(p):trial.requestScalarWithGrouping(p,config,false);
 const plan=planParameterQuestion('#test by Year',config,names);
 const requestPlans=[];
 const result=await calculationView(plan,config,p=>{requestPlans.push(p);return load(p);},['Rent Measure']);
 assert.equal(requestPlans.length,3,'One year anchor plus two filtered year requests; reuse model totals');
 assert(requestPlans.every(p=>p.groups.join() === 'Year'),'No tenant discovery queries are needed with a default field');
 assert.deepEqual(result.view.table.rows,[[2023,513130,478525],[2024,520828,452034],[2025,528640,454892],[2026,536570,429574],[2027,544618,432433]]);
 assert.deepEqual(result.view.table.totals,[null,2643786,2247458]);
 const {customKpiRequest}=require('../.tmp/test/customKpis');
 for(const presentation of ['table','matrix']){
  const displayed=await customKpiRequest({...plan,presentation},config,['Rent Measure'],load,(v,p)=>trial.answer(v,p));
  const t=displayed.table;
  assert.deepEqual(t.columns,['Calculation','2023','2024','2025','2026','2027','Grand Total']);
  assert.deepEqual(t.rows[0],['sample','513,130.00','520,828.00','528,640.00','536,570.00','544,618.00','2,643,786.00']);
  assert.deepEqual(t.rows[1],['NOVA','478,525.00','452,034.00','454,892.00','429,574.00','432,433.00','2,247,458.00']);
  assert.deepEqual(t.totalRowIndices,[]);
  assert.equal(t.modelRawRows[0][1],513130);
  assert.equal(t.calculationRowMeasures[1],'NOVA');
  assert.equal(t.modelCellSelections[0][1][0][0].value,2023);
  assert.equal(t.modelCellSelections[0][2][0][0].value,2024);
  assert(t.calculationNotes['0:1'].length);
  assert(t.calculationNotes['0:6'].length);
  assert.equal(t.modelRawTotals,undefined,'never sum different calculations into one total');
 }
 const single=await customKpiRequest({...plan,groups:[],measures:['NOVA'],totalOnly:true},config,['Rent Measure'],load,(v,p)=>trial.answer(v,p));
 assert.deepEqual(single.table.columns,['Calculation','Value']);
 assert.deepEqual(single.table.rows,[['NOVA','2,247,458.00']]);
 assert.equal(single.kpi,undefined,'even scalar calculations use rows');
 const scalar=await calculationView({...plan,groups:[]},config,load,['Rent Measure']);assert.deepEqual(scalar.view.table.rows,[[2643786,2247458]]);
 const ratio={...group.measures[0],id:'ratio',name:'Tenant ratio',formula:"('Home Living') / ('Nova Fashion')"};
 config.customKpis=allCustomKpis({calculationGroups:[{...group,measures:[ratio]}]});
 const ratios=await calculationView({...plan,measures:['Tenant ratio']},config,load,['Rent Measure']);
 assert.equal(ratios.view.table.totals[1],2643786/2247458,'ratio total must recalculate, never sum row ratios');
 assert.notEqual(ratios.view.table.totals[1],ratios.view.table.rows.reduce((s,r)=>s+r[1],0));
 const ratioAnswer=await customKpiRequest({...plan,measures:['Tenant ratio']},config,['Rent Measure'],load,(v,p)=>trial.answer(v,p));
 assert.equal(ratioAnswer.table.modelRawRows[0][6],2643786/2247458,'year-column Grand Total uses the evaluated ratio');
 assert.equal(ratioAnswer.table.rows.length,1,'one row per KPI');
 // Multiple row dimensions must not prevent Year column presentation or non-additive totals.
 const performance={...ratio,id:'performance',name:'Performance',formula:"('Rent Measure') / ('Rent Measure', [Year] = 2023)"};
 config.customKpis=allCustomKpis({calculationGroups:[{...group,measures:[performance]}]});
 for(const text of ['Performance by Assigned Sales Category and Year','Performance by Assigned Sales Category Year (c)']){
  const multiPlan=planParameterQuestion(text,config,['Rent Measure','Performance']);
  const multi=await customKpiRequest(multiPlan,config,['Rent Measure'],load,(v,p)=>trial.answer(v,p));
  const t=multi.table;assert.deepEqual(t.columns,['Calculation','Assigned Sales Category','2023','2024','2025','2026','2027','Grand Total']);
  for(let i=0;i<t.rows.length;i++){
   assert.equal(t.rows[i][0],'Performance');const category=t.rows[i][1];
   const records=data.filter(r=>r['Assigned Sales Category']===category),denom=records.filter(r=>r.Year==='2023').reduce((a,r)=>a+Number(r.Rent),0);
   assert(Math.abs(t.modelRawRows[i][7]-records.reduce((a,r)=>a+Number(r.Rent),0)/denom)<1e-9,'Company/category total recalculates formula');
   assert.equal(t.modelCellSelections[i][2][0].find(s=>s.column==='Year').value,2023);
   assert(t.calculationNotes[i+':7'].length,'Subtotal breakdown retained');
  }
 }
 const originalRequest=trial.requestBase;
 trial.requestBase=async p=>{const response=await originalRequest(p);response.table.modelResultComplete=false;return response;};
 const partial=await trial.requestScalarWithGrouping({...plan,groups:[],measures:['Rent Measure']},config,false);
 assert.equal(partial.table.modelResultComplete,false,'scalar adapter must retain incomplete status too');
 console.log('Retail calculation regression: tenant shorthand, question value priority, host scalar metadata, yearly values and recalculated totals passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
