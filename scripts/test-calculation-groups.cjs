const assert=require('node:assert/strict');
const {parseCalculation,formatCalculation,evaluateCalculation,calculationDiagnostic,calculationFilterCompletion}=require('../.tmp/test/calculationFormula');
const {calculationScope,calculationDays}=require('../.tmp/test/calculationContext');
const {validateCalculationGroups,allCustomKpis,expandCalculationGroups,calculationQuestionTokens,remapCalculation,calculationReferences}=require('../.tmp/test/calculationGroups');
const {customKpiRequest}=require('../.tmp/test/customKpis');
const {reviewBackup,mergeBackup}=require('../.tmp/test/qna/settingsBackup');
const {calculationTooltipSummary}=require('../.tmp/test/qna/calculationTooltip');
const simpleNotes=['Rent Measure = 454892', "Context: Year: 2025; Assigned Tenant Name = 'Nova Fashion'", 'Nova Fashion → 454892', 'Result: 454892'];
assert.deepEqual(calculationTooltipSummary('NOVA','2025','454,892.00',simpleNotes),['NOVA · 2025','454,892.00','Rent Measure',"Assigned Tenant Name = 'Nova Fashion'"]);
const ratioNotes=['Rental = 100','Context: Year = 2026','EBITDA = 500','Context: Year = 2025','/ → 0.2','  Rental → 100','  EBITDA → 500','Result: 0.2'];
const ratioHover=calculationTooltipSummary('Margin','2026','20.00%',ratioNotes);
assert.equal(ratioHover.filter(s=>s.startsWith('Result:')).length,1);assert(ratioHover.includes('Numerator: Rental = 100'));assert(ratioHover.includes('Denominator: EBITDA = 500'));assert(ratioHover.includes('EBITDA: Year = 2025'));
assert(calculationTooltipSummary('Margin','2026','Unavailable',['Unavailable: Missing field']).includes('Unavailable: Missing field'));
assert(!calculationTooltipSummary('Growth','2026','50.00%',['* → 0.5','  / → 0.005','    Rental → 100','  literal → 100','Result: 0.5']).some(s=>s.startsWith('Numerator:')),'Do not mislabel a compound expression as a simple ratio');
const measure={id:'ratio',name:'Rental ratio',description:'',formula:"('Rental') / ('EBITDA')",enabled:true,format:'number',decimals:2,total:'recalculate'};
const groups=[{version:1,id:'finance',name:'Finance',description:'',enabled:true,measures:[measure]}];
const config={table:'P',column:'F',enabled:true,options:['Property','Year','Month','Date'],fields:[{name:'Property',table:'T',column:'Property',type:'text'},{name:'Year',table:'T',column:'Year',type:'number'},{name:'Month',table:'T',column:'Month',type:'text'},{name:'Date',table:'T',column:'Date',type:'date'}],directMeasures:['Rental','EBITDA'],time:{yearField:'Year',monthField:'Month',dateField:'Date'},calculationGroups:groups,customKpis:allCustomKpis({calculationGroups:groups})};
// Names-first drafts persist without executable formulas and cannot enter answers/dependencies.
const draft={...measure,id:'draft',name:'Planned KPI',formula:'',enabled:false};
const draftGroups=structuredClone(groups);draftGroups[0].measures.push(draft);
validateCalculationGroups(draftGroups,['Rental','EBITDA'],config.options);
const draftBackup=reviewBackup(JSON.stringify({format:'askBICS-settings',version:1,layout:{calculationGroups:draftGroups}}),config.options,['Rental','EBITDA']);assert.equal(draftBackup.blocked,false);assert.deepEqual(draftBackup.accepted.calculationGroups,draftGroups);
const {compileKpis}=require('../.tmp/test/customKpis');const compiledDrafts=compileKpis(allCustomKpis({calculationGroups:draftGroups}),['Rental','EBITDA']);assert(!compiledDrafts.names.includes('Planned KPI'));assert.deepEqual(calculationReferences(''),[]);
assert(!expandCalculationGroups('#Finance',draftGroups).includes('Planned KPI'));
const enabledDraft=structuredClone(draftGroups);enabledDraft[0].measures[1].enabled=true;assert.throws(()=>validateCalculationGroups(enabledDraft,['Rental','EBITDA'],config.options),/Add a formula/);assert.throws(()=>compileKpis(allCustomKpis({calculationGroups:enabledDraft}),['Rental','EBITDA']),/Add a formula/);
const dependentDraft=structuredClone(draftGroups);dependentDraft[0].measures[0].formula='@[Planned KPI]';assert.throws(()=>validateCalculationGroups(dependentDraft,['Rental','EBITDA'],config.options),/Dependency is disabled/);
const filter=(name,values)=>({target:{table:'T',column:name},operator:'In',values});
const plan={groups:['Property'],measures:['Rental ratio'],filters:[filter('Year',[2026])],summary:[]};
validateCalculationGroups(groups,['Rental','EBITDA'],config.options);
// Paired apostrophes are alternate delimiters, including filters and names with apostrophes.
const astMeaning=s=>JSON.parse(JSON.stringify(parseCalculation(s),(k,v)=>k==='at'?undefined:v));
for(const [alternate,ordinary] of [
 ["(''Rental'')", "('Rental')"],
 ["(''Rental'', [Property] = ''Home Living'')", "('Rental', [Property] = 'Home Living')"],
 ["(''Rental'' + 'EBITDA', [Property] IN (''A'', 'B'))", "('Rental' + 'EBITDA', [Property] IN ('A', 'B'))"],
 ["(''O'Brien'')", "('O''Brien')"],
 ["(''O''Brien'')", "('O''Brien')"],
 ['("Rental")', "('Rental')"]
]){assert.deepEqual(astMeaning(alternate),astMeaning(ordinary));assert.deepEqual(astMeaning(formatCalculation(alternate)),astMeaning(ordinary));}
assert.deepEqual(astMeaning("COALESCE('', 'O''Brien')"),{kind:'call',name:'COALESCE',args:[{kind:'literal',value:''},{kind:'literal',value:"O'Brien"}]});
assert.throws(()=>parseCalculation("(''Rental')"),/Unclosed/);
assert.equal(remapCalculation("(''Rental'', [Property] = ''Rental'')",new Map([['Rental','Rent']])),"('Rent', [Property] = ''Rental'')");

