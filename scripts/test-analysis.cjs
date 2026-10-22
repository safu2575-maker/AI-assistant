const assert=require('node:assert/strict');
const {planAnalysis,runAnalysis,analysisQuestion,validateAnalysis,analysisBinding}=require('../.tmp/test/analysisTemplates');
const definition={consolidated:false,measure:'Rent',hierarchy:['Group','Category','Tenant'],breakdownKeywords:['explain','breakdown'],varianceKeywords:['variance','var','difference'],comparison:'prior-year',missingPeriod:'ask',top:5,others:true,variancePercent:true,totals:true,favourable:'neutral'};
const fields=['Group','Category','Tenant','Year','MonthIndex','Property'].map(name=>({name,table:'Data',column:name,type:['Year','MonthIndex'].includes(name)?'number':'text',values:name==='Category'?['Electronics']:[]}));
const config={table:'Parameter',column:'Parameter',enabled:true,options:fields.map(f=>f.name),fields,time:{monthIndexField:'MonthIndex'},analysis:{published:definition,revision:1}};
const parse=question=>planAnalysis(question,config,['Rent','Average Rent']);
assert.equal(parse('Rent by Group for June 2026'),undefined,'ordinary questions unchanged');
assert.equal(planAnalysis('Explain Rent for June 2026',{...config,analysis:{draft:definition}},['Rent']),undefined,'draft is not active');
assert.equal(parse('Explain Rent for June 2026').mode,'breakdown');
assert.equal(parse('Explain Rent variance for June 2026').comparison,'June 2025');
assert.equal(parse('Rent variance June 2026 versus May 2026').comparison,'May 2026','explicit comparison wins');
assert.equal(parse('Explain Rent June 2026 versus June 2025').mode,'variance','an explicit comparison must not be ignored in an explain question');
assert.equal(parse('Variance Rent for 2026').comparison,'2025');
assert.equal(parse('Variance Rent 2026 versus 2024').comparison,'2024');
assert.equal(parse('Variance Rent YTD ending June 2026').comparison,'YTD ending June 2025');
assert.equal(parse('Variance Rent YTD June 2026 versus June 2025').comparison,'YTD ending June 2025');
const loadedYears={...config,fields:fields.map(field=>field.name==='Year'?{...field,values:['2025','2026']}:field)};
assert.equal(planAnalysis('Explain Rent for June 2026',loadedYears,['Rent']).period,'June 2026','known year members do not hide periods');
const bound={...definition,binding:analysisBinding(fields,definition.hierarchy)};
assert.throws(()=>planAnalysis('Explain Rent for June 2026',{...config,fields:fields.map(field=>({...field,table:'OtherModel'})),analysis:{published:bound}},['Rent']),/different model columns/);
assert.equal(parse('Explain Rent by Category for June 2026').level,1);
assert.equal(parse('Variance of Category Electronics for June 2026').level,1);
assert.equal(parse('Explain Rent for June 2026 where Category = Electronics').level,1);
assert.throws(()=>parse('Explain Rent'),/Which period/);
assert.throws(()=>parse('Explain Rent before June 2026'),/safely interpret/);
assert.equal(planAnalysis('Explain Rent',{...config,analysis:{published:{...definition,missingPeriod:'last-month'}}},['Rent'],new Date(2026,0,15)).period,'December 2025');
assert.throws(()=>validateAnalysis({...definition,hierarchy:['Missing']},config.options,['Rent']),/hierarchy/);
assert.throws(()=>validateAnalysis({...definition,varianceKeywords:['explain']},config.options,['Rent']),/unique/);
assert.throws(()=>parse('Explain Rent for June 2026;analysisState:bad'),/Invalid analysis/);
const state=parse('Rent variance June 2026 versus June 2025 where Property = Mall');
assert.deepEqual(parse(analysisQuestion(state)),state,'drill state round trips');
const calls=[];
const current=[10,100,90,80,70,60,50],prior=[300,90,80,70,60,50,40];
const names=['A','B','C','D','E','F','G'];
const load=async plan=>{
  calls.push(plan);
  assert(plan.filters.some(filter=>filter.target.column==='Property'&&filter.values[0]==='Mall'),'retain unrelated filters');
  const months=plan.filters.find(filter=>filter.target.column==='MonthIndex').values;
  const values=months[0]===2026*12+6?current:prior;
  if(!plan.groups.length) {
    const members=plan.filters.find(filter=>filter.target.column==='Group')?.values||names;
    const total=members.reduce((sum,name)=>sum+values[names.indexOf(name)],0);
    return {text:'',modelQuery:true,table:{columns:['Rent'],rows:[[String(total)]],rowIndices:[[]],modelRawRows:[[total]],modelRawTotals:[total],modelEvaluatedTotals:[true]}};
  }
  return {text:'',modelQuery:true,table:{columns:[plan.groups[0],'Rent'],rows:names.map((name,i)=>[name,String(values[i])]),rowIndices:names.map(()=>[]),modelRawRows:values.map(value=>[null,value]),modelFormats:[undefined,'#,0']}};
};
(async()=>{
  const answer=await runAnalysis(state,config,['Rent'],load);
  assert.equal(answer.table.rows[0][0],'A','largest negative variance ranks first');
  assert.equal(answer.table.rows[0][3],'-290');
  assert.equal(answer.table.rows[5][0],'Others');
  assert.equal(answer.table.rows[5][1],'110');
  assert.equal(answer.table.rows[5][3],'+20','Others is signed difference, not sum of magnitudes');
  assert.equal(answer.table.modelTotals[3],'-230');
  assert.equal(answer.table.modelTotals[4],'-33.33%');
  assert(calls.some(plan=>!plan.groups.length && plan.filters.some(filter=>filter.target.column==='Group' && filter.values.join(',')==='F,G')),'Others evaluated over underlying remaining members');
  const child=parse(answer.analysis.rowQuestions[5]);
  assert.equal(child.level,1);
  assert.deepEqual(child.selections,[{field:'Group',values:['F','G']}]);
  assert(!JSON.stringify(child.selections).includes('Others'));
  const brokenTotal=async plan=>{const result=await load(plan);if(!plan.groups.length)result.table.modelEvaluatedTotals=[false];return result;};
  const safe=await runAnalysis(state,config,['Rent'],brokenTotal);
  assert.equal(safe.table.modelTotals[1],'—','never use summed fallback as a model-evaluated non-additive total');
  const zeroLoad=async plan=>{const result=await load(plan);result.table.modelRawRows=result.table.modelRawRows.map(row=>row.map(value=>value===null?null:0));return result;};
  const zero=await runAnalysis(state,config,['Rent'],zeroLoad);
  assert.equal(zero.table.rows[0][4],'—','zero comparison is undefined');
  console.log('Analysis template routing, periods, ranking, Others, filters and totals passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});

(async()=>{
 const {analysisDimensions}=require('../.tmp/test/analysisTemplates');
 const modern={...definition,consolidated:true,hierarchy:[],revenuePercent:true,excludedDimensions:['Property']};
 const modernConfig={...config,analysis:{published:modern},revenue:{field:'Group',value:'Revenue',childFields:['Category','Tenant']}};
 assert.deepEqual(analysisDimensions(modernConfig),['Group','Category','Tenant']);
 assert.deepEqual(analysisDimensions({...modernConfig,time:{...modernConfig.time,yearField:'Group',monthField:'Category'}}),['Tenant'],'custom time mappings are excluded automatically');
 assert.deepEqual(analysisDimensions({...modernConfig,fields:modernConfig.fields.map(field=>field.name==='Tenant'?{...field,type:'date'}:field)}),['Group','Category'],'typed dates are excluded even without a conventional name');
 const modernState=planAnalysis('Explain Rent variance for June 2026',modernConfig,['Rent']);
 let requests=0;
 const mock=async plan=>{
  requests++;
  const prior=plan.filters.find(f=>f.target.column==='MonthIndex').values[0]===2025*12+6;
  const revenue=plan.filters.some(f=>f.target.column==='Group'&&f.values.includes('Revenue'));
  const group=plan.groups[0];
  const names=group?['Revenue','Cost','Zero','', 'New']:[];
  const numbers=prior?[100,20,0,5,0]:[200,40,0,10,8];
  let ids=names.map((_,i)=>i);
  const selection=plan.filters.find(f=>f.target.column===group);
  if(selection)ids=ids.filter(i=>selection.values.includes(names[i]));
  const total=revenue?(prior?100:200):(prior?125:258);
  return {text:'',table:{columns:group?[group,'Rent']:['Rent'],rows:group?ids.map(i=>[names[i],String(numbers[i])]):[[String(total)]],rowIndices:group?ids.map(()=>[]):[[]],
   modelRawRows:group?ids.map(i=>[null,numbers[i]]):[[total]],modelRawTotals:group?[null,total]:[total],modelEvaluatedTotals:group?[false,true]:[true]}};
 };
 const result=await runAnalysis(modernState,modernConfig,['Rent'],mock);
 assert.equal(result.analysis.sections.length,3);
 assert.equal(result.table.modelTotals[1],'258');
 for(const section of result.analysis.sections){
  assert.equal(section.answer.table.modelTotals[1],'258','each section retains its model total');
  assert(!section.answer.table.rows.some(row=>row[0]==='Zero'));
  assert(section.answer.table.rows.some(row=>row[0]==='Unassigned'));
  assert(section.answer.analysis.blankRows.every(index=>section.answer.table.rows[index][0]==='Unassigned'));
  assert(section.answer.table.rows.some(row=>row[0]==='New'),'retain zero-to-value changes');
  const cost=section.answer.table.rows.find(row=>row[0]==='Cost');
  assert.equal(cost.at(-2),'20.00%');assert.equal(cost.at(-1),'20.00%');
 }
 const category=result.analysis.sections.find(section=>section.dimension==='Category');
 const next=planAnalysis(category.answer.analysis.rowQuestions[1],modernConfig,['Rent']);
 assert.equal(next.selections[0].field,'Category');
 assert(requests<20,'request-scoped cache shares denominator and scalar queries');
 const missing=await runAnalysis(modernState,{...modernConfig,revenue:undefined},['Rent'],mock);
 assert(missing.analysis.notes.some(note=>note.includes('Revenue percentages need')));
 console.log('Consolidated dimensions, shared totals, revenue periods, zero/blank handling and selection passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});

(async()=>{
 const autoConfig={...config,analysis:{published:{...definition,consolidated:undefined,hierarchy:[]}}};
 const migrated=planAnalysis('Explain Rent variance for June 2026',autoConfig,['Rent']);
 assert.equal(migrated.mode,'variance','existing enabled settings migrate without hierarchy setup');
 const dims=fields.filter(f=>['Group','Year','MonthIndex'].includes(f.name));
 const cfg={...config,options:dims.map(f=>f.name),fields:dims,revenue:{field:'Group',value:'Revenue'},analysis:{published:{...definition,consolidated:true,revenuePercent:true,hierarchy:[]}}};
 const state=planAnalysis('Explain Rent variance for June 2026',cfg,['Rent']);
 const loader=async plan=>{
  const prior=plan.filters.find(f=>f.target.column==='MonthIndex').values[0]===2025*12+6;
  const source=[['Revenue',prior?100:200],...Array.from({length:7},(_,i)=>['Cost '+i,prior?10:20+i])];
  const selected=plan.filters.filter(f=>f.target.column==='Group');
  const rows=source.filter(([name])=>selected.every(f=>f.values.includes(name)));
  const total=rows.reduce((sum,row)=>sum+row[1],0),grouped=plan.groups.length>0;
  return {text:'',table:{columns:grouped?['Group','Rent']:['Rent'],rows:grouped?rows.map(([name,value])=>[name,String(value)]):[[String(total)]],rowIndices:grouped?rows.map(()=>[]):[[]],modelRawRows:grouped?rows.map(row=>[null,row[1]]):[[total]],modelRawTotals:grouped?[null,total]:[total],modelEvaluatedTotals:grouped?[false,true]:[true]}};
 };
 const answer=await runAnalysis(state,cfg,['Rent'],loader);
 const others=answer.analysis.sections[0].answer.table.rows.find(row=>row[0]==='Others');
 assert.equal(others[1],'63');
 assert.equal(others.at(-2),'31.50%','Others uses combined amount over revenue, not a sum of member percentages');
 assert.equal(others.at(-1),'30.00%');
 console.log('Automatic settings migration and Others revenue evaluation passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});

(async()=>{
 const transactionFields=['Document ID','Posting Date','Description','Account'];
 const extra=transactionFields.map(name=>({name,table:'Data',column:name,type:'text'}));
 const cfg={...config,options:[...config.options,...transactionFields],fields:[...fields,...extra],analysis:{published:{...definition,consolidated:true,transactionFields}}};
 const {analysisDimensions}=require('../.tmp/test/analysisTemplates');
 assert(!analysisDimensions(cfg).some(name=>transactionFields.includes(name)),'transaction fields never scanned as dimensions');
 const state=planAnalysis('Explain Rent variance for June 2026 where Property = Mall',cfg,['Rent']);
 const requests=[];
 const detailState={...state,selections:[{field:'Group',values:['A','B']}],transactions:'both'};
 const validated=planAnalysis(analysisQuestion(detailState),cfg,['Rent']);
 const answer=await runAnalysis(validated,cfg,['Rent'],async plan=>{
  requests.push(plan);
  assert.deepEqual(plan.groups,transactionFields);
  assert(plan.filters.some(f=>f.target.column==='Property'&&f.values.includes('Mall')));
  assert(plan.filters.some(f=>f.target.column==='Group'&&f.values.join(',')==='A,B'),'Others uses its members');
  return {text:'',table:{columns:[...transactionFields,'Rent'],rows:[['INV1','2026-06-01','Entry','Rent','42']],rowIndices:[[]]}};
 });
 assert.equal(requests.length,2,'only two transaction requests for both periods; no dimension scan');
 assert.equal(answer.table.rows.length,2);
 assert.deepEqual(answer.table.rows.map(row=>row[0]),['June 2026','June 2025']);
 requests.length=0;
 await runAnalysis({...validated,transactions:'comparison'},cfg,['Rent'],async plan=>{requests.push(plan);return {text:'',table:{columns:[],rows:[],rowIndices:[]}};});
  assert.equal(requests.length,1);
 await runAnalysis({...validated,transactions:'current',selections:[{field:'Group',values:['—'],blank:true}]},cfg,['Rent'],async plan=>{
  assert.deepEqual(plan.filters.find(f=>f.target.column==='Group').values,[null],'blank members must not become literal dash values');
  return {text:'',table:{columns:[],rows:[],rowIndices:[]}};
 });
 assert.equal(requests[0].filters.find(f=>f.target.column==='MonthIndex').values[0],2025*12+6);
 await assert.rejects(()=>runAnalysis(detailState,{...cfg,analysis:{published:{...cfg.analysis.published,transactionFields:[]}}},['Rent'],async()=>{throw new Error('must not query')}),/one to four/);
 assert.throws(()=>planAnalysis(analysisQuestion({...detailState,transactions:'bad'}),cfg,['Rent']),/no longer matches/);
 console.log('On-demand transactions, configured fields, period scope and member filters passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});

(async()=>{
 const dims=fields.filter(f=>['Group','Year','MonthIndex'].includes(f.name));
 const cfg={...config,fields:dims,options:dims.map(f=>f.name),additiveMeasures:['Rent'],analysis:{published:{...definition,consolidated:true,hierarchy:[],hideUnchanged:true}}};
 const state=planAnalysis('Explain Rent variance for June 2026',cfg,['Rent']);
 const records=[['A',200],['B',-120],['C',-80],['D',30],['E',-30],['F',10],['G',-10],['H',0],['',20]];
 let calls=0;
 const loader=(mode='normal')=>async plan=>{
  calls++;
  const prior=plan.filters.find(f=>f.target.column==='MonthIndex').values[0]===2025*12+6;
  const selection=plan.filters.find(f=>f.target.column==='Group');
  const selected=records.filter(([name])=>!selection||selection.values.includes(name));
  const amounts=selected.map(([name,delta])=>mode==='missing'&&name==='B'?null:1000+(prior||mode==='zero'?0:delta));
  return {text:'',table:{columns:['Group','Rent'],rows:selected.map(([name],i)=>[name,String(amounts[i])]),rowIndices:selected.map(()=>[]),modelRawRows:amounts.map(value=>[null,value]),modelRawTotals:[null,amounts.reduce((sum,value)=>sum+(value||0),0)],modelEvaluatedTotals:[false,true]}};
 };
 const answer=await runAnalysis(state,cfg,['Rent'],loader());
 const table=answer.analysis.sections[0].answer.table,col=table.columns.indexOf('Impact %');
 assert.equal(col,table.columns.indexOf('Variance %')+1);
 assert.equal(table.rows.find(row=>row[0]==='A')[col],'40.00%');
 assert.equal(table.rows.find(row=>row[0]==='Others')[3],'0');
 assert.equal(table.rows.find(row=>row[0]==='Others')[col],'4.00%','offsetting members still contribute absolute movement');
 assert.equal(table.rows.find(row=>row[0]==='Unassigned')[col],'4.00%','hidden blank remains in denominator');
 assert.equal(table.modelTotals[col],'100.00%');
 assert.equal(answer.table.modelTotals[col],'—','overall has no dimension-specific denominator');
 assert.equal(calls,2,'Impact requires no additional model queries');
 const filtered=await runAnalysis({...state,selections:[{field:'Group',values:['A','B']}]},cfg,['Rent'],loader());
 assert.equal(filtered.analysis.sections[0].answer.table.rows.find(row=>row[0]==='A')[col],'62.50%');
 const zero=await runAnalysis(state,{...cfg,analysis:{published:{...cfg.analysis.published,hideUnchanged:false}}},['Rent'],loader('zero'));
 assert.equal(zero.analysis.sections[0].answer.table.rows[0][col],'—');
 const missing=await runAnalysis(state,cfg,['Rent'],loader('missing'));
 assert(missing.analysis.sections[0].answer.table.rows.every(row=>row[col]==='—'),'unknown movement cannot yield misleading percentages');
 console.log('Impact percentages: absolute movement, offsetting Others, hidden blanks, filters, zero and missing data passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
