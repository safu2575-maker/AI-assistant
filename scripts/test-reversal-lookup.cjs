const assert=require('node:assert/strict');
const {matchReversalReferences}=require('../.tmp/test/reversalMatching');
const row=(id,document,reversal,partitions=[])=>({id,document,reversal,partitions,amount:null});
const r=matchReversalReferences([row('1','A','B'),row('2','B','A'),row('3','A','B'),row('4','C',null),row('5','D','Missing'),row('6','E','—'),row('7','001','1'),row('8','A','B',['Other'])]);
assert.deepEqual([...r.excluded],['1','2','3']);
assert(r.review.has('5'));assert(!r.excluded.has('7'));assert(!r.excluded.has('8'));
const {validateTransactionRule}=require('../.tmp/test/transactionRules');
const rule={name:'Lookup',enabled:true,keyField:'ID',formula:'',reversal:{method:'lookup',documentField:'Doc',reversalField:'Rev',amountMeasure:'',partitionFields:[]}};
validateTransactionRule(rule,['ID','Doc','Rev'],[],['ID']);
assert.throws(()=>validateTransactionRule({...rule,reversal:{...rule.reversal,method:'pairs'}},['ID','Doc','Rev'],[],['ID']));
assert.equal(JSON.parse(JSON.stringify(rule)).reversal.method,'lookup');
console.log('Reference lookup: reciprocal references, duplicate document lines, blanks, missing references, scope, leading zeros and validation passed.');
(async()=>{
 const {resolveTransactionRule}=require('../.tmp/test/transactionRules');
 const fields=['Doc','Rev','Company'];
 const config={options:fields,fields:fields.map(name=>({name,table:'T',column:name})),analysis:{draft:{transactionRule:{...rule,keyField:'',reversal:{...rule.reversal,partitionFields:['Company']}}}}};
 const tuples=[['A','B','X'],['B','A','X'],['C',null,'X'],['A','B','Y']];
 const plan={groups:fields,measures:['Amount'],filters:[],summary:[]};
 const load=async()=>({table:{columns:fields,rows:tuples.map(v=>v.map(x=>String(x??''))),rowIndices:tuples.map(()=>[]),modelGroupValues:tuples,modelResultComplete:true}});
 for(const [view,count] of [['included',2],['excluded',2],['all',4]]){
  const out=await resolveTransactionRule(plan,config,['Amount'],load,view);
  if(view!=='all'){const f=out.plan.filters[0];assert.equal(f.values.length,count);assert.equal(f.target.length,3);assert.equal(f.target[1].column,'Rev');}
  else {assert.equal(out.plan.filters.length,0);const decorated=out.decorate((await load()).table);assert.deepEqual(decorated.transactionExcludedRows,[0,1]);}
 }
 validateTransactionRule(config.analysis.draft.transactionRule,fields,['Amount'],fields);
 assert.throws(()=>validateTransactionRule({...rule,keyField:'',reversal:{...rule.reversal,method:'pairs'}},fields,['Amount'],fields));
 console.log('ID-free lookup: tuple filtering, blank references, scope isolation, all views and strict-rule ID requirement passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