assert.equal(expandCalculationGroups('show #Finance by Property',groups),'show Rental ratio by Property');
assert.equal(expandCalculationGroups('show #calc[finance]',groups),'show Rental ratio');
assert.equal(expandCalculationGroups('show #metric[ratio]',groups),'show Rental ratio');
assert.equal(calculationQuestionTokens('show #Rental ratio by Property',groups),'show #metric[ratio] by Property');
assert.equal(calculationQuestionTokens('show #Finance by Property',groups),'show #calc[finance] by Property');
assert.equal(remapCalculation("('Rental', [Property] = 'Rental') // Rental",new Map([['Rental','Rent'],['Property','Building']])),"('Rent', [Building] = 'Rental') // Rental");
assert.throws(()=>calculationScope(plan,config,parseCalculation("('Rental', [Year] NOT IN (2025,2026) OR [Year] = 2028)").filters),/cannot be safely translated/);

assert.throws(()=>parseCalculation('new Function(1)'),/Unexpected|Expected/);
assert.throws(()=>parseCalculation("('Rental', [Year] = 2026"),/Expected/);
const formatted=formatCalculation("// keep this\n('Rental',[Year]=2026)/('EBITDA',[Year]=2025)");assert(formatted.includes('// keep this'));
assert.equal(calculationDiagnostic('1\n+',new Error('failure')).includes('Line 1'),true);
const scoped=calculationScope(plan,config,parseCalculation("('Rental', [Year] = 2025)").filters);assert.equal(scoped.filters.length,1);assert.equal(scoped.filters[0].conditions[0].value,2025);assert.equal(plan.filters[0].values[0],2026);
assert.equal(calculationDays({...plan,filters:[filter('Year',[2026]),filter('Month',['Aug'])]},config),31);
assert.equal(calculationDays({...plan,filters:[filter('Year',[2028]),filter('Month',['Feb'])]},config),29);
assert.equal(calculationDays(plan,config),365);
assert.equal(calculationDays({...plan,filters:calculationScope({...plan,filters:[]},config,parseCalculation("('Rental', [Date] BETWEEN '2026-08-10' AND '2026-08-20')").filters).filters},config),11);
assert.throws(()=>calculationDays({...plan,filters:[]},config),/explicit/);
for(const clause of ['[Year] >= 2026', "[Date] >= '2026-08-10'"]){const scoped=calculationScope({...plan,filters:[]},config,parseCalculation("('Rental', "+clause+")").filters);assert.throws(()=>calculationDays(scoped,config),/finite/);}
assert.equal(calculationDays(calculationScope({...plan,filters:[]},config,parseCalculation("('Rental', [Year] >= 2026, [Year] <= 2027)").filters),config),730);

