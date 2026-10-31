const assert=require('node:assert/strict');
const {compileKpis,customKpiRequest}=require('../.tmp/test/customKpis');
const definition={id:'ratio',name:'Rent ratio',formula:'DIVIDE([Rent], [Sales])',format:'percentage',decimals:2,enabled:true};
const compiled=compileKpis([definition,{...definition,id:'nested',name:'Double ratio',formula:'[Rent ratio] * 2'}],['Rent','Sales']);
assert.deepEqual(compiled.bases(['Double ratio','Rent']),['Rent','Sales']);
assert.equal(compiled.evaluate('Double ratio',new Map([['Rent',20],['Sales',100]])),.4);
assert.equal(compiled.evaluate('Rent ratio',new Map([['Rent',20],['Sales',0]])),null);
assert.throws(()=>compileKpis([{...definition,formula:'[Missing]'}],['Rent','Sales']),/Unknown measure/);
assert.throws(()=>compileKpis([{...definition,formula:'[Rent ratio]'}],['Rent','Sales']),/Circular/);
assert.throws(()=>compileKpis([{...definition,formula:'[Rent] +'}],['Rent','Sales']),/Incomplete/);
assert.throws(()=>compileKpis([{...definition,name:'Rent'}],['Rent','Sales']),/Duplicate/);
(async()=>{
 const filter={target:{table:'T',column:'City'},operator:'In',values:['A']};
 const plan={groups:['City'],measures:['Rent ratio'],filters:[filter],summary:[],rank:{count:1,ascending:false}};
 const config={customKpis:[definition],fields:[{name:'City',table:'T',column:'City'}]};
 let rendered;
 await customKpiRequest(plan,config,['Rent','Sales'],async p=>{assert.deepEqual(p.measures,['Rent','Sales']);assert.deepEqual(p.filters,[filter]);assert.equal(p.rank,undefined);return {text:'',table:{columns:['City','Rent','Sales'],rows:[['A','10','100'],['B','90','300']],modelRawRows:[[null,10,100],[null,90,300]],rowIndices:[[],[]],modelRawTotals:[null,100,400],modelEvaluatedTotals:[false,true,true]}};},(view,p)=>{rendered=view;assert.deepEqual(p.rank,plan.rank);return {text:''};});
 assert.deepEqual(rendered.table.rows,[['A',.1],['B',.3]]);assert.equal(rendered.table.totals[1],.25,'total must be ratio of model totals, not .4 sum of rows');
 assert.equal(rendered.table.columns[1].format,'#,0.00%');
 console.log('Custom KPIs: dependencies, validation, zero division, unrounded values, filters, ranking scope and non-additive totals passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
(async()=>{
 const {FieldParameterTrial}=require('../.tmp/test/fieldParameterTrial');
 const trial=Object.create(FieldParameterTrial.prototype);trial.measures=['Rent','Sales'];trial.customKpis=()=>[definition];trial.questionRevision=0;trial.cancel=()=>{};trial.automaticEnabled=()=>true;
 const cfg={table:'Fields',column:'Field',options:['Group','Year','MonthIndex'],fields:[{name:'Group',table:'T',column:'Group',type:'text'},{name:'Year',table:'T',column:'Year',type:'number'},{name:'MonthIndex',table:'T',column:'MonthIndex',type:'number'}],time:{yearField:'Year',monthIndexField:'MonthIndex'},customKpis:[definition],enabled:true};
 trial.readConfig=()=>structuredClone(cfg);const plans=[];
 trial.requestBase=async p=>{plans.push(p);assert.deepEqual(p.measures,['Rent','Sales']);const group=p.groups.length;return {text:'',table:{columns:[...p.groups,'Rent','Sales'],rows:[[...p.groups.map(()=> 'A'),'120','600']],rowIndices:[[]],modelRawRows:[[...p.groups.map(()=>null),120,600]],modelRawTotals:[...p.groups.map(()=>null),120,600],modelEvaluatedTotals:[...p.groups.map(()=>false),true,true]}};};
 const ytd=await trial.executeQuestion('Rent ratio YTD June 2026');assert.equal(ytd.kpi.value,'20.00%');
 assert.equal(plans[0].filters.find(f=>f.target.column==='MonthIndex').values.length,6);
 plans.length=0;const ttm=await trial.executeQuestion('Rent ratio TTM June 2026');assert.equal(ttm.kpi.value,'20.00%');assert.equal(plans[0].filters.find(f=>f.target.column==='MonthIndex').values.length,12);
 cfg.analysis={published:{consolidated:true,measure:'Rent ratio',hierarchy:[],breakdownKeywords:['explain'],varianceKeywords:['variance'],comparison:'prior-year',missingPeriod:'ask',top:10,others:true,variancePercent:true,totals:true,favourable:'neutral'}};
 plans.length=0;const analysis=await trial.executeQuestion('Explain Rent ratio variance for June 2026');assert.ok(analysis.analysis);assert(plans.some(p=>p.filters.some(f=>f.target.column==='MonthIndex'&&f.values.includes(2025*12+6))));
 console.log('Power BI Custom KPI query adapter: YTD, TTM and Explain variance use dependency measures in each period.');
})().catch(e=>{console.error(e);process.exitCode=1;});

assert.throws(()=>compileKpis([{...definition,filters:[{field:'City',values:[]}]}],['Rent','Sales']),/Invalid KPI filters/);
const {reviewBackup}=require('../.tmp/test/qna/settingsBackup');
const kpiBackup={format:'askBICS-settings',version:1,layout:{customKpis:[{...definition,filters:[{field:'City',values:['A','B']}]}]}};
assert.equal(reviewBackup(JSON.stringify(kpiBackup),['City'],['Rent','Sales']).blocked,false);
assert.equal(reviewBackup(JSON.stringify(kpiBackup),[],['Rent','Sales']).blocked,true,'missing KPI filter mapping blocks import');

// ABS uses the shared KPI compiler, including nested functions and blank handling.
const absDefinition={...definition,id:'absolute',name:'Absolute Rent',formula:'ABS([Rent])',format:'number'};
const absolute=compileKpis([absDefinition],['Rent']);
for(const [input,expected] of [[-125.5,125.5],[125.5,125.5],[0,0],[null,null]])assert.equal(absolute.evaluate('Absolute Rent',new Map([['Rent',input]])),expected);
const nestedAbs=compileKpis([{...absDefinition,formula:'abs(DIVIDE([Rent], [Sales]))'}],['Rent','Sales']);
assert.equal(nestedAbs.evaluate('Absolute Rent',new Map([['Rent',-20],['Sales',100]])),.2);
assert.equal(nestedAbs.evaluate('Absolute Rent',new Map([['Rent',20],['Sales',0]])),null);
assert.throws(()=>compileKpis([{...absDefinition,formula:'ABS([Rent], 2)'}],['Rent']),/argument/i);
