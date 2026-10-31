const assert=require('node:assert/strict');
const {compileTransactionRule,validateTransactionRule,resolveTransactionRule}=require('../.tmp/test/transactionRules');
const {answerTransactions,transactionQuestion}=require('../.tmp/test/answerTransactions');
const {reviewBackup}=require('../.tmp/test/qna/settingsBackup');
const p=compileTransactionRule('[Documents] = 0 AND ([Revenue] = 0 OR ISBLANK([Revenue]))');
assert(p.matches(new Map([['Documents',0],['Revenue',null]])));
assert(!p.matches(new Map([['Documents',null],['Revenue',0]])));
assert(compileTransactionRule('[Status] IN ("Reversed", "Cancelled")').matches(new Map([['Status','Cancelled']])));
assert(!compileTransactionRule('[Revenue] = 0').matches(new Map([['Revenue',null]])));
assert.throws(()=>compileTransactionRule('alert(1)'),/Field/);
assert.throws(()=>compileTransactionRule('[A] = 0; DELETE'),/Unsupported/);
const rule={name:'Hide zero documents',enabled:true,keyField:'ID',formula:'[Documents] = 0 AND [Revenue] = 0'};
const config={table:'P',column:'Field',enabled:true,options:['ID','Documents','Year'],fields:[{name:'ID',table:'T',column:'ID'},{name:'Documents',table:'T',column:'Documents',type:'number'},{name:'Year',table:'T',column:'Year',type:'number'}],time:{yearField:'Year'},analysis:{draft:{transactionFields:['ID'],transactionRule:rule}}};
const data=[{ID:'a',Documents:0,Revenue:0,Ratio:0},{ID:'b',Documents:1,Revenue:0,Ratio:.2},{ID:'c',Documents:0,Revenue:5,Ratio:.3},{ID:'d',Documents:null,Revenue:0,Ratio:.4}];
const calls=[];
const load=async plan=>{
 calls.push(plan);let selected=data;for(const f of plan.filters)if(f.target.column==='ID')selected=selected.filter(r=>f.values.includes(r.ID));
 const rows=plan.groups.length?selected.map(r=>[...plan.groups.map(n=>r[n]),...plan.measures.map(n=>r[n])]):[plan.measures.map(n=>n==='Ratio'?.75:selected.reduce((sum,r)=>sum+(r[n]||0),0))];
 return {text:'',table:{columns:[...plan.groups,...plan.measures],rows:rows.map(r=>r.map(v=>v===null?'—':String(v))),rowIndices:rows.map(()=>[]),modelGroupValues:rows.map(r=>r.slice(0,plan.groups.length)),modelRawRows:rows.map(r=>r.map(v=>typeof v==='number'?v:null)),modelResultComplete:true,modelTotals:['Grand Total','999']}};
};
(async()=>{
 for(const [view,ids] of [['included',['b','c','d']],['excluded',['a']],['all',['a','b','c','d']]]){
  calls.length=0;const result=await answerTransactions(transactionQuestion([{question:'Show Ratio for 2026',transactionRuleView:view}]),config,['Revenue','Ratio'],load);
  assert.deepEqual(result.table.rows.map(r=>r[0]),ids);assert.equal(result.table.modelTotals.at(-1),'0.75','model ratio total, never sum rows');assert.equal(result.transactionRule.view,view);
  assert(calls.every(p=>p.filters.some(f=>f.target.column==='Year'&&f.values.includes(2026))),'period retained in every request');
  assert.deepEqual(result.table.transactionExcludedRows,view==='all'?[0]:[]);
  assert.deepEqual(calls[0].groups,['ID','Documents']);assert(calls[0].transactionRuleProbe);assert(calls[1].groups.length===1,'hidden dependency not displayed');
  if(view!=='all')assert(result.table.drillScopes[0].inheritedFilters.some(f=>f.target.column==='ID'),'summary drill retains filtered IDs');
 }
 const {runAnalysis}=require('../.tmp/test/analysisTemplates');
 const published={...config.analysis.draft,measure:'Ratio',hierarchy:['ID'],consolidated:false,breakdownKeywords:['explain'],varianceKeywords:['variance'],comparison:'prior-year',missingPeriod:'ask',top:5,others:true,variancePercent:true,totals:true,favourable:'neutral'};
 const explained=await runAnalysis({mode:'variance',measure:'Ratio',period:'2026',comparison:'2025',level:0,top:5,base:'Show Ratio',selections:[],transactions:'both',transactionRuleView:'excluded'},{...config,analysis:{published}},['Revenue','Ratio'],load);
 assert.equal(explained.transactionTables.length,2);assert(explained.transactionTables.every(t=>t.table.rows.length===1&&t.table.rows[0][1]==='a'));
 const plan={groups:['ID'],measures:['Ratio'],filters:[],summary:[]};
 await assert.rejects(()=>resolveTransactionRule(plan,config,['Revenue','Ratio'],async()=>({table:{rows:[],modelResultComplete:false}})),/complete/);
 await assert.rejects(()=>resolveTransactionRule(plan,config,['Revenue','Ratio'],async()=>({table:{rows:[[],[]],modelGroupValues:[['a',0],['a',1]],modelRawRows:[[null,0,0],[null,1,0]],modelResultComplete:true}})),/not unique/);
 assert.throws(()=>validateTransactionRule({...rule,formula:'[Missing] = 0'},config.options,['Revenue'],['ID']),/unavailable/);
 const backup={format:'askBICS-settings',version:1,layout:{analysis:config.analysis}};
 const invalid=reviewBackup(JSON.stringify(backup),['ID','Year'],['Ratio','Revenue']);assert(invalid.blocked,'invalid imported rule blocks import');
 console.log('Transaction rules: boolean grammar, strict blanks, hidden dependencies, three views, scoped model totals, drill filters and invalid backup checks passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