const cycle=structuredClone(groups);cycle[0].measures[0].formula='@[Rental ratio]';assert.throws(()=>validateCalculationGroups(cycle,['Rental','EBITDA'],config.options),/Circular/);
const pairedBackup={format:'askBICS-settings',version:1,layout:{calculationGroups:structuredClone(groups)}};pairedBackup.layout.calculationGroups[0].measures[0].formula="(''Rental'') / ('EBITDA')";assert.equal(reviewBackup(JSON.stringify(pairedBackup),config.options,['Rental','EBITDA']).accepted.calculationGroups[0].measures[0].formula,pairedBackup.layout.calculationGroups[0].measures[0].formula);
const backup={format:'askBICS-settings',version:1,layout:{calculationGroups:groups}};assert.equal(reviewBackup(JSON.stringify(backup),config.options,['Rental','EBITDA']).blocked,false);assert.equal(mergeBackup({},backup.layout,false).calculationGroups.length,1);
(async()=>{
 const {calculationView}=require('../.tmp/test/calculationRequest');
 const dynamic=structuredClone(config);dynamic.fields=[{name:'Tenant',table:'T',column:'tenant_id',type:'text'},{name:'Department',table:'T',column:'dept_id',type:'text'}];
 dynamic.customKpis[0].calculation.defaultMeasure='Rental';
 let ambiguous=false,incomplete=false;const seen=[];
 const dynamicLoad=async p=>{seen.push(p);const field=p.groups[0];const labels=field==='Tenant'||(ambiguous&&field==='Department')?["Home Living"]:[];const rows=field?labels.map(v=>[v,...p.measures.map(()=>100)]):[p.measures.map(()=>100)];return {table:{columns:[...p.groups,...p.measures],rows,modelRawRows:rows,modelGroupValues:labels.map(v=>[v]),modelResultComplete:!incomplete}};};
 const executeDynamic=async formula=>{dynamic.customKpis[0].formula=dynamic.customKpis[0].calculation.formula=formula;return calculationView({...plan,groups:[],filters:[]},dynamic,dynamicLoad,['Rental','Service Charge','EBITDA']);};
 let pairedResult=await executeDynamic("(''home living'')");assert.equal(pairedResult.view.table.rows[0][0],100);
 let result=await executeDynamic("('home living')");assert.equal(result.view.table.rows[0][0],100);assert(seen.some(p=>p.filters.some(f=>f.target.column==='tenant_id')));
 ambiguous=true;result=await executeDynamic("('Home Living')");assert([...result.explanations.values()].flat().some(v=>v.includes('Ambiguous value')&&v.includes('[Department]')));ambiguous=false;
 result=await executeDynamic("('Rental' + 'Service Charge', [Tenant] IN ('Home Living', 'IKEA')) / ('EBITDA', [Department] != 'HR')");assert.equal(result.view.table.rows[0][0],2);
 const hover=[...result.explanations.values()].flat().join('\n');
 assert(hover.includes("Tenant IN ('Home Living', 'IKEA')"));
 assert(hover.includes("Department ≠ 'HR'"));
 assert(!hover.includes('$schema')&&!hover.includes('tenant_id'),'Hover uses display field names, not filter JSON');
 const {calculationFilterLabels}=require('../.tmp/test/calculationRequest');
 assert.deepEqual(calculationFilterLabels(calculationScope(plan,config,parseCalculation("('Rental', [Year] BETWEEN 2025 AND 2026)").filters).filters,config),['Year ≥ 2025 AND Year ≤ 2026']);
 assert(seen.some(p=>p.measures.includes('Service Charge')&&p.filters.some(f=>f.operator==='In'&&f.values.includes('IKEA'))));
 result=await executeDynamic("('Rental', [Tenant] NOT IN ('Home O''Brien', 'Shop #2 / A&B'))");assert.equal(result.view.table.rows[0][0],100);
 result=await executeDynamic("('Missing value')");assert([...result.explanations.values()].flat().some(v=>v.includes('unavailable in accessible data')));
 seen.length=0;
 result=await executeDynamic("('Home Living')");
 assert.equal(result.view.table.rows[0][0],100);
 assert.equal(seen.filter(p=>!p.groups.length).length,1,'Only the anchor needs a scalar query; reuse exact singleton discovery for operand and total');
 dynamic.customKpis[0].calculation.defaultField='Tenant';seen.length=0;
 result=await executeDynamic("('Home Living')");
 assert.equal(result.view.table.rows[0][0],100);
 assert.equal(seen.length,2,'Configured shorthand needs only anchor and filtered measure, reused for total');
 assert(seen.every(p=>!p.groups.length),'No field-member discovery with an explicit default field');
 seen.length=0;
 result=await executeDynamic("('Home Living') + ('Service Charge', [Tenant] = 'Home Living')");
 assert.equal(result.view.table.rows[0][0],200);
 assert.equal(seen.length,2);
 assert(seen.some(p=>p.filters.length&&p.measures.includes('Rental')&&p.measures.includes('Service Charge')),'Shorthand and explicit operands with identical context share one request');
 dynamic.customKpis[0].calculation.defaultField='Deleted field';seen.length=0;
 result=await executeDynamic("('Home Living')");
 assert([...result.explanations.values()].flat().some(v=>v.includes('Unavailable default field')));
 assert.equal(seen.length,1,'Invalid defaults never trigger a scan of other fields');
 delete dynamic.customKpis[0].calculation.defaultField;
 incomplete=true;await assert.rejects(()=>executeDynamic("('Home Living')"),/incomplete/);
 const rt={metric:async()=>1,reference:async()=>2,days:async()=>31};
 for(const [source,value] of [['2+3*4',14],['IF(2>1, 7, 1/0)',7],['DIVIDE(1,0)',null],['DAYSINMONTH(2028,2)',29],['DAYSINYEAR(2026)',365],['DATEDIFF(\'2026-08-10\',\'2026-08-20\')',10],['WORKDAYS(\'2026-08-10\',\'2026-08-14\')',5],['ROUND(1234,-2)',1200]])assert.equal(await evaluateCalculation(parseCalculation(source),rt),value,source);
 let queries=0,view;
 const load=async p=>{queries++;const values=p.measures.map(name=>name==='Rental'?[100000,300000]:[50000,100000]);const rows=p.groups.length?['A','B'].map((label,i)=>[label,...values.map(v=>v[i])]):[values.map(v=>v[0]+v[1])];return {text:'',table:{columns:[...p.groups,...p.measures],rows:rows.map(r=>r.map(String)),rowIndices:rows.map(()=>[]),modelResultComplete:true,modelRawRows:rows.map(r=>r.map(v=>typeof v==='number'?v:null)),modelGroupValues:p.groups.length?[['A'],['B']]:[[]]}};};
 await customKpiRequest(plan,config,['Rental','EBITDA'],load,v=>{view=v;return {text:''};});
 assert.deepEqual(view.table.rows,[['A',2],['B',3]]);assert.equal(view.table.totals[1],400000/150000);assert.equal(queries,2,'One combined grouped request and one combined total-context request');
 queries=0;
 await customKpiRequest(plan,config,['Rental','EBITDA'],async p=>{const result=await load(p);result.table.modelRawTotals=[null,...p.measures.map(n=>n==='Rental'?400000:150000)];result.table.modelEvaluatedTotals=[false,...p.measures.map(()=>true)];return result;},v=>{view=v;return {text:''};});
 assert.equal(queries,1,'Reuse explicitly model-evaluated totals from the grouped response');
 assert.equal(view.table.totals[1],400000/150000,'Recalculate the ratio using raw model totals, not row ratios');
 queries=0;
 await customKpiRequest(plan,config,['Rental','EBITDA'],async p=>{const result=await load(p);result.table.modelRawTotals=[null,...p.measures.map(()=>999)];result.table.modelEvaluatedTotals=[false,...p.measures.map(()=>false)];return result;},v=>{view=v;return {text:''};});
 assert.equal(queries,2,'Unverified or summed fallback totals must still trigger total-context evaluation');
 assert.equal(view.table.totals[1],400000/150000);
 const cached = await customKpiRequest(plan,config,['Rental','EBITDA'],load,v=>({text:'',table:{columns:v.table.columns.map(c=>c.displayName),rows:v.table.rows.map(r=>r.map(String)),rowIndices:v.table.rows.map(()=>[]),modelGroupValues:[['A'],['B']]}}));
 const cloned=structuredClone(cached);assert.deepEqual(cloned.table.columns,['Property','Calculation','Value']);assert(cloned.table.calculationNotes['0:2'].length);assert.equal(cloned.table.calculationDetails,undefined);
 const invalidContext=structuredClone(config);invalidContext.customKpis[0].formula=invalidContext.customKpis[0].calculation.formula='DAYS()';
 const failed=await customKpiRequest({...plan,groups:[],filters:[]},invalidContext,['Rental','EBITDA'],load,()=>({text:'',kpi:{title:'Rental ratio',value:'—'}}));
 assert.equal(failed.kpi.value,'Unavailable');assert.match(failed.kpi.subtitle,/Unavailable:/);
 config.customKpis[0].calculation.total='hide';await customKpiRequest(plan,config,['Rental','EBITDA'],load,v=>{view=v;return {text:''};});assert.equal(view.table.totals[1],null);
 config.customKpis[0].calculation.total='custom';config.customKpis[0].calculation.totalFormula="('Rental')";await customKpiRequest(plan,config,['Rental','EBITDA'],load,v=>{view=v;return {text:''};});assert.equal(view.table.totals[1],400000);
 await assert.rejects(()=>customKpiRequest(plan,config,['Rental','EBITDA'],async p=>{const r=await load(p);r.table.modelResultComplete=false;return r;},()=>({text:''})),/incomplete/);
 await assert.rejects(()=>customKpiRequest(plan,config,['Rental','EBITDA'],async p=>{const r=await load(p);delete r.table.modelResultComplete;return r;},()=>({text:''})),/completeness is unknown/);
 const independent=structuredClone(config);independent.customKpis[0].calculation.total='recalculate';independent.customKpis[0].formula=independent.customKpis[0].calculation.formula="('Rental', [Year] = 2026) / ('EBITDA', [Year] = 2025)";
 const scopes=[];await customKpiRequest(plan,independent,['Rental','EBITDA'],async p=>{scopes.push(p);return load(p);},v=>{view=v;return {text:''};});
 assert.equal(view.table.totals[1],400000/150000);
 assert(scopes.some(p=>p.measures[0]==='Rental'&&p.filters.some(f=>f.conditions?.[0]?.value===2026)));
 assert(scopes.some(p=>p.measures[0]==='EBITDA'&&p.filters.some(f=>f.conditions?.[0]?.value===2025)));
 assert(!scopes.some(p=>p.measures[0]==='EBITDA'&&p.filters.some(f=>f.conditions?.[0]?.value===2026)));
 assert(scopes.filter(p=>p.filters.some(f=>f.conditions)).every(p=>p.measures.length===1),'Different years must never be merged into a shared filter context');

 const combined=structuredClone(config);combined.customKpis[0].calculation.total='recalculate';
 const names=['Rental','ServiceCharge','EBITDA'];const received=[];
 const model=async p=>{
  received.push(p);
  const yearFilter=p.filters.find(f=>f.target.column==='Year'),year=yearFilter?.conditions?.[0]?.value??yearFilter?.values?.[0];
  const values=p.measures.map(name=>name==='Rental'?(year===2026?[100,300]:[1000,3000]):name==='ServiceCharge'?(year===2025?[20,40]:[2,4]):year===2024?[50,100]:[500,1000]);
  const rows=p.groups.length?['A','B'].map((label,i)=>[label,...values.map(v=>v[i])]):[values.map(v=>v[0]+v[1])];
  return {text:'',table:{columns:[...p.groups,...p.measures],rows:rows.map(r=>r.map(String)),rowIndices:rows.map(()=>[]),modelResultComplete:true,modelRawRows:rows.map(r=>r.map(v=>typeof v==='number'?v:null)),modelGroupValues:p.groups.length?[['A'],['B']]:[[]]}};
 };
 const outer={...plan,filters:[filter('Year',[2027]),filter('Month',['Sep']),filter('Property',['A','B'])]};
 const execute=async formula=>{received.length=0;combined.customKpis[0].formula=combined.customKpis[0].calculation.formula=formula;await customKpiRequest(outer,combined,names,model,v=>{view=v;return {text:''};});return view;};
 await execute("(Rental + (ServiceCharge, [Year] = 2025), [Year] = 2026, [Month] = 'Aug') / (EBITDA, [Year] = 2024)");
 assert.deepEqual(view.table.rows,[['A',2.4],['B',3.4]]);assert.equal(view.table.totals[1],460/150);
 const scopedRequests=received.filter(p=>p.filters.some(f=>f.conditions));
 for(const p of scopedRequests){const y=p.filters.find(f=>f.target.column==='Year');assert.equal(y.conditions[0].value,{Rental:2026,ServiceCharge:2025,EBITDA:2024}[p.measures[0]]);assert(p.filters.some(f=>f.target.column==='Property'),'Different-field inheritance');const month=p.filters.find(f=>f.target.column==='Month');assert.equal(month.conditions?.[0]?.value??month.values?.[0],p.measures[0]==='EBITDA'?'Sep':'Aug');}
 await execute("(((Rental - (ServiceCharge, [Year] = 2025)) * 2 / 4, [Year] = 2026), [Year] = 2028, [Month] = 'Aug')");
 assert.deepEqual(view.table.rows,[['A',40],['B',130]]);assert.equal(view.table.totals[1],170);
 await execute("((('Rental', [Year] = 2026) + ServiceCharge, [Month] = 'Aug'), [Year] = 2025)");
 assert.equal(view.table.totals[1],460,'Legacy scoped syntax inside combined filters');
 await execute("(Rental + ServiceCharge, [Year] BETWEEN 2026 AND 2027, [Month] IN ('Aug','Sep'), [Property] = 'A' OR [Property] = 'B')");
 assert(received.filter(p=>p.filters.some(f=>f.conditions)).every(p=>p.measures.includes('Rental')&&p.measures.includes('ServiceCharge')),'Shared filtered operands use a combined request');
 assert(received.some(p=>p.filters.some(f=>f.logicalOperator==='Or')));assert(received.some(p=>p.filters.some(f=>f.operator==='In'&&f.target.column==='Month')));
 await execute("(Rental + DAYS(), [Year] = 2028, [Month] = 'Feb')");assert.equal(view.table.totals[1],4029,'DAYS inherits its enclosing expression context');
 const shared="// shared context\n(Rental + (ServiceCharge, [Year] = 2025), [Year] = 2026) / (EBITDA, [Year] = 2024)";
 assert.equal(parseCalculation(shared).left.kind,'filtered');assert(formatCalculation(shared).includes('// shared context'));
 assert.deepEqual(calculationFilterCompletion('(Rental + (ServiceCharge, [Year] = 2025), ').usedFields,[]);
 assert.equal(calculationFilterCompletion('DIVIDE(Rental, '),undefined);
 assert.equal(calculationFilterCompletion('(Rental, [Year] IN (2025, '),undefined);
 assert.throws(()=>parseCalculation('(Rental + EBITDA, 2026)'),/field predicate/);
 assert.throws(()=>parseCalculation('(Rental + EBITDA, [Year] = )'),/Expected/);
 assert.throws(()=>parseCalculation('(Rental + EBITDA, [Year] = 2026,)'),/predicate/);
 assert.throws(()=>parseCalculation('('.repeat(110)+'Rental'+')'.repeat(110)),/nesting/);
 const renamed=remapCalculation('(Rental + EBITDA, [Year] = 2026)',new Map([['Rental','Rent Amount']]));assert(renamed.includes("('Rent Amount')"));
 const nestedCycle=structuredClone(groups);nestedCycle[0].measures[0].formula='(Rental + @[Rental ratio], [Year] = 2026)';assert.throws(()=>validateCalculationGroups(nestedCycle,names,config.options),/Circular/);
 const many=structuredClone(config),manyNames=Array.from({length:17},(_,i)=>'M'+i),batches=[];
 many.customKpis[0].formula=many.customKpis[0].calculation.formula=manyNames.map(n=>"('"+n+"')").join(' + ');
 many.customKpis[0].calculation.total='recalculate';
 const batched=await calculationView({...plan,groups:[]},many,async p=>{batches.push(p);return {table:{columns:p.measures,rows:[p.measures.map(()=>1)],modelRawRows:[p.measures.map(()=>1)],modelResultComplete:true}};},manyNames);
 assert.equal(batched.view.table.rows[0][0],17);assert.equal(batched.view.table.totals[0],17);
 assert.deepEqual(batches.map(p=>p.measures.length),[16,1],'Batch size respects host limits and reuses identical scalar contexts');
 console.log('Calculation groups: parser, contexts, leap dates, dependencies, persistence, cache reuse and non-additive totals passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});

const {calculationItemFilter}=require('../.tmp/test/calculationItemFilter');
const optimization=calculationItemFilter(`VAR __DS0FilterTable =
 TREATAS({"Optimization"}, 'Field Optimization'[Calculation group column])`);
assert.deepEqual(optimization.target,{table:'Field Optimization',column:'Calculation group column'});
assert.deepEqual(optimization.values,['Optimization']);
assert.equal(optimization.displaySettings.isHiddenInViewMode,true);
assert.equal(calculationItemFilter('  '),undefined);
assert.throws(()=>calculationItemFilter('EVALUATE ROW("x",1)'),/TREATAS/);